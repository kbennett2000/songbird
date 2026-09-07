"""Sermon sources — the channels and playlists songbird collects sermons from (spec §4-5, §9).

A source is registered once by pasting a link: songbird resolves it through YouTube, stores the
canonical id, the uploads playlist a later scan will read, and the title to show. Author-scoped
like every other songbird table, and tagged from the SAME vocabulary as annotations and sermon
notes.

Nothing is scanned here. Spec §5 has the first catalogue scan run on add; that scan is slice 4,
so for now adding a source stores it and stops. The seam is deliberate — the CRUD reviews as one
diff and the scan as another.

The one route that does NOT demand a YouTube key is `/status`: with no key the Sources page shows
a setup message, and it can only know to do that if something answers.
"""

from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._tags import resolve_tags
from songbird.api.deps import (
    get_current_user,
    get_db,
    get_scan_runner_optional,
    get_youtube_client,
    get_youtube_client_optional,
)
from songbird.api.schemas import (
    PlacedNoteOut,
    SermonCheckQueued,
    SermonSourceCounts,
    SermonSourceCreate,
    SermonSourceOut,
    SermonSourcesStatus,
    SermonSourceUpdate,
    SermonSourceVideoOut,
    SermonSourceVideosPage,
    SermonVideoStatus,
)
from songbird.config import get_settings
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo, User
from songbird.sermons.scan import ScanRunner
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeClient,
    YouTubeError,
    YouTubeNotFoundError,
    YouTubeQuotaError,
)
from songbird.youtube.urls import parse_source_url

router = APIRouter(prefix="/api/v1/sermon-sources", tags=["sermon-sources"])

# Said to the person who pasted the link, so it names what to do rather than what went wrong.
# The old /c/ and /user/ forms are the reason this message exists: they cannot be resolved
# through the Data API at all, and nothing about the failure hints at the @handle link.
_BAD_URL = (
    "That doesn't look like a YouTube channel or playlist link. Paste the channel's @handle link "
    "(like youtube.com/@yourchurch), a youtube.com/channel/UC… link, or a playlist link. Older "
    "/c/… and /user/… links can't be looked up — open the channel and copy its @handle link."
)

# Names the setting, never its value (spec §2 — the key is a secret, even in an error).
_KEY_REJECTED = (
    "YouTube rejected the API key. Check YOUTUBE_API_KEY in songbird's configuration — it may be "
    "wrong, restricted to other APIs or referrers, or the YouTube Data API may not be enabled "
    "for it."
)


