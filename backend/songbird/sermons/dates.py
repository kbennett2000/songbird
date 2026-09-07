"""The day a sermon happened (v1.7 sermon sources, spec §7). Pure — no I/O.

One rule, in one place, because three things now need it: the re-date action applying it backwards
to notes made by hand (§11), the ledger showing a reader the day their church's own page shows, and
the check that creates a note in the first place. §11's promise is literally that it is "the same
rule" — so it had better be the same function.
"""

from datetime import date, datetime
from typing import Literal

from songbird.youtube.schemas import Video

DateSource = Literal["stream_start", "published"]


def sermon_day(
    actual_start_time: datetime | None, published_at: datetime
) -> tuple[date, DateSource]:
    """The UTC calendar day a sermon happened, and which timestamp decided it.

    A livestreamed service's actual start IS the service, so it wins whenever YouTube recorded one;
    an ordinary upload only has the day it was published. The two genuinely disagree, and usually
    by a day: a service streamed at 14:55 UTC on the Sunday is routinely published at 04:32 on the
    Monday, so `published_at` alone files a Sunday sermon under Monday. YouTube's own page says
    "Streamed live on Sep 6" — this is what makes songbird agree with what a reader sees there.

    Both timestamps hold UTC, whether they arrive from the YouTube client (which normalizes them)
    or back out of SQLite (which drops the tzinfo and hands back a naive value). `.date()` is
    therefore the UTC calendar day either way, and nothing here may assume a tzinfo is present.
    """
    if actual_start_time is not None:
        return actual_start_time.date(), "stream_start"
    return published_at.date(), "published"


def sermon_date(video: Video) -> tuple[date, DateSource]:
    """`sermon_day` for a video fresh from YouTube, which is how the re-date action asks."""
    return sermon_day(video.actual_start_time, video.published_at)
