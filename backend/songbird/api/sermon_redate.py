"""Re-dating existing sermon notes from YouTube (v1.7 sermon sources, spec §11).

A one-time cleanup that stays available: sermon notes made by hand carry whatever date was typed,
which is usually the day the note was written rather than the day the sermon was preached. Spec §7
sets one rule — the UTC calendar day of `liveStreamingDetails.actualStartTime` when the video has
one, else `snippet.publishedAt` — and this applies it backwards.

It lives beside `sermon_notes.py` rather than in it because it is the only sermon-note route that
talks to YouTube; keeping it out leaves the CRUD module Concord-only, and slice 3's sources API is
this module's natural neighbour.

**Preview then apply.** `dry_run` defaults to `true` — the safe direction — and in that mode the
request writes nothing at all, not even the `youtube_video_id` stamp. Applying collects every
lookup first and writes in a single commit, so a failure part-way through leaves the notes exactly
as they were. Re-running is a no-op that reports zero changed.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_current_user, get_db, get_youtube_client
from songbird.api.schemas import RedateItem, RedateNotFound, RedateResult
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, User
from songbird.sermons.dates import sermon_date
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeClient,
    YouTubeError,
    YouTubeQuotaError,
)
from songbird.youtube.schemas import Video
from songbird.youtube.urls import youtube_video_id

router = APIRouter(prefix="/api/v1/sermon-notes", tags=["sermon-notes"])

# What to tell an admin when Google refuses the key. Names the setting, never the value — the key
# is a secret and this string reaches the browser.
_KEY_REJECTED = (
    "YouTube rejected the API key. Check YOUTUBE_API_KEY in songbird's configuration — it may be "
    "wrong, restricted to other APIs or referrers, or the YouTube Data API may not be enabled "
    "for it."
)


@router.post("/redate", response_model=RedateResult)
async def redate_sermon_notes(
    dry_run: bool = True,
    db: AsyncSession = Depends(get_db),
    youtube: YouTubeClient = Depends(get_youtube_client),
    user: User = Depends(get_current_user),
) -> RedateResult:
    """Re-date the current user's YouTube-linked sermon notes (spec §11).

    `dry_run=true` (the default) returns the preview and writes nothing. `dry_run=false` sets
    `event_date` on every note YouTube could tell us about, and stamps `youtube_video_id` on every
    YouTube-linked note — including the ones YouTube couldn't find, because that id comes from the
    URL, not from YouTube, and it is what lets a later catalog scan recognise the video as already
    noted.
    """
    # Same ordering as the sermon-note list, so the preview reads in the order the Browse page
    # shows and a reader can follow one against the other.
    stmt = (
        select(SermonNote)
        .where(SermonNote.author_id == user.id)
        .order_by(
            SermonNote.book_order_index,
            SermonNote.start_chapter,
            SermonNote.start_verse,
            SermonNote.id,
        )
    )
    notes = (await db.execute(stmt)).scalars().unique().all()

    # A sermon hosted anywhere else is perfectly valid — it just isn't ours to re-date.
    candidates: list[tuple[SermonNote, str]] = []
    skipped_non_youtube = 0
    for note in notes:
        video_id = youtube_video_id(note.sermon_url)
        if video_id is None:
            skipped_non_youtube += 1
        else:
            candidates.append((note, video_id))

    videos: dict[str, Video] = {}
    if candidates:  # don't ask YouTube about nothing (the client batches 50 ids per call)
        try:
            found = await youtube.get_videos([vid for _, vid in candidates])
        except YouTubeQuotaError as exc:
            raise_http(429, ErrorCode.YOUTUBE_QUOTA, str(exc))
        except YouTubeAuthError as exc:
            detail = _KEY_REJECTED
            if exc.reason:  # e.g. API_KEY_INVALID — Google's token, never the key itself
                detail = f"{detail} (YouTube said: {exc.reason})"
            raise_http(502, ErrorCode.YOUTUBE_KEY_REJECTED, detail)
        except YouTubeError as exc:
            # Everything else — the network, a 5xx, an unclassified status. Recorded, not fatal.
            raise_http(502, ErrorCode.YOUTUBE_UNREACHABLE, str(exc))
        videos = {v.id: v for v in found}

    items: list[RedateItem] = []
    not_found: list[RedateNotFound] = []
    for note, video_id in candidates:
        video = videos.get(video_id)
        if video is None:
            not_found.append(
                RedateNotFound(
                    id=note.id,
                    title=note.title,
                    reference=note.reference,
                    sermon_url=note.sermon_url,
                    video_id=video_id,
                )
            )
            continue
        new_date, date_source = sermon_date(video)
        items.append(
            RedateItem(
                id=note.id,
                title=note.title,
                reference=note.reference,
                sermon_url=note.sermon_url,
                video_id=video_id,
                current_date=note.event_date,
                new_date=new_date,
                date_source=date_source,
                changed=new_date != note.event_date,
            )
        )

    applied = 0
    if not dry_run:
        # Every lookup is already done, so the whole write is one commit: a failure mid-flight
        # leaves the notes untouched rather than half re-dated.
        by_id = {item.id: item for item in items}
        for note, video_id in candidates:
            # Written straight to the column, not via `sermon_url` — the model's validator fires
            # on the URL, and this value is the same one it would derive anyway.
            if note.youtube_video_id != video_id:
                note.youtube_video_id = video_id
            item = by_id.get(note.id)
            if item is not None and note.event_date != item.new_date:
                # Guarded so a second apply emits no UPDATE at all, which keeps `updated_at`
                # honest: a re-run must not bump the timestamp of a note it didn't change.
                note.event_date = item.new_date
                applied += 1
        await db.commit()

    return RedateResult(
        dry_run=dry_run,
        total_youtube_notes=len(candidates),
        items=items,
        not_found=not_found,
        skipped_non_youtube=skipped_non_youtube,
        applied=applied,
    )
