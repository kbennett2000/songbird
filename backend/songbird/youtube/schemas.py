"""Pydantic models for the YouTube Data API responses songbird parses.

Only the fields songbird uses are modelled; YouTube returns a great deal more (Pydantic ignores
unknown fields by default). Two things differ from `concord/schemas.py`: the wire is camelCase
(hence the alias generator), and it is deeply nested — `items[].snippet.title`,
`items[].contentDetails.duration` — so private `_Wire*` models mirror that shape and the public
`Video` is flattened, the way `RandomVerse.parse_concord` flattens Concord's `/v1/random`.
"""

import re
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

# ISO-8601 durations as YouTube writes them: PT1H23M4S, PT45M, P0D, P1DT2H3M4S, PT1H23M4.5S.
# Anchored, every unit optional — but the `(?!$)` guards reject the degenerate "P" and "PT",
# which would otherwise parse as zero and be indistinguishable from a real P0D.
_DURATION = re.compile(
    r"^P(?!$)"
    r"(?:(?P<weeks>\d+(?:\.\d+)?)W)?"
    r"(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T(?!$)"
    r"(?:(?P<hours>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?$"
)

_UNIT_SECONDS: dict[str, int] = {
    "weeks": 604800,
    "days": 86400,
    "hours": 3600,
    "minutes": 60,
    "seconds": 1,
}


def parse_iso8601_duration(value: str | None) -> int | None:
    """Whole seconds in an ISO-8601 duration, or None if there isn't one to read.

    None means *unknown length*, which is not the same as zero: a video whose duration YouTube
    withheld, or wrote in a shape we don't recognise, must not be filed under "too short" — a
    reason it hasn't earned (spec §6). A genuine `PT0S` / `P0D` is 0.
    """
    if not value:
        return None
    match = _DURATION.match(value)
    if match is None:
        return None
    total = 0.0
    for unit, seconds in _UNIT_SECONDS.items():
        raw = match.group(unit)
        if raw is not None:
            total += float(raw) * seconds
    return int(total)


def _as_utc(value: datetime) -> datetime:
    """Normalize to UTC. Pydantic parses YouTube's trailing `Z` to an aware UTC datetime, but an
    explicit offset would stay at that offset and a bare timestamp would come back naive — so
    convert rather than trust the wire."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class _Wire(BaseModel):
    """Base for the wire models: YouTube speaks camelCase, songbird speaks snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _WireSnippet(_Wire):
    title: str
    description: str
    published_at: datetime
    channel_id: str
    channel_title: str
    live_broadcast_content: str = "none"  # "none" | "live" | "upcoming"


class _WireContentDetails(_Wire):
    duration: str | None = None


class _WireLiveStreamingDetails(_Wire):
    # Absent for an ordinary upload, and absent on a stream that never started.
    actual_start_time: datetime | None = None


class _WireVideo(_Wire):
    """One entry of `videos.list`'s `items` array, before flattening. `snippet` and
    `contentDetails` are always present because the client always asks for those parts;
    `liveStreamingDetails` appears only on streams."""

    id: str
    snippet: _WireSnippet
    content_details: _WireContentDetails
    live_streaming_details: _WireLiveStreamingDetails | None = None


class _WireVideoListResponse(_Wire):
    # YouTube omits `items` entirely when nothing matched, rather than sending an empty list.
    items: list[_WireVideo] = []


class Video(BaseModel):
    """One YouTube video, flattened — bookkeeping for songbird's own placement decisions
    (spec §4), not a mirror of YouTube. No Scripture text lives here."""

    id: str
    title: str
    description: str
    published_at: datetime  # aware, UTC — the day the video went up
    live_broadcast_content: str  # "none" | "live" | "upcoming"
    duration_seconds: int | None  # None = unknown length; 0 only for a real PT0S/P0D
    actual_start_time: datetime | None  # aware, UTC — when a livestream actually began
    channel_id: str
    channel_title: str

    @classmethod
    def parse_youtube(cls, payload: object) -> list["Video"]:
        """Validate a `videos.list` body and flatten every item into a `Video`."""
        wire = _WireVideoListResponse.model_validate(payload)
        return [
            cls(
                id=item.id,
                title=item.snippet.title,
                description=item.snippet.description,
                published_at=_as_utc(item.snippet.published_at),
                live_broadcast_content=item.snippet.live_broadcast_content,
                duration_seconds=parse_iso8601_duration(item.content_details.duration),
                actual_start_time=(
                    _as_utc(item.live_streaming_details.actual_start_time)
                    if item.live_streaming_details is not None
                    and item.live_streaming_details.actual_start_time is not None
                    else None
                ),
                channel_id=item.snippet.channel_id,
                channel_title=item.snippet.channel_title,
            )
            for item in wire.items
        ]
