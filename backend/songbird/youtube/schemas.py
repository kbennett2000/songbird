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


class _WireTitleSnippet(_Wire):
    """A channel's or a playlist's snippet, of which songbird wants only the name to show. It
    cannot borrow `_WireSnippet`: neither carries the `channelId`/`publishedAt`/`description`
    trio a video's snippet always has."""

    title: str


class _WireRelatedPlaylists(_Wire):
    # The auto-generated lists a channel keeps. `uploads` is the one that matters — the UU… list
    # holding everything the channel has ever posted, which is what a scan reads.
    uploads: str | None = None


class _WireChannelContentDetails(_Wire):
    related_playlists: _WireRelatedPlaylists = _WireRelatedPlaylists()


class _WireChannel(_Wire):
    id: str
    snippet: _WireTitleSnippet
    content_details: _WireChannelContentDetails = _WireChannelContentDetails()


class _WireChannelListResponse(_Wire):
    # As with videos, YouTube omits `items` entirely when nothing matched.
    items: list[_WireChannel] = []


class _WirePlaylist(_Wire):
    id: str
    snippet: _WireTitleSnippet


class _WirePlaylistListResponse(_Wire):
    items: list[_WirePlaylist] = []


class _WirePlaylistItemContentDetails(_Wire):
    video_id: str
    # Absent when the entry points at a video that has since gone private or been deleted: the
    # playlist entry survives, the video it names does not.
    video_published_at: datetime | None = None


class _WirePlaylistItem(_Wire):
    """One entry of `playlistItems.list`. Only `contentDetails` is asked for — see `PlaylistPage`
    for why the snippet is deliberately left on the table."""

    content_details: _WirePlaylistItemContentDetails


class _WirePlaylistItemListResponse(_Wire):
    items: list[_WirePlaylistItem] = []
    # Absent on the last page, which is how paging knows to stop.
    next_page_token: str | None = None


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
    # Whether YouTube sent a `liveStreamingDetails` block at all — i.e. this was streamed rather
    # than uploaded. NOT the same question as `actual_start_time is not None`: spec §6's
    # `live_excluded` filter tests the block's PRESENCE, and a stream can carry the block with no
    # start time recorded in it. Premieres carry it too, so a source with `include_live` off
    # excludes those as well — deliberate, and why this is named for the block rather than for
    # "was a service".
    is_livestream: bool
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
                is_livestream=item.live_streaming_details is not None,
                channel_id=item.snippet.channel_id,
                channel_title=item.snippet.channel_title,
            )
            for item in wire.items
        ]


class Channel(BaseModel):
    """One YouTube channel, flattened — the address of a catalogue, not a copy of it.

    `uploads_playlist_id` is optional HERE and required by the client. Modelling it as required
    would turn a channel that somehow lacks one into a pydantic ValidationError, i.e. a 500;
    modelling it as optional lets the client raise a plain, explainable failure instead.
    """

    id: str
    title: str
    uploads_playlist_id: str | None

    @classmethod
    def parse_youtube(cls, payload: object) -> list["Channel"]:
        """Validate a `channels.list` body and flatten every item into a `Channel`."""
        wire = _WireChannelListResponse.model_validate(payload)
        return [
            cls(
                id=item.id,
                title=item.snippet.title,
                # `or None`: Google writes the unset related playlists as "", not as absent.
                uploads_playlist_id=item.content_details.related_playlists.uploads or None,
            )
            for item in wire.items
        ]


class Playlist(BaseModel):
    """One YouTube playlist. A playlist IS its own catalogue, so there is no second id to keep —
    the difference from `Channel` that makes `uploads_playlist_id` channels-only (spec §4)."""

    id: str
    title: str

    @classmethod
    def parse_youtube(cls, payload: object) -> list["Playlist"]:
        """Validate a `playlists.list` body and flatten every item into a `Playlist`."""
        wire = _WirePlaylistListResponse.model_validate(payload)
        return [cls(id=item.id, title=item.snippet.title) for item in wire.items]


class PlaylistItem(BaseModel):
    """One entry in a playlist: the video it points at, and the day that video went up."""

    video_id: str
    published_at: datetime | None  # aware, UTC — None for a private or deleted video


class PlaylistPage(BaseModel):
    """One page of a playlist's contents — up to 50 entries, and how to ask for the next page.

    Ids and dates only, on purpose. `playlistItems` will also return a snippet, and songbird
    ignores it: that snippet describes the playlist ENTRY, so it goes stale when a video is
    retitled, and it carries neither `contentDetails.duration` nor `liveStreamingDetails` — the
    two fields every filter in spec §6 turns on. `videos.list` is the source of truth for what a
    video *is*; this is only the feed of what to ask about, at one quota unit per fifty.

    `parse_youtube` returns ONE page rather than a list, unlike its siblings here: a page is a
    single thing with a cursor attached, not a collection of them.
    """

    items: list[PlaylistItem]
    next_page_token: str | None

    @property
    def video_ids(self) -> list[str]:
        """The ids on this page, in the order YouTube listed them (newest first for an uploads
        playlist; the curator's order for a hand-made one)."""
        return [item.video_id for item in self.items]

    @classmethod
    def parse_youtube(cls, payload: object) -> "PlaylistPage":
        """Validate a `playlistItems.list` body into a page."""
        wire = _WirePlaylistItemListResponse.model_validate(payload)
        return cls(
            items=[
                PlaylistItem(
                    video_id=item.content_details.video_id,
                    published_at=(
                        _as_utc(item.content_details.video_published_at)
                        if item.content_details.video_published_at is not None
                        else None
                    ),
                )
                for item in wire.items
            ],
            next_page_token=wire.next_page_token,
        )
