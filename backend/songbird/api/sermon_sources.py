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

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._tags import resolve_tags
from songbird.api.deps import (
    get_current_user,
    get_db,
    get_youtube_client,
    get_youtube_client_optional,
)
from songbird.api.schemas import (
    SermonSourceCreate,
    SermonSourceOut,
    SermonSourcesStatus,
    SermonSourceUpdate,
)
from songbird.config import get_settings
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonSource, SermonSourceVideo, User
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


# `/status` is declared BEFORE `/{source_id}`: FastAPI matches routes in the order they were
# added, so the other way round "status" would be read as a source id and 422 on the int parse.
@router.get("/status", response_model=SermonSourcesStatus)
async def sermon_sources_status(
    youtube: YouTubeClient | None = Depends(get_youtube_client_optional),
    user: User = Depends(get_current_user),
) -> SermonSourcesStatus:
    """Whether the feature is switched on, and the default the add form hints at.

    Uses the OPTIONAL client dependency: with no key this must answer `configured: false`, not
    409 — the page's setup message is the answer.
    """
    return SermonSourcesStatus(
        configured=youtube is not None,
        min_minutes_default=get_settings().sermon_min_minutes,
    )


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
    return [SermonSourceOut.model_validate(s) for s in sources]


@router.post("", response_model=SermonSourceOut, status_code=status.HTTP_201_CREATED)
async def create_sermon_source(
    body: SermonSourceCreate,
    db: AsyncSession = Depends(get_db),
    youtube: YouTubeClient = Depends(get_youtube_client),
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
    )
    db.add(source)
    await db.commit()  # expire_on_commit=False keeps the in-memory tags
    return SermonSourceOut.model_validate(source)


@router.get("/{source_id}", response_model=SermonSourceOut)
async def get_sermon_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceOut:
    return SermonSourceOut.model_validate(await _get_or_404(db, source_id, user.id))


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
    return SermonSourceOut.model_validate(source)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sermon_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Forget a source and everything a check recorded about it. Sermon notes are never touched —
    deleting where sermons came FROM must not delete the notes you wrote about them (spec §9), and
    that stays true when slice 4b gives notes a link back to the ledger row that made them.

    The ledger is cleared HERE rather than by the `ondelete="CASCADE"` in the migration, because
    SQLite only enforces foreign keys when `PRAGMA foreign_keys` is on and songbird never turns it
    on — so that clause never fires and the rows would simply be orphaned. One bulk DELETE rather
    than an ORM relationship: a `selectin` one would drag every scanned video behind the sources
    LIST, and a lazy one would issue a DELETE per row.
    """
    source = await _get_or_404(db, source_id, user.id)
    await db.execute(delete(SermonSourceVideo).where(SermonSourceVideo.source_id == source.id))
    await db.delete(source)
    await db.commit()
