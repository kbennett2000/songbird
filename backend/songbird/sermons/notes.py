"""Building the sermon note a ledger row produces (v1.7 sermon sources, spec §7-8).

One function, and it exists so there is exactly one answer to "what does a note made from a video
look like?". The catalogue scan calls it for a passage it read out of the sermon's own words; the
review list calls it for a passage a person tapped. **Those two notes must be identical in every
field but the row's own `placed_by`** — a note placed by hand is not a lesser note, and a reader
scrolling Browse must not be able to tell which is which.

Pure construction: no session, no Concord, no commit. The anchor arrives already resolved (only
Concord may say what a reference means, invariant 4) and the book's canonical order already looked
up, because the scan answers that from a cache it fills once per run and a request has nothing to
cache.
"""

from songbird.db.models import SermonNote, SermonSourceVideo, Tag
from songbird.sermons.anchor import ResolvedSpan
from songbird.sermons.dates import sermon_day


def build_sermon_note(
    row: SermonSourceVideo,
    span: ResolvedSpan,
    book_order_index: int,
    tags: list[Tag],
) -> SermonNote:
    """The sermon note this video, on this passage, becomes.

    Not added to a session and not committed — the caller owns the transaction, because the scan
    commits one video at a time and a place request commits one row's worth of notes at once.
    """
    event_date, _ = sermon_day(row.actual_start_time, row.published_at)
    return SermonNote(
        title=row.title,
        # Setting the URL is what stamps `youtube_video_id`, through the model's own validator —
        # so a later check sees this video as already noted.
        sermon_url=f"https://www.youtube.com/watch?v={row.video_id}",
        # Concord's spelling, not the church's: `2 Cor 5:17` is stored as `2 Corinthians 5:17`,
        # so notes from four sources read alike.
        reference=span.reference,
        book_usfm=span.book_usfm,
        book_order_index=book_order_index,
        start_chapter=span.first.chapter,
        start_verse=span.first.verse,
        end_chapter=span.last.chapter,
        end_verse=span.last.verse,
        event_date=event_date,
        author_id=row.author_id,
        source_video_id=row.id,
        tags=tags,
    )
