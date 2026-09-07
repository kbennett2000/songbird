"""Read a YouTube link: the video id in a sermon URL, or the channel/playlist a source names.

Pure — no I/O, no httpx — so `songbird.db.models` can import it to stamp
`sermon_notes.youtube_video_id` on every write without dragging an HTTP client into the model
layer (or into `alembic/env.py`, which imports the models).
"""

import re
from typing import Literal
from urllib.parse import parse_qs, urlsplit

# A YouTube video id is exactly 11 characters of URL-safe base64.
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Hosts we accept, after stripping a leading "www.". `m.` is the mobile site; the bare domain
# and `youtu.be` are the share forms.
_YOUTUBE_HOSTS = frozenset({"youtube.com", "m.youtube.com"})
_SHORT_HOST = "youtu.be"

# Path prefixes on youtube.com whose next segment IS the video id.
_ID_PATH_PREFIXES = frozenset({"live", "shorts", "embed"})


def is_video_id(value: str) -> bool:
    """True if `value` is shaped like a YouTube video id. The 11-character rule lives here and
    nowhere else, so the client and the URL parser cannot disagree about it."""
    return _VIDEO_ID.match(value) is not None


def youtube_video_id(url: str) -> str | None:
    """The video id in `url`, or None if it isn't a link to a single YouTube video.

    Handles every form a sermon link actually arrives in — `watch?v=`, `youtu.be/`, `/live/`,
    `/shorts/`, `/embed/`, with or without `www.`, on `m.youtube.com`, over http or https — and
    ignores the junk that rides along (`&t=`, `?si=`). Anything else (a channel, a playlist, a
    non-YouTube sermon host, a typo) is None, which is a normal answer, not an error.

    Parsing goes through `urlsplit` rather than one big regex because only a real URL parser
    reads `https://www.youtube.com@evil.test/watch?v=…` correctly — the host there is
    `evil.test`, and a regex looking for "youtube.com" anywhere would be fooled.
    """
    try:
        parts = urlsplit(url.strip())
    except ValueError:  # malformed enough that the parser gives up, e.g. "https://[bad"
        return None

    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").removeprefix("www.")  # hostname is lowercased, port stripped
    segments = [s for s in parts.path.split("/") if s]

    if host == _SHORT_HOST:
        # youtu.be/<id> — the id is the whole path, and nothing may follow it.
        if len(segments) != 1:
            return None
        return segments[0] if is_video_id(segments[0]) else None

    if host not in _YOUTUBE_HOSTS:
        return None

    if segments and segments[0] == "watch":
        if len(segments) != 1:
            return None
        values = parse_qs(parts.query).get("v", [])
        if len(values) != 1:
            return None
        return values[0] if is_video_id(values[0]) else None

    # /live/<id>, /shorts/<id>, /embed/<id>
    if len(segments) == 2 and segments[0] in _ID_PATH_PREFIXES:
        return segments[1] if is_video_id(segments[1]) else None

    return None


# The shapes of the three things a source link can name. Each lives in exactly one regex, for the
# same reason `_VIDEO_ID` does: a malformed id caught HERE is a clear message to the person who
# pasted it, instead of a spent quota unit and a vaguer answer from Google.
_HANDLE = re.compile(r"^@[A-Za-z0-9._-]{3,30}$")  # YouTube handles are 3-30 characters
_CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")  # "UC" + 22 = the canonical 24-character id
_PLAYLIST_ID = re.compile(r"^PL[A-Za-z0-9_-]{10,}$")  # both the old 18- and new 34-character forms

# The tabs a channel URL can be copied from. Someone browsing a church's past services copies the
# link from /streams, not from the bare channel page.
_CHANNEL_TABS = frozenset({"videos", "streams", "featured", "live", "playlists", "about"})

# What a source link names: a handle to resolve, a channel id, or a playlist id.
SourceRef = tuple[Literal["handle", "channel", "playlist"], str]


def parse_source_url(url: str) -> SourceRef | None:
    """What channel or playlist `url` names, or None if it names neither (spec §5).

    Returns the KIND alongside the value because the three need different YouTube calls: a
    handle has to be resolved (`channels.list?forHandle=`), a channel id can be fetched
    directly, and a playlist is a different endpoint entirely.

    The old `/c/name` and `/user/name` links are deliberately None. They cannot be resolved
    through the Data API at all, so returning None here is what produces the message asking for
    the channel's @handle link — a real answer rather than a confusing 404 from Google.

    Shares `youtube_video_id`'s `urlsplit` parsing, and for the same reason: only a real URL
    parser reads `https://www.youtube.com@evil.test/@church` correctly (the host is evil.test).
    """
    value = url.strip()
    if not value:
        return None

    # A bare "@handle", typed rather than pasted — the form a person says out loud.
    if _HANDLE.match(value):
        return ("handle", value)

    # Safari and some share sheets copy a URL without its scheme, and people paste what they
    # copied. Supplying the scheme is safe: anything that still isn't a YouTube host is rejected
    # by the host check below.
    if "://" not in value:
        value = f"https://{value}"

    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").removeprefix("www.")
    if host not in _YOUTUBE_HOSTS:
        return None

    # A `list=` anywhere wins, so both `playlist?list=` and a watch URL copied from inside a
    # playlist name the playlist. That is the intent: someone sharing from a "Messages" playlist
    # means the playlist, even though the URL also carries the video they had open.
    lists = parse_qs(parts.query).get("list", [])
    if len(lists) == 1 and _PLAYLIST_ID.match(lists[0]):
        return ("playlist", lists[0])

    segments = [s for s in parts.path.split("/") if s]
    if not segments:
        return None

    if segments[0].startswith("@"):
        # /@handle, optionally on one of the channel's tabs.
        if len(segments) > 2 or (len(segments) == 2 and segments[1] not in _CHANNEL_TABS):
            return None
        return ("handle", segments[0]) if _HANDLE.match(segments[0]) else None

    if segments[0] == "channel" and len(segments) >= 2:
        if len(segments) > 3 or (len(segments) == 3 and segments[2] not in _CHANNEL_TABS):
            return None
        return ("channel", segments[1]) if _CHANNEL_ID.match(segments[1]) else None

    return None
