"""Reading and scoping the ledger — shared by the listing and the review actions (spec §8-9).

Two routers now ask the same questions of `sermon_source_videos`: `GET /videos` lists a filtered
page of it, and `POST /videos/dismiss-matching` marks that same filtered set as not-sermons. **They
must not be able to disagree about what a filter means.** A bulk action that selected a different
set from the one on screen would dismiss videos the reader never saw, and there would be no way to
tell from the page that it had. So the WHERE is built in exactly one place, here, and both call it.

The rest is the scoping and shaping every route on a ledger row needs: another author's row is a
404, a single row answers in the same shape a page of them does.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.schemas import (
    PlacedNoteOut,
    SermonSourceCounts,
    SermonSourceVideoOut,
    SermonVideoFilters,
)
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo


def sermon_day_column() -> ColumnElement[datetime | None]:
    """The timestamp a ledger row is dated by: when the stream started, or when it was published.

    The same choice `sermons/dates.py` makes for the note and the row's own date line, expressed in
    SQL so a date filter selects the rows a reader would point at. Filtering on `published_at`
    instead would quietly disagree with the screen: a service streamed 14:55 on the Sunday and
    posted 04:32 on the Monday shows as Sunday and would escape a "before Monday" filter.

    Typed nullable because `coalesce` is only as certain as its arguments; in the table it never is,
    because `published_at` is `NOT NULL`.
    """
    return func.coalesce(SermonSourceVideo.actual_start_time, SermonSourceVideo.published_at)


@dataclass(frozen=True, slots=True)
class LedgerScope:
    """One filter, as two WHERE lists.

    `all` is the filter as asked. `without_status` is the same minus the state clause, which is
    what the per-state counts are tallied over — the filter bar has to say how many rows are in
    the OTHER states, or choosing one would hide the number that told you to choose it.
    """

    without_status: list[ColumnElement[bool]]
    all: list[ColumnElement[bool]]


async def source_or_404(db: AsyncSession, source_id: int, author_id: int) -> SermonSource:
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


async def video_or_404(db: AsyncSession, video_id: int, author_id: int) -> SermonSourceVideo:
    """One ledger row, or a 404 — including for a row belonging to somebody else.

    One indexed lookup, because `author_id` is denormalized onto the row precisely so a review
    action never has to join through the source to find out whose video it is.
    """
    result = await db.execute(
        select(SermonSourceVideo).where(
            SermonSourceVideo.id == video_id, SermonSourceVideo.author_id == author_id
        )
    )
    video = result.scalar_one_or_none()
    if video is None:
        raise_http(404, ErrorCode.VIDEO_NOT_FOUND, f"No video {video_id}")
    return video


async def ledger_scope(
    db: AsyncSession, author_id: int, filters: SermonVideoFilters
) -> LedgerScope:
    """The filter as SQL. **The single definition of what a filter selects.**

    A `source_id` that is not this author's is a 404 rather than an empty result, which is the
    no-existence-leak answer everywhere else on this router — and it matters more here than on a
    listing, because the same filter drives a bulk write.
    """
    where: list[ColumnElement[bool]] = [SermonSourceVideo.author_id == author_id]
    if filters.source_id is not None:
        await source_or_404(db, filters.source_id, author_id)
        where.append(SermonSourceVideo.source_id == filters.source_id)
    if filters.published_after is not None:
        where.append(sermon_day_column() >= _start_of(filters.published_after))
    if filters.published_before is not None:
        # Inclusive of the whole named day: "before 7 September" said out loud includes the 7th,
        # and a reader picking an end date from a calendar means the day they picked.
        where.append(sermon_day_column() < _start_of(filters.published_before + timedelta(days=1)))
    if filters.q:
        # `autoescape` so a title search for "100%" is a search for a percent sign rather than a
        # wildcard that matches the whole catalogue — which is a bulk-dismiss filter, so it must
        # never quietly widen.
        where.append(SermonSourceVideo.title.icontains(filters.q, autoescape=True))
    if filters.status is None:
        return LedgerScope(without_status=where, all=where)
    return LedgerScope(
        without_status=where, all=[*where, SermonSourceVideo.status == filters.status]
    )


def _start_of(day: date) -> datetime:
    """Midnight UTC on that day. UTC because the ledger's timestamps are UTC and the calendar day
    songbird files a sermon under is the UTC one (spec §13 — local timezones are deferred)."""
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


async def status_counts(
    db: AsyncSession, where: Sequence[ColumnElement[bool]]
) -> SermonSourceCounts:
    """How many rows this filter holds in each state, in one grouped query."""
    stmt = (
        select(SermonSourceVideo.status, func.count())
        .where(*where)
        .group_by(SermonSourceVideo.status)
    )
    tally = {status_value: total for status_value, total in (await db.execute(stmt)).all()}
    # A status word this model does not know is ignored rather than fatal, like `_counts_for`.
    return SermonSourceCounts.model_validate(tally)


async def notes_for(db: AsyncSession, video_ids: Sequence[int]) -> dict[int, list[PlacedNoteOut]]:
    """The notes each of these ledger rows created, in ONE query for the whole page.

    A relationship would be a query per row, or — with `selectin` — every note behind every ledger
    listing whether the page shows them or not.

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


async def video_out(db: AsyncSession, video: SermonSourceVideo) -> SermonSourceVideoOut:
    """One ledger row in the same shape a page of them uses.

    Every review action answers with this, so a row can be redrawn from what it gets back instead
    of the page refetching a list of hundreds after every tap.
    """
    out = SermonSourceVideoOut.model_validate(video)
    source = await db.get(SermonSource, video.source_id)
    out.source_title = source.title if source is not None else ""
    out.notes = (await notes_for(db, [video.id])).get(video.id, [])
    return out
