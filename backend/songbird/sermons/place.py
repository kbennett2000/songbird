"""Reading the passage out of a sermon and creating the note (v1.7 sermon sources, spec §7).

The second half of a check. The first half (`scan.py`) asks YouTube what a church has published
and writes a ledger row for each video; this asks Concord what the words in those rows mean and
turns the `pending` ones into sermon notes. They are separate files for the same reason they are
separate slices: they fail for different reasons, and a scan that loses touch with Concord must not
lose the catalogue it already paid YouTube for.

**The risk here is asymmetric, and everything leans one way.** A sermon pinned to the wrong passage
is worse than one left for a tap. So the rules stop at the first hit rather than gathering
everything they can; Concord is the only judge of what a string means; a channel's template verse
is struck out before anything is resolved; and a video whose passage was never written down becomes
a review-list entry rather than a guess.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from songbird.api._tags import resolve_tags
from songbird.concord.client import ConcordClient, ConcordNotFoundError
from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo, Tag
from songbird.sermons.anchor import BookOrder, ResolvedSpan, UnknownBookError, resolve_span
from songbird.sermons.dates import sermon_day
from songbird.sermons.passages import PlacedBy, boilerplate, rule_texts
from songbird.sermons.references import find_candidates

logger = logging.getLogger("songbird")

# How many ledger rows to hold in memory at once. A church's back catalogue is hundreds of rows
# each carrying a full description, so both passes below walk it by keyset rather than loading it.
_CHUNK: Final = 50

# What a person reads beside "last checked" when the videos arrived but their passages could not be
# read. Says what happened, what survived, and what happens next — the voice `scan.py`'s statuses
# use — and never a `str(exc)`, which reads like an API on a card next to a church's name.
STATUS_CONCORD_DOWN: Final = (
    "songbird found the videos but couldn't reach Concord to read their passages. "
    "It will try again at the next check."
)


@dataclass(slots=True)
class RunState:
    """What one run of the scan carries across every source it touches.

    All three fields exist because a run is the natural lifetime for them. The book map does not
    change while a scan runs and would otherwise be fetched once per note. A church repeats its
    references — its own name-verse, its series passage, its giving verse — so the same candidate
    is resolved over and over. And Concord being unreachable is a fact about Concord, not about a
    source: once seen, there is nothing to gain by asking again for every remaining source.
    """

    books: BookOrder = field(default_factory=BookOrder)
    # candidate → what Concord made of it, or None for "Concord says that is not a reference".
    # Only these two outcomes are cached: an unreachable Concord is never written here, so the
    # next run asks again.
    resolved: dict[str, ResolvedSpan | None] = field(default_factory=dict)
    concord_down: bool = False


async def already_noted_videos(db: AsyncSession, author_id: int, ids: Sequence[str]) -> set[str]:
    """Which of these videos this AUTHOR has already written a sermon note about (spec §6.4).

    Author-scoped, not global: two people following the same church each get their own notes, and
    one of them having noted a sermon must not silently deprive the other of it.

    Asked twice in a check, in both halves, and deliberately. The fetch asks so a video noted by
    hand never becomes a candidate at all; the placement asks again because a `pending` row can be
    days old — leftovers from earlier runs are evaluated too — and a note made by hand in between
    would otherwise be duplicated.
    """
    if not ids:
        return set()
    stmt = select(SermonNote.youtube_video_id).where(
        SermonNote.author_id == author_id,
        SermonNote.youtube_video_id.in_(ids),
    )
    return {v for v in (await db.execute(stmt)).scalars().all() if v is not None}


class Placer:
    """Turns a source's `pending` ledger rows into sermon notes, or into review-list entries.

    Owns a session factory rather than a session, like `ScanRunner` and for the same reason. It
    opens its own session after the fetch has closed its one: an `AsyncSession` whose flush raised
    refuses every later statement, and the two halves of a check must not be able to poison each
    other's writes.
    """

    def __init__(
        self, sessionmaker: async_sessionmaker[AsyncSession], concord: ConcordClient
    ) -> None:
        self._sessionmaker = sessionmaker
        self._concord = concord

    async def evaluate_source(self, source_id: int, state: RunState) -> None:
        """Read every `pending` row of one source and decide what it says.

        Raises `ConcordUnreachableError` if Concord goes away; everything committed before that
        stays committed, and every row not yet reached stays `pending` for the next check.
        """
        async with self._sessionmaker() as db:
            source = await db.get(SermonSource, source_id)
            if source is None:
                return  # deleted since the walk
            pending = await self._pending_ids(db, source_id)
            if not pending:
                # The common weekly case, and worth leaving early for: no boilerplate pass over a
                # thousand descriptions, and not one Concord call.
                return

            # Resolved ONCE for the whole source and committed straight away. `resolve_tags` adds
            # new rows without flushing, so calling it per note would create a second row for the
            # same new name and fail the unique constraint at flush.
            tags = await resolve_tags(db, [t.name for t in source.tags])
            await db.commit()

            excluded = await self._boilerplate(db, source_id)
            for start in range(0, len(pending), _CHUNK):
                await self._evaluate_chunk(
                    db, source, pending[start : start + _CHUNK], tags, excluded, state
                )

    async def _pending_ids(self, db: AsyncSession, source_id: int) -> list[int]:
        """Every row of this source still waiting to be read, oldest first.

        Ids rather than rows: the rows carry full descriptions and there can be hundreds of them.
        Rows that have already left `pending` are never revisited — once a video is in the review
        list it is a person's to decide, and a later check must not quietly overrule them.
        """
        stmt = (
            select(SermonSourceVideo.id)
            .where(
                SermonSourceVideo.source_id == source_id,
                SermonSourceVideo.status == "pending",
            )
            .order_by(SermonSourceVideo.id)
        )
        return list((await db.execute(stmt)).scalars().all())

    async def _boilerplate(self, db: AsyncSession, source_id: int) -> frozenset[str]:
        """The references that belong to this channel's template rather than to any sermon (§7).

        Counted over the source's WHOLE ledger — skipped and already-noted rows included — because
        a bigger denominator makes a template easier to see, and a giving verse appears in the
        descriptions of the videos that were too short just as much as in the sermons.

        Recomputed on every evaluation, by keyset, so a catalogue of a thousand descriptions is
        walked fifty at a time instead of being loaded into memory whole.
        """
        counts: dict[str, int] = {}
        total = 0
        after = 0
        while True:
            stmt = (
                select(
                    SermonSourceVideo.id,
                    SermonSourceVideo.title,
                    SermonSourceVideo.description,
                )
                .where(SermonSourceVideo.source_id == source_id, SermonSourceVideo.id > after)
                .order_by(SermonSourceVideo.id)
                .limit(_CHUNK)
            )
            rows = (await db.execute(stmt)).all()
            if not rows:
                break
            for row_id, title, description in rows:
                after = row_id
                total += 1
                # A set: a reference repeated within one description is still one video.
                for candidate in set(find_candidates(f"{title}\n{description}")):
                    counts[candidate] = counts.get(candidate, 0) + 1
        return boilerplate(counts, total)

    async def _evaluate_chunk(
        self,
        db: AsyncSession,
        source: SermonSource,
        ids: Sequence[int],
        tags: list[Tag],
        excluded: frozenset[str],
        state: RunState,
    ) -> None:
        stmt = (
            select(SermonSourceVideo)
            .where(SermonSourceVideo.id.in_(ids))
            .order_by(SermonSourceVideo.id)
        )
        rows = list((await db.execute(stmt)).scalars().all())
        noted = await already_noted_videos(db, source.author_id, [r.video_id for r in rows])
        for row in rows:
            await self._evaluate_one(db, row, tags, excluded, noted, state)

    async def _evaluate_one(
        self,
        db: AsyncSession,
        row: SermonSourceVideo,
        tags: list[Tag],
        excluded: frozenset[str],
        noted: set[str],
        state: RunState,
    ) -> None:
        """Decide one video, and commit that decision with the notes it produced.

        One commit per video, which is what spec §6 asks of the placing half: a video's notes and
        the row that says it was placed are written together or not at all, so an outage costs at
        most the video in hand and a re-run never doubles a note.
        """
        now = datetime.now(UTC)

        if row.video_id in noted:
            row.status = "already_noted"
            row.decided_at = now
            await db.commit()
            return

        for placed_by, text in rule_texts(row.title, row.description):
            spans = await self._resolve_all(text, excluded, state)
            if spans:
                await self._place(db, row, spans, placed_by, tags, now, state)
                return

        # Nothing stated the passage. Every reference anywhere in the description becomes a
        # suggestion for the review list — the honest outcome, one tap rather than a guess.
        suggestions = await self._resolve_all(row.description, excluded, state)
        row.status = "needs_passage"
        # A NEW list, never `.append()`: a JSON column is not mutation-tracked and an in-place
        # change would never reach the database.
        row.suggestions = [span.reference for span in suggestions]
        row.decided_at = now
        await db.commit()

    async def _place(
        self,
        db: AsyncSession,
        row: SermonSourceVideo,
        spans: list[ResolvedSpan],
        placed_by: PlacedBy,
        tags: list[Tag],
        now: datetime,
        state: RunState,
    ) -> None:
        event_date, _ = sermon_day(row.actual_start_time, row.published_at)
        for span in spans:
            db.add(
                SermonNote(
                    title=row.title,
                    # Setting the URL is what stamps `youtube_video_id`, through the model's own
                    # validator — so a later check sees this video as already noted.
                    sermon_url=f"https://www.youtube.com/watch?v={row.video_id}",
                    # Concord's spelling, not the church's: `2 Cor 5:17` is stored as
                    # `2 Corinthians 5:17`, so notes from four sources read alike.
                    reference=span.reference,
                    book_usfm=span.book_usfm,
                    # Answered from the cache the resolve above already filled, so this is a dict
                    # lookup rather than a second trip to Concord.
                    book_order_index=await state.books.index_for(span.book_usfm, self._concord),
                    start_chapter=span.first.chapter,
                    start_verse=span.first.verse,
                    end_chapter=span.last.chapter,
                    end_verse=span.last.verse,
                    event_date=event_date,
                    author_id=row.author_id,
                    source_video_id=row.id,
                    tags=tags,
                )
            )
        row.status = "placed"
        row.placed_by = placed_by
        row.decided_at = now
        await db.commit()

    async def _resolve_all(
        self, text: str, excluded: frozenset[str], state: RunState
    ) -> list[ResolvedSpan]:
        """Every reference in `text` that Concord recognises and the channel does not repeat.

        Boilerplate is struck out BEFORE anything is resolved, so a template verse costs no lookup
        at all. What comes back is deduplicated by ANCHOR rather than by string: `2 Cor. 5` and
        `2 Corinthians 5` on one line are the same passage, and they must make one note.
        """
        spans: list[ResolvedSpan] = []
        anchors: set[tuple[str, int, int, int, int]] = set()
        for candidate in find_candidates(text):
            if candidate in excluded:
                continue
            span = await self._resolve(candidate, state)
            if span is None:
                continue
            anchor = (
                span.book_usfm,
                span.first.chapter,
                span.first.verse,
                span.last.chapter,
                span.last.verse,
            )
            if anchor in anchors:
                continue
            anchors.add(anchor)
            spans.append(span)
        return spans

    async def _resolve(self, candidate: str, state: RunState) -> ResolvedSpan | None:
        """Ask Concord what one candidate means. None means it said that is not a reference.

        A rejection is the NORMAL case, not a failure: the finder is deliberately loose and offers
        `Episode 63` and `Sunday 9:00` along with the real thing. An unreachable Concord is a
        different matter entirely and is left to propagate — and, unlike the two answers here, is
        never cached, so the next check asks again.
        """
        if candidate in state.resolved:
            return state.resolved[candidate]
        try:
            span = await resolve_span(candidate, self._concord)
            # Proven HERE, while the candidate is being judged, rather than at note-building time:
            # a book Concord resolves to but does not list would otherwise raise half way through
            # writing a video's notes. It also warms the cache the note builder reads.
            await state.books.index_for(span.book_usfm, self._concord)
        except (ConcordNotFoundError, UnknownBookError):
            state.resolved[candidate] = None
            return None
        state.resolved[candidate] = span
        return span
