"""The review list's actions — place, dismiss, restore, reopen (v1.7 sermon sources, spec §8).

The scan reads what a church wrote down. This is what happens to everything it could not read: a
list of hundreds, worked through over months, one tap at a time. Four decisions on a row, plus one
bulk tool for the case that dominates the real data — a livestreaming church whose service titles
are dates and whose descriptions never name a passage.

**Its own module rather than more of `sermon_sources.py`**, and its own router on the same prefix,
which is the shape `sermon_redate.py` already uses. That file is the catalogue: registering a
channel and asking what has been seen. This one is the deciding, and the two review as separate
diffs.

Everything that decides shares two rules with everything else that decides:

* **`_review_target`** — where a row goes when a decision is undone. Once, in one function, so a
  skipped video cannot be laundered into the review queue by placing it and reopening it.
* **`build_sermon_note`** — a note tapped into place here is byte-for-byte a note the scan would
  have made. `placed_by` on the ROW remembers which of the two happened; nothing on the note does,
  because nothing about the note is different.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._anchors import resolve_anchor, resolve_book_order_index
from songbird.api._sermon_ledger import ledger_scope, source_or_404, video_or_404, video_out
from songbird.api._tags import resolve_tags
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.api.schemas import (
    SermonSourceVideoOut,
    SermonVideoFilters,
    SermonVideoPlace,
    SermonVideosDismissed,
)
from songbird.concord.client import ConcordClient
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, SermonSourceVideo, User
from songbird.sermons.anchor import ResolvedSpan
from songbird.sermons.notes import build_sermon_note

router = APIRouter(prefix="/api/v1/sermon-sources", tags=["sermon-sources"])

# The states a bulk dismiss is allowed to touch, whatever the filter selects. Never `placed`: that
# row has notes behind it, and a sweep of a year's videos must not be able to delete a note the
# owner wrote. Never `pending` either — that row has not been read yet, and dismissing it would
# throw away work the next check is about to do.
_BULK_DISMISSIBLE = ("needs_passage", "skipped")


def _review_target(row: SermonSourceVideo) -> str:
    """Where this row goes when its decision is undone — restored, or reopened.

    A row that was skipped goes back to `skipped`, keeping the reason it was skipped for; anything
    else goes to `needs_passage`. `skip_reason` is what remembers this, which is why placing a
    skipped row keeps it rather than clearing it: it is the only record of where the row came from,
    and without it "Note it anyway" followed by "Wrong passage" would quietly promote a
    three-minute announcement clip into the sermon queue.
    """
    return "skipped" if row.skip_reason is not None else "needs_passage"


def _require_state(row: SermonSourceVideo, allowed: tuple[str, ...], doing: str) -> None:
    """409 unless the row is in a state this action makes sense from.

    Not a 404 and not a silent success: the row is real and yours, and the honest answer is that
    it has already moved on — usually because another tab, or the same list left open since
    yesterday, is showing a state that is no longer true.
    """
    if row.status not in allowed:
        raise_http(
            409,
            ErrorCode.VIDEO_STATE,
            f"Can't {doing} a video that is '{row.status}'. Reload the list and try again.",
        )


@router.post("/videos/dismiss-matching", response_model=SermonVideosDismissed)
async def dismiss_matching_videos(
    filters: SermonVideoFilters,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonVideosDismissed:
    """Mark everything this filter selects as not a sermon (spec §8).

    The bulk tool the real data demands: one church left ~350 dated livestreams in the review list
    in a single scan, and "everything from this channel before 2025" has to be a filter and one
    confirm rather than three hundred taps.

    **An empty filter is refused.** "Dismiss all" with nothing narrowing it is never a thing
    somebody meant to press, and it is unrecoverable in one action — restore is per row.

    It touches only rows that have nothing behind them, so however wide the filter, this can never
    delete a note. That is also why the count it returns can be smaller than the number of rows on
    screen, and why it is the count that gets reported rather than the filter's size.

    Declared BEFORE `/videos/{video_id}/…` so that "dismiss-matching" cannot be read as a video id.
    """
    if not filters.has_any:
        raise_http(
            422,
            ErrorCode.EMPTY_FILTER,
            "Choose a source, a state, a date or a search first — this won't dismiss everything.",
        )
    scope = await ledger_scope(db, user.id, filters)
    result = await db.execute(
        update(SermonSourceVideo)
        .where(*scope.all, SermonSourceVideo.status.in_(_BULK_DISMISSIBLE))
        .values(status="dismissed", decided_at=datetime.now(UTC))
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return SermonVideosDismissed(dismissed=result.rowcount)


@router.post("/videos/{video_id}/place", response_model=SermonSourceVideoOut)
async def place_sermon_video(
    video_id: int,
    body: SermonVideoPlace,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
) -> SermonSourceVideoOut:
    """Write the sermon notes for a video whose passage a person just told songbird (spec §8).

    One note per reference, and **all of them or none**: every reference is resolved through
    Concord before a single note is built, so a list with one bad spelling in it leaves the row
    exactly as it was and says which one failed. Half-placing would be the worst outcome — the row
    would read as done with a passage missing from it.

    Allowed from `needs_passage` (the ordinary case), `skipped` ("Note it anyway" — a short video
    that was a sermon after all) and `dismissed` (a change of mind).
    """
    row = await video_or_404(db, video_id, user.id)
    _require_state(row, ("needs_passage", "skipped", "dismissed"), "place")

    spans: list[ResolvedSpan] = []
    order: dict[str, int] = {}
    for reference in body.references:
        # Concord's spelling is kept, not the tap's: "Psalm 23" is stored as "Psalms 23", exactly
        # as the scan stores it, so two videos on one passage read alike in Browse.
        span = await resolve_anchor(reference, concord)
        if span.book_usfm not in order:
            order[span.book_usfm] = await resolve_book_order_index(span.book_usfm, concord)
        spans.append(span)

    # Resolved ONCE for the whole request, never per note: `resolve_tags` adds new rows without
    # flushing, so asking twice for a tag that does not exist yet creates two of it and fails the
    # unique constraint at flush.
    source = await source_or_404(db, row.source_id, user.id)
    tags = await resolve_tags(db, [t.name for t in source.tags])

    for span in spans:
        db.add(build_sermon_note(row, span, order[span.book_usfm], tags))
    row.status = "placed"
    row.placed_by = "manual"
    row.decided_at = datetime.now(UTC)
    await db.commit()
    return await video_out(db, row)


@router.post("/videos/{video_id}/dismiss", response_model=SermonSourceVideoOut)
async def dismiss_sermon_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceVideoOut:
    """Not a sermon — a concert, an announcement, a test stream. Reversible; nothing is deleted."""
    row = await video_or_404(db, video_id, user.id)
    _require_state(row, ("needs_passage", "skipped"), "dismiss")
    row.status = "dismissed"
    row.decided_at = datetime.now(UTC)
    await db.commit()
    return await video_out(db, row)


@router.post("/videos/{video_id}/restore", response_model=SermonSourceVideoOut)
async def restore_sermon_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceVideoOut:
    """Undo a dismissal — back to wherever the row was before it (`_review_target`)."""
    row = await video_or_404(db, video_id, user.id)
    _require_state(row, ("dismissed",), "restore")
    row.status = _review_target(row)
    row.decided_at = datetime.now(UTC)
    await db.commit()
    return await video_out(db, row)


@router.post("/videos/{video_id}/reopen", response_model=SermonSourceVideoOut)
async def reopen_sermon_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonSourceVideoOut:
    """Wrong passage — take back the notes this row made and put it back in the list (spec §8).

    The fix path for the defect the whole feature is most likely to produce: a title that reads as
    a reference and isn't. The live audit found one — a date behind a pastor's name resolving to
    sixteen chapters of John — and until now the only way to undo it was to find each note in
    Browse and delete it, leaving the row still claiming to be placed.

    **Only the notes this row made.** Scoped by `source_video_id`, so a note the owner wrote by
    hand on the same sermon — which carries no link to any ledger row — is untouched. The
    suggestions are kept, because they are what the next attempt will be chosen from.
    """
    row = await video_or_404(db, video_id, user.id)
    _require_state(row, ("placed",), "reopen")
    # Loaded and deleted through the ORM, one at a time, NOT with a bulk `delete()`. A bulk delete
    # leaves the rows in `sermon_note_tags` behind — SQLite never enforces the `ON DELETE CASCADE`,
    # because `PRAGMA foreign_keys` is off and songbird never turns it on. Those orphans then sit
    # and wait: SQLite reuses a deleted row's id, so the next note to be given that id collides on
    # (note, tag) and the whole check fails. That is not hypothetical — it happened, on the live
    # acceptance run, and it broke a catalogue scan ten videos in. A video has at most ten notes,
    # so loading them costs nothing.
    doomed = (
        (
            await db.execute(
                select(SermonNote).where(
                    SermonNote.source_video_id == row.id, SermonNote.author_id == user.id
                )
            )
        )
        .scalars()
        .all()
    )
    for note in doomed:
        await db.delete(note)
    row.status = _review_target(row)
    row.placed_by = None
    row.decided_at = datetime.now(UTC)
    await db.commit()
    return await video_out(db, row)


async def reopen_if_last_note(db: AsyncSession, note: SermonNote) -> None:
    """Put a video back in the review list when the last note behind it is deleted.

    Called from the ordinary sermon-note DELETE, before the note goes. Deleting a wrong note from
    Browse is the other half of "Wrong passage", and without this it would leave the video marked
    `placed` with nothing behind it — a row claiming to be done, invisible in the review list, and
    only findable by someone who thought to filter by a state they had no reason to suspect.

    A sibling note surviving means the video is still placed, correctly, on its other passage: the
    row stays as it is. So does a row that is no longer `placed` — reopened already, or dismissed
    since — because putting it back would overrule a decision somebody made after this note.

    An `already_noted` row is deliberately out of reach: nothing links a note to one (spec §13).
    """
    if note.source_video_id is None:
        return
    siblings = (
        await db.execute(
            select(func.count())
            .select_from(SermonNote)
            .where(SermonNote.source_video_id == note.source_video_id, SermonNote.id != note.id)
        )
    ).scalar_one()
    if siblings:
        return
    row = await db.get(SermonSourceVideo, note.source_video_id)
    if row is None or row.status != "placed":
        return
    row.status = _review_target(row)
    row.placed_by = None
    row.decided_at = datetime.now(UTC)