async def _get_or_404(db: AsyncSession, source_id: int, author_id: int) -> SermonSource:
    # Scoped to the author: another user's source is a 404 (no existence leak).
    result = await db.execute(
        select(SermonSource).where(
            SermonSource.id == source_id, SermonSource.author_id == author_id
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise_http(404, ErrorCode.SOURCE_NOT_FOUND, f"No sermon source {source_id}")
    return source


async def _counts_for(db: AsyncSession, source_ids: Sequence[int]) -> dict[int, SermonSourceCounts]:
    """Every source's ledger tally, in ONE query rather than one per source.

    The Sources page puts a handful of numbers on each row, and fetching them per source would
    turn a list of ten into eleven round trips. This groups the whole ledger by (source, status)
    once and hands back a dict the routes index into, so the cost is constant however many
    sources there are.

    Author scoping is inherited rather than repeated: `source_ids` only ever comes from a query
    already filtered to one author, and a second predicate here would add a term the
    (source_id, status) index would rather not see.
    """
    if not source_ids:
        return {}
    stmt = (
        select(SermonSourceVideo.source_id, SermonSourceVideo.status, func.count())
        .where(SermonSourceVideo.source_id.in_(source_ids))
        .group_by(SermonSourceVideo.source_id, SermonSourceVideo.status)
    )
    tallies: dict[int, dict[str, int]] = {}
    for source_id, status_value, total in (await db.execute(stmt)).all():
        tallies.setdefault(source_id, {})[status_value] = total
    # A status word this model does not know is ignored rather than fatal: the ledger's vocabulary
    # grows over two more slices, and a stale API shape must not 500 the page.
    return {sid: SermonSourceCounts.model_validate(tallies.get(sid, {})) for sid in source_ids}


async def _notes_for(db: AsyncSession, video_ids: Sequence[int]) -> dict[int, list[PlacedNoteOut]]:
    """The notes each of these ledger rows created, in ONE query for the whole page.

    A relationship would be a query per row, or — with `selectin` — every note behind every ledger
    listing whether the page shows them or not. This is the same trade `_counts_for` makes just
    above, for the same reason.

    Author scoping is inherited rather than repeated: `video_ids` only ever comes from rows already
    filtered to one author, and a note can only point at a row belonging to the person who owns it.

    Ordered canonically, so a video placed on Acts and Exodus lists them in the order the rest of
    songbird lists sermon notes in, rather than in whichever order the rules happened to find them.
    """
    if not video_ids:
        return {}
    stmt = (
        select(SermonNote)
        .where(SermonNote.source_video_id.in_(video_ids))
        .order_by(
            SermonNote.book_order_index,
            SermonNote.start_chapter,
            SermonNote.start_verse,
            SermonNote.id,
        )
    )
    notes: dict[int, list[PlacedNoteOut]] = {}
    for note in (await db.execute(stmt)).scalars():
        assert note.source_video_id is not None  # the WHERE guarantees it; this tells pyright
        notes.setdefault(note.source_video_id, []).append(PlacedNoteOut.model_validate(note))
    return notes


async def _one_out(db: AsyncSession, source: SermonSource) -> SermonSourceOut:
    """One source as the API returns it, counts included — so no route ever answers with the
    zeros the `counts` field would otherwise default to."""
    out = SermonSourceOut.model_validate(source)
    out.counts = (await _counts_for(db, [source.id])).get(source.id, SermonSourceCounts())
    return out


async def _resolve(url: str, youtube: YouTubeClient) -> tuple[str, str, str | None, str]:
    """Turn a pasted link into `(kind, youtube_id, uploads_playlist_id, title)` via YouTube.

    Every YouTube failure is translated here, so the route body reads as the happy path. The
    mappings are slice 2's, unchanged: quota is not the key's fault and resets; a rejected key
    needs a human; anything else is transient.
    """
    parsed = parse_source_url(url)
    if parsed is None:
        raise_http(422, ErrorCode.INVALID_SOURCE_URL, _BAD_URL)
    kind, value = parsed

    try:
        if kind == "playlist":
            playlist = await youtube.get_playlist(value)
            return "playlist", playlist.id, None, playlist.title
        channel = (
            await youtube.resolve_channel_by_handle(value)
            if kind == "handle"
            else await youtube.get_channel(value)
        )
        return "channel", channel.id, channel.uploads_playlist_id, channel.title
    except YouTubeNotFoundError:
        # Deliberately re-worded rather than passed through: the client's message is about an
        # API, and the person reading this pasted a link.
        raise_http(
            404,
            ErrorCode.NOT_FOUND,
            f"YouTube has nothing at {value}. Check the link and try again.",
        )
    except YouTubeQuotaError as exc:
        raise_http(429, ErrorCode.YOUTUBE_QUOTA, str(exc))
    except YouTubeAuthError as exc:
        detail = _KEY_REJECTED
        if exc.reason:  # e.g. API_KEY_INVALID — Google's token, never the key itself
            detail = f"{detail} (YouTube said: {exc.reason})"
        raise_http(502, ErrorCode.YOUTUBE_KEY_REJECTED, detail)
    except YouTubeError as exc:
        raise_http(502, ErrorCode.YOUTUBE_UNREACHABLE, str(exc))


# `/status` and `/videos` are declared BEFORE `/{source_id}`: FastAPI matches routes in the order
# they were added, and the path pattern matches before the int conversion — so the other way round
# "status" and "videos" would both be read as source ids and 422. There is a test for each.
@router.get("/status", response_model=SermonSourcesStatus)
async def sermon_sources_status(
    youtube: YouTubeClient | None = Depends(get_youtube_client_optional),
    runner: ScanRunner | None = Depends(get_scan_runner_optional),
    user: User = Depends(get_current_user),
) -> SermonSourcesStatus:
    """Whether the feature is switched on, the default the add form hints at, and whether a check
    is running right now — which the page polls for while one is.

    Uses the OPTIONAL dependencies for both: with no key this must answer `configured: false`
    rather than 409 (the page's setup message IS the answer), and with no runner it must answer
    "nothing is running", which is true. `scan_started_at` is read only when a scan really is
    running, so the two fields can never disagree with each other.
    """
    running = runner is not None and runner.running
    return SermonSourcesStatus(
        configured=youtube is not None,
        min_minutes_default=get_settings().sermon_min_minutes,
        scan_running=running,
        scan_started_at=runner.started_at if running and runner is not None else None,
    )


@router.get("/videos", response_model=SermonSourceVideosPage)
async def list_sermon_source_videos(
    status_filter: SermonVideoStatus | None = Query(default=None, alias="status"),
    source_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceVideosPage:
    """The ledger: what every check has seen, newest sermon first.

    No YouTube key required — this reads songbird's own table. A key rotated out or revoked must
    not take away the record of what was already found (spec §2: YouTube's absence is a recorded
    condition, not a fatal one), and the other read routes on this router don't demand one either.

    No `status` means every state, rather than spec §9's `needs_passage` default: nothing can BE
    `needs_passage` until the slice that reads passages, so that default would answer the first
    person who ever opens this view with an empty list. The spec is corrected in this PR.

    The `id` tiebreak in the ordering is required, not decoration. A church that posts a series in
    one sitting gives several videos the same `publishedAt` to the second, and without a total
    order the offsets behind "Load more" would repeat some rows and drop others.
    """
    where = [SermonSourceVideo.author_id == user.id]
    if source_id is not None:
        # A 404 rather than an empty page: an id that isn't yours must not read as "nothing
        # found", which is the no-existence-leak answer everywhere else on this router.
        await _get_or_404(db, source_id, user.id)
        where.append(SermonSourceVideo.source_id == source_id)
    if status_filter is not None:
        where.append(SermonSourceVideo.status == status_filter)

    total = (
        await db.execute(select(func.count()).select_from(SermonSourceVideo).where(*where))
    ).scalar_one()
    stmt = (
        select(SermonSourceVideo, SermonSource.title)
        .join(SermonSource, SermonSource.id == SermonSourceVideo.source_id)
        .where(*where)
        .order_by(SermonSourceVideo.published_at.desc(), SermonSourceVideo.id.desc())
        .limit(limit)
        .offset(offset)
    )
    videos: list[SermonSourceVideoOut] = []
    for video, source_title in (await db.execute(stmt)).all():
        item = SermonSourceVideoOut.model_validate(video)
        item.source_title = source_title
        videos.append(item)
    notes = await _notes_for(db, [v.id for v in videos])
    for item in videos:
        item.notes = notes.get(item.id, [])
    return SermonSourceVideosPage(videos=videos, total=total)


@router.get("", response_model=list[SermonSourceOut])
async def list_sermon_sources(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SermonSourceOut]:
    """The current user's sources, newest first — the one you just added is the one you want to
    see. (`id` breaks ties: two sources added in the same clock tick still get a stable order.)"""
    stmt = (
        select(SermonSource)
        .where(SermonSource.author_id == user.id)
        .order_by(SermonSource.created_at.desc(), SermonSource.id.desc())
    )
    sources = (await db.execute(stmt)).scalars().unique().all()
    counts = await _counts_for(db, [s.id for s in sources])
    out: list[SermonSourceOut] = []
    for source in sources:
        item = SermonSourceOut.model_validate(source)
        item.counts = counts.get(source.id, SermonSourceCounts())
        out.append(item)
    return out


@router.post("", response_model=SermonSourceOut, status_code=status.HTTP_201_CREATED)
async def create_sermon_source(
    body: SermonSourceCreate,
    db: AsyncSession = Depends(get_db),
    youtube: YouTubeClient = Depends(get_youtube_client),
    runner: ScanRunner | None = Depends(get_scan_runner_optional),
    user: User = Depends(get_current_user),
) -> SermonSourceOut:
    kind, youtube_id, uploads_playlist_id, title = await _resolve(body.url, youtube)

    # Checked before the insert so the answer names the source the owner already has, rather
    # than an IntegrityError. The unique constraint stays as the backstop.
    existing = (
        await db.execute(
            select(SermonSource).where(
                SermonSource.author_id == user.id, SermonSource.youtube_id == youtube_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise_http(409, ErrorCode.SOURCE_EXISTS, f"You've already added {existing.title}.")

    source = SermonSource(
        kind=kind,
        youtube_id=youtube_id,
        uploads_playlist_id=uploads_playlist_id,
        input_url=body.url.strip(),
        title=title,
        include_live=body.include_live,
        min_minutes=body.min_minutes,
        author_id=user.id,
        tags=await resolve_tags(db, body.tags),
        # Spec §5: adding a source scans its whole back catalogue, starting now. Written down
        # rather than acted on here — a catalogue scan is dozens of Google calls and must not sit
        # inside this request.
        check_requested_at=datetime.now(UTC),
    )
    db.add(source)
    await db.commit()  # expire_on_commit=False keeps the in-memory tags
    # After the commit, never before: the runner reads its own session, and a request it cannot
    # see is a request that never happened.
    if runner is not None:
        runner.request_scan()
    # Still 201, not 202 — a source really was created; the scan is a consequence of creating it.
    return await _one_out(db, source)


@router.post("/check", status_code=status.HTTP_202_ACCEPTED, response_model=SermonCheckQueued)
async def check_all_sermon_sources(
    db: AsyncSession = Depends(get_db),
    youtube: YouTubeClient = Depends(get_youtube_client),
    runner: ScanRunner | None = Depends(get_scan_runner_optional),
    user: User = Depends(get_current_user),
) -> SermonCheckQueued:
    """Check every enabled source now. 202: accepted, not finished.

    Demands a YouTube client even though it never touches one. Queueing work that could never run
    would be a lie told in the friendliest possible way — and the Sources page already knows what
    to say about `YOUTUBE_NOT_CONFIGURED`.

    Paused sources are left out here rather than in the runner, so the decision is made once, in
    the place where the person pressing the button can see the count that comes back.
    """
    ids = (
        (
            await db.execute(
                select(SermonSource.id).where(
                    SermonSource.author_id == user.id, SermonSource.enabled.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    if ids:
        await db.execute(
            update(SermonSource)
            .where(SermonSource.id.in_(ids))
            .values(check_requested_at=datetime.now(UTC))
        )
        await db.commit()  # before the runner is told: it reads its own session
        if runner is not None:
            runner.request_scan()
    # Nothing enabled is still 202 with a count of zero. Nothing failed — the request was
    # accepted and there was nothing in it, which the page says in words.
    return SermonCheckQueued(queued=len(ids))


@router.get("/{source_id}", response_model=SermonSourceOut)
async def get_sermon_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceOut:
    return await _one_out(db, await _get_or_404(db, source_id, user.id))


@router.patch("/{source_id}", response_model=SermonSourceOut)
async def update_sermon_source(
    source_id: int,
    body: SermonSourceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceOut:
    """Edit how a source is filtered. The URL and the identity it resolved to are immutable —
    to point songbird at a different channel, delete this source and add the new one."""
    source = await _get_or_404(db, source_id, user.id)
    if body.enabled is not None:
        source.enabled = body.enabled
    if body.include_live is not None:
        source.include_live = body.include_live
    # `null` here MEANS "follow SERMON_MIN_MINUTES", so absent and null have to be told apart —
    # the `is not None` idiom the other fields use would make clearing an override impossible.
    if "min_minutes" in body.model_fields_set:
        source.min_minutes = body.min_minutes
    if body.tags is not None:
        source.tags = await resolve_tags(db, body.tags)
    await db.commit()
    return await _one_out(db, source)


@router.post(
    "/{source_id}/check", status_code=status.HTTP_202_ACCEPTED, response_model=SermonCheckQueued
)
async def check_sermon_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    youtube: YouTubeClient = Depends(get_youtube_client),
    runner: ScanRunner | None = Depends(get_scan_runner_optional),
    user: User = Depends(get_current_user),
) -> SermonCheckQueued:
    """Check this one source now.

    A paused source queues nothing and is NOT stamped: the runner only ever picks up enabled
    sources, so a request left on a paused one would sit there unserved and the row would read
    "waiting to be checked" forever. The page doesn't offer the button on a paused source; this
    is the answer if something asks anyway.
    """
    source = await _get_or_404(db, source_id, user.id)
    if not source.enabled:
        return SermonCheckQueued(queued=0)
    source.check_requested_at = datetime.now(UTC)
    await db.commit()
    if runner is not None:
        runner.request_scan()
    return SermonCheckQueued(queued=1)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sermon_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Forget a source and everything a check recorded about it. Sermon notes are never touched —
    deleting where sermons came FROM must not delete the notes you wrote about them (spec §9).

    Both cleanups happen HERE rather than through the `ondelete=` clauses in the migrations,
    because SQLite only enforces foreign keys when `PRAGMA foreign_keys` is on and songbird never
    turns it on — so those clauses never fire. Without the first statement a check-created note
    would be left pointing at a ledger row that no longer exists; without the second the ledger
    rows would simply be orphaned.

    Order matters: unlink the notes, THEN drop the rows they pointed at.

    Bulk statements rather than ORM relationships: a `selectin` relationship would drag every
    scanned video behind the sources LIST, and a lazy one would issue a statement per row.
    """
    source = await _get_or_404(db, source_id, user.id)
    await db.execute(
        update(SermonNote)
        .where(
            SermonNote.source_video_id.in_(
                select(SermonSourceVideo.id).where(SermonSourceVideo.source_id == source.id)
            )
        )
        .values(source_video_id=None)
    )
    await db.execute(delete(SermonSourceVideo).where(SermonSourceVideo.source_id == source.id))
    await db.delete(source)
    await db.commit()
