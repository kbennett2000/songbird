"""Pull a YouTube video id out of a sermon URL.

Pure — no I/O, no httpx — so `songbird.db.models` can import it to stamp
`sermon_notes.youtube_video_id` on every write without dragging an HTTP client into the model
layer (or into `alembic/env.py`, which imports the models).
"""

import re
from urllib.parse import parse_qs, urlsplit

# A YouTube video id is exactly 11 characters of URL-safe base64.
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Hosts we accept, after stripping a leading "www.". `m.` is the mobile site; the bare domain
# and `youtu.be` are the share forms.
_WATCH_HOSTS = frozenset({"youtube.com", "m.youtube.com"})
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

    if host not in _WATCH_HOSTS:
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
