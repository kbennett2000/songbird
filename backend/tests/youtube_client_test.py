"""Unit tests for the YouTube client's batching, parsing, error mapping and — above all — its
handling of the API key, using httpx's built-in MockTransport (no live YouTube, no network).

The key is a secret (spec §2). Three separate mechanisms keep it out of sight, and each is
tested here, because two of them are invisible in ordinary use and would rot unnoticed.
"""

import logging
import traceback
from datetime import UTC, datetime

import httpx
import pytest
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeClient,
    YouTubeError,
    YouTubeNotFoundError,
    YouTubeQuotaError,
    YouTubeUnreachableError,
)
from songbird.youtube.schemas import parse_iso8601_duration

# A realistic-looking key: Google's are 39 characters of [A-Za-z0-9_-] starting "AIza".
_KEY = "AIzaSyA0000000000000000000000000000000b"

_ID = "dQw4w9WgXcQ"
_ID2 = "abcdefghijk"


def _video_json(
    video_id: str = _ID,
    *,
    duration: str | None = "PT1H23M4S",
    started: str | None = None,
    live: str = "none",
    stream: bool = False,
) -> dict[str, object]:
    """One `videos.list` item in YouTube's real (camelCase, deeply nested) shape."""
    item: dict[str, object] = {
        "id": video_id,
        "snippet": {
            "title": f"Sermon {video_id}",
            "description": "Main Scripture: Acts 7:33-35",
            "publishedAt": "2026-01-05T14:00:00Z",
            "channelId": "UC_channel",
            "channelTitle": "A Church",
            "liveBroadcastContent": live,
        },
        "contentDetails": {} if duration is None else {"duration": duration},
    }
    # `started` implies a stream; `stream` alone gives the block WITHOUT a start time, which is
    # the shape that separates "was streamed" from "we know when it began".
    if started is not None or stream:
        item["liveStreamingDetails"] = {} if started is None else {"actualStartTime": started}
    return item


def _ok(*items: dict[str, object]) -> dict[str, object]:
    return {"items": list(items)}


def _client(handler: object) -> YouTubeClient:
    return YouTubeClient(_KEY, transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


# ---- 1. The request shape ------------------------------------------------------------------


async def test_get_videos_sends_the_key_and_the_three_parts() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        for k in ("key", "part", "id"):
            seen[k] = request.url.params.get(k, "<absent>")
        return httpx.Response(200, json=_ok(_video_json()))

    client = _client(handler)
    await client.get_videos([_ID])
    await client.aclose()
    assert seen == {
        "path": "/youtube/v3/videos",
        "key": _KEY,
        "part": "snippet,contentDetails,liveStreamingDetails",
        "id": _ID,
    }


async def test_no_ids_makes_no_request_at_all() -> None:
    # An empty batch must not spend a quota unit saying nothing.
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=_ok())

    client = _client(handler)
    assert await client.get_videos([]) == []
    await client.aclose()
    assert calls == []


async def test_ids_that_are_not_video_ids_are_dropped_before_the_call() -> None:
    # A stray value (a channel id, a typo) must not turn the whole batch into a 400.
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=_ok(_video_json()))

    client = _client(handler)
    await client.get_videos(["UC_not_a_video", "", _ID, "toolongtobeanid!!"])
    await client.aclose()
    assert len(calls) == 1
    assert calls[0].url.params.get("id") == _ID


async def test_more_than_fifty_ids_are_split_into_two_requests() -> None:
    ids = [f"vid{n:08d}" for n in range(51)]  # 11 chars each
    batches: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        batch = (request.url.params.get("id") or "").split(",")
        batches.append(batch)
        # Every request must carry the key and the parts, not just the first.
        assert request.url.params.get("key") == _KEY
        assert request.url.params.get("part") == "snippet,contentDetails,liveStreamingDetails"
        return httpx.Response(200, json=_ok(*(_video_json(v) for v in batch)))

    client = _client(handler)
    videos = await client.get_videos(ids)
    await client.aclose()
    assert [len(b) for b in batches] == [50, 1]
    assert batches[0] + batches[1] == ids
    assert [v.id for v in videos] == ids


async def test_duplicate_ids_are_asked_for_once() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["id"] = request.url.params.get("id") or ""
        return httpx.Response(200, json=_ok(_video_json()))

    client = _client(handler)
    videos = await client.get_videos([_ID, _ID, _ID])
    await client.aclose()
    assert seen["id"] == _ID
    assert [v.id for v in videos] == [_ID]


# ---- 2. The response ------------------------------------------------------------------------


async def test_videos_come_back_in_the_order_asked_for() -> None:
    # YouTube does not promise an order; a caller matching results back to a ledger needs one.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_video_json(_ID2), _video_json(_ID)))

    client = _client(handler)
    videos = await client.get_videos([_ID, _ID2])
    await client.aclose()
    assert [v.id for v in videos] == [_ID, _ID2]


async def test_a_stream_is_marked_even_when_its_start_time_is_missing() -> None:
    """The distinction spec §6's `live_excluded` filter actually turns on.

    The filter asks whether YouTube sent a `liveStreamingDetails` block at all — was this
    streamed? — and a block can arrive with no `actualStartTime` in it. Reading the flag off the
    start time instead would let such a video through a source that has livestreams switched off.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_ok(
                _video_json(_ID, stream=True),  # streamed, no start time recorded
                _video_json(_ID2, started="2026-09-06T14:55:12Z"),  # streamed, start recorded
            ),
        )

    client = _client(handler)
    videos = await client.get_videos([_ID, _ID2])
    await client.aclose()
    assert [v.is_livestream for v in videos] == [True, True]
    # …and the two are genuinely different states, which is why one flag cannot stand for both.
    assert videos[0].actual_start_time is None
    assert videos[1].actual_start_time == datetime(2026, 9, 6, 14, 55, 12, tzinfo=UTC)


async def test_an_ordinary_upload_is_not_a_stream() -> None:
    # The other half of the pair: no block at all means it was uploaded, and a source with
    # livestreams off must still collect it.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_video_json(_ID)))

    client = _client(handler)
    videos = await client.get_videos([_ID])
    await client.aclose()
    assert videos[0].is_livestream is False


async def test_ids_youtube_does_not_return_are_simply_absent() -> None:
    # Private and deleted videos are a normal part of a back catalogue, not an error.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_video_json(_ID)))

    client = _client(handler)
    videos = await client.get_videos([_ID, _ID2])
    await client.aclose()
    assert [v.id for v in videos] == [_ID]


async def test_snippet_fields_and_utc_published_at_are_parsed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_video_json()))

    client = _client(handler)
    video = (await client.get_videos([_ID]))[0]
    await client.aclose()
    assert video.title == f"Sermon {_ID}"
    assert video.description == "Main Scripture: Acts 7:33-35"
    assert video.channel_id == "UC_channel"
    assert video.channel_title == "A Church"
    assert video.live_broadcast_content == "none"
    assert video.published_at.isoformat() == "2026-01-05T14:00:00+00:00"
    assert video.published_at.utcoffset() is not None  # aware, not naive


async def test_actual_start_time_present_and_absent() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_ok(
                _video_json(_ID, started="2026-01-05T13:30:00Z", live="none"),
                _video_json(_ID2),  # an ordinary upload has no liveStreamingDetails at all
            ),
        )

    client = _client(handler)
    streamed, uploaded = await client.get_videos([_ID, _ID2])
    await client.aclose()
    assert streamed.actual_start_time is not None
    assert streamed.actual_start_time.isoformat() == "2026-01-05T13:30:00+00:00"
    assert uploaded.actual_start_time is None


async def test_duration_is_parsed_and_unknown_stays_unknown() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_ok(_video_json(_ID, duration="PT1H23M4S"), _video_json(_ID2, duration=None)),
        )

    client = _client(handler)
    long_one, unknown = await client.get_videos([_ID, _ID2])
    await client.aclose()
    assert long_one.duration_seconds == 4984
    # None, NOT 0: a video of unknown length must not be filed under "too short" (spec §6).
    assert unknown.duration_seconds is None


def test_iso8601_durations() -> None:
    for value, expected in (
        ("PT1H23M4S", 4984),
        ("PT45M", 2700),
        ("PT10S", 10),
        ("PT1H", 3600),
        ("P1DT2H3M4S", 93784),
        ("PT25H30M", 91800),  # YouTube does not normalise hours into days
        ("P1W", 604800),
        ("PT1H23M4.5S", 4984),  # fractional seconds truncate
        ("P0D", 0),  # a real zero — what YouTube sends for a live/upcoming video
        ("PT0S", 0),
    ):
        assert parse_iso8601_duration(value) == expected, value

    for junk in (None, "", "P", "PT", "banana", "-PT1H", "1H30M", "PT1H30"):
        assert parse_iso8601_duration(junk) is None, junk


# ---- 3. Error mapping ------------------------------------------------------------------------


def _error_body(reason: str, code: int) -> dict[str, object]:
    """Google's error envelope, as the Data API actually sends it."""
    return {"error": {"errors": [{"reason": reason, "message": "..."}], "code": code}}


async def test_connect_error_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    client = _client(handler)
    with pytest.raises(YouTubeUnreachableError):
        await client.get_videos([_ID])
    await client.aclose()


async def test_server_error_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream is having a day")

    client = _client(handler)
    with pytest.raises(YouTubeUnreachableError) as caught:
        await client.get_videos([_ID])
    await client.aclose()
    assert caught.value.status == 503


async def test_quota_exceeded_is_a_quota_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json=_error_body("quotaExceeded", 403))

    client = _client(handler)
    with pytest.raises(YouTubeQuotaError) as caught:
        await client.get_videos([_ID])
    await client.aclose()
    assert caught.value.reason == "quotaExceeded"


async def test_daily_limit_exceeded_is_also_a_quota_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json=_error_body("dailyLimitExceeded", 403))

    client = _client(handler)
    with pytest.raises(YouTubeQuotaError):
        await client.get_videos([_ID])
    await client.aclose()


async def test_a_different_403_is_an_auth_error() -> None:
    # A restricted key, or the Data API not enabled — a human has to fix it; retrying won't.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json=_error_body("ipRefererBlocked", 403))

    client = _client(handler)
    with pytest.raises(YouTubeAuthError) as caught:
        await client.get_videos([_ID])
    await client.aclose()
    assert caught.value.reason == "ipRefererBlocked"


async def test_bad_key_400_is_an_auth_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=_error_body("keyInvalid", 400))

    client = _client(handler)
    with pytest.raises(YouTubeAuthError):
        await client.get_videos([_ID])
    await client.aclose()


async def test_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json=_error_body("notFound", 404))

    client = _client(handler)
    with pytest.raises(YouTubeNotFoundError):
        await client.get_videos([_ID])
    await client.aclose()


# The body Google actually returns for a rejected key, captured live on 2026-09-07 by calling
# `videos.list` with a deliberately junk key. The useful token is in `details[]`; `errors[]` says
# only "badRequest", and one `details[]` entry carries no reason at all.
_REJECTED_KEY_BODY: dict[str, object] = {
    "error": {
        "code": 400,
        "message": "API key not valid. Please pass a valid API key.",
        "errors": [
            {
                "message": "API key not valid. Please pass a valid API key.",
                "domain": "global",
                "reason": "badRequest",
            }
        ],
        "status": "INVALID_ARGUMENT",
        "details": [
            {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                "reason": "API_KEY_INVALID",
                "domain": "googleapis.com",
                "metadata": {"service": "youtube.googleapis.com"},
            },
            {
                "@type": "type.googleapis.com/google.rpc.LocalizedMessage",
                "locale": "en-US",
                "message": "API key not valid. Please pass a valid API key.",
            },
        ],
    }
}


async def test_the_specific_reason_from_details_reaches_the_message() -> None:
    # `errors[].reason` alone would say "badRequest", which tells an admin nothing. The reason
    # that names the fault lives in `details[]`, so both are read and both are reported.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=_REJECTED_KEY_BODY)

    client = _client(handler)
    with pytest.raises(YouTubeAuthError) as caught:
        await client.get_videos([_ID])
    await client.aclose()
    assert "API_KEY_INVALID" in str(caught.value)
    assert "badRequest" in str(caught.value)
    # And the scalar reports the SPECIFIC one — an admin shown "badRequest" learns nothing.
    assert caught.value.reason == "API_KEY_INVALID"


async def test_a_quota_reason_only_in_details_still_maps_to_quota() -> None:
    # Today YouTube puts `quotaExceeded` in `errors[]`. If it ever moves to the modern
    # `details[]` shape the mapping must not quietly become "the key is bad".
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "errors": [{"reason": "forbidden"}],
                    "details": [{"reason": "dailyLimitExceeded"}],
                }
            },
        )

    client = _client(handler)
    with pytest.raises(YouTubeQuotaError):
        await client.get_videos([_ID])
    await client.aclose()


async def test_an_unparseable_error_body_still_maps_by_status() -> None:
    # Reason-reading runs while handling an error and must never raise one of its own.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="<html>not json at all</html>")

    client = _client(handler)
    with pytest.raises(YouTubeAuthError) as caught:
        await client.get_videos([_ID])
    await client.aclose()
    assert caught.value.reason is None


# ---- 4. The key is a secret ------------------------------------------------------------------


async def test_the_key_never_appears_in_a_raised_error() -> None:
    """The whole rendered traceback, not just str(exc).

    httpx puts the full request URL — key and all — into HTTPStatusError's message. Chaining
    with `from exc` would keep that reachable, and `logger.exception` renders the chain. So the
    assertion has to cover what a log would actually print.
    """
    failures: list[object] = [
        httpx.Response(403, json=_error_body("quotaExceeded", 403)),
        httpx.Response(400, json=_error_body("keyInvalid", 400)),
        httpx.Response(404, json=_error_body("notFound", 404)),
        httpx.Response(500, text="boom"),
        None,  # a transport failure rather than a status
    ]
    for failure in failures:

        def handler(request: httpx.Request, _f: object = failure) -> httpx.Response:
            if _f is None:
                raise httpx.ConnectError("nope", request=request)
            assert isinstance(_f, httpx.Response)
            return _f

        client = _client(handler)
        with pytest.raises(Exception) as caught:
            await client.get_videos([_ID])
        await client.aclose()
        rendered = "".join(traceback.format_exception(caught.value))
        assert _KEY not in rendered, failure
        assert "AIza" not in rendered, failure  # nothing key-shaped survived at all
        # The cause is suppressed, which is *why* the above holds.
        assert caught.value.__cause__ is None
        assert caught.value.__suppress_context__


async def test_the_key_never_reaches_a_log_line(caplog: pytest.LogCaptureFixture) -> None:
    """httpx logs the full request URL at INFO on every SUCCESSFUL call, and create_app() calls
    logging.basicConfig(level=INFO) — so without the client's filter, a working deployment
    prints the key on every request. Note the level is set on the root logger with no `logger=`
    argument: scoping it to "songbird" would make this test unable to fail, since the logger
    that leaks is httpx's."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_video_json()))

    client = _client(handler)
    with caplog.at_level(logging.DEBUG):
        await client.get_videos([_ID])
    await client.aclose()

    assert caplog.text  # the httpx request line was actually captured
    assert _KEY not in caplog.text
    assert "key=REDACTED" in caplog.text


async def test_the_log_filter_installs_once_and_spares_other_hosts() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok())

    before = len(logging.getLogger("httpx").filters)
    first = _client(handler)
    second = _client(handler)
    after = len(logging.getLogger("httpx").filters)
    await first.aclose()
    await second.aclose()
    # Two clients, at most one filter added — duplicates would compound on every rebuild.
    assert after - before <= 1

    # A Concord request through the same logger is untouched: no key, nothing to redact.
    record = logging.LogRecord(
        "httpx",
        logging.INFO,
        __file__,
        1,
        'HTTP Request: GET http://concord.test/v1/books "200 OK"',
        (),
        None,
    )
    for log_filter in logging.getLogger("httpx").filters:
        assert log_filter.filter(record)  # type: ignore[union-attr]
    assert record.getMessage() == 'HTTP Request: GET http://concord.test/v1/books "200 OK"'


# ---- 6. Channels and playlists (v1.7 slice 3) ----------------------------------------------
#
# Registering a source resolves the pasted link through YouTube once, then stores the ids. These
# cover the request shape, the flattening, and — above all — the two ways a lookup fails without
# YouTube saying so in the status code.

_HANDLE = "@cornerstonechpl"
_CHANNEL_ID = "UCa1b2c3d4e5f6g7h8i9j0k1"
_UPLOADS_ID = "UUa1b2c3d4e5f6g7h8i9j0k1"
_PLAYLIST_ID = "PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t"


def _channel_json(
    channel_id: str = _CHANNEL_ID,
    *,
    title: str = "Cornerstone Chapel",
    uploads: str | None = _UPLOADS_ID,
) -> dict[str, object]:
    """One `channels.list` item in YouTube's real shape — including the `likes: ""` sibling,
    which is how Google writes a related playlist that isn't set."""
    related: dict[str, str] = {"likes": ""}
    if uploads is not None:
        related["uploads"] = uploads
    return {
        "kind": "youtube#channel",
        "id": channel_id,
        "snippet": {
            "title": title,
            "description": "A church.",
            "customUrl": _HANDLE,
            "publishedAt": "2012-03-04T05:06:07Z",
        },
        "contentDetails": {"relatedPlaylists": related},
    }


def _playlist_json(
    playlist_id: str = _PLAYLIST_ID, *, title: str = "Sunday Teaching"
) -> dict[str, object]:
    return {
        "kind": "youtube#playlist",
        "id": playlist_id,
        "snippet": {"title": title, "channelTitle": "Cornerstone Chapel"},
    }


async def test_resolving_a_handle_sends_forhandle_and_both_parts() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        for k in ("key", "part", "forHandle"):
            seen[k] = request.url.params.get(k, "<absent>")
        return httpx.Response(200, json=_ok(_channel_json()))

    client = _client(handler)
    channel = await client.resolve_channel_by_handle(_HANDLE)
    await client.aclose()
    assert seen == {
        "path": "/youtube/v3/channels",
        "key": _KEY,
        "part": "snippet,contentDetails",
        # Sent WITH the @ — the form the parser produces and the form Google documents.
        "forHandle": _HANDLE,
    }
    assert channel.id == _CHANNEL_ID
    assert channel.title == "Cornerstone Chapel"
    assert channel.uploads_playlist_id == _UPLOADS_ID


async def test_getting_a_channel_by_id_sends_id_not_forhandle() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        for k in ("part", "id", "forHandle"):
            seen[k] = request.url.params.get(k, "<absent>")
        return httpx.Response(200, json=_ok(_channel_json()))

    client = _client(handler)
    channel = await client.get_channel(_CHANNEL_ID)
    await client.aclose()
    assert seen == {"part": "snippet,contentDetails", "id": _CHANNEL_ID, "forHandle": "<absent>"}
    assert channel.id == _CHANNEL_ID


async def test_getting_a_playlist_asks_only_for_the_snippet() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        for k in ("part", "id"):
            seen[k] = request.url.params.get(k, "<absent>")
        return httpx.Response(200, json=_ok(_playlist_json()))

    client = _client(handler)
    playlist = await client.get_playlist(_PLAYLIST_ID)
    await client.aclose()
    assert seen == {"path": "/youtube/v3/playlists", "part": "snippet", "id": _PLAYLIST_ID}
    assert playlist.id == _PLAYLIST_ID
    assert playlist.title == "Sunday Teaching"


async def test_an_unknown_handle_is_not_found_even_though_the_status_is_200() -> None:
    # THE case that matters. Google answers an unknown handle with 200 and no items, so a client
    # that only mapped status codes would report success and store a source that isn't there.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"kind": "youtube#channelListResponse", "items": []})

    client = _client(handler)
    with pytest.raises(YouTubeNotFoundError) as caught:
        await client.resolve_channel_by_handle("@nosuchchannelanywhere")
    await client.aclose()
    assert "@nosuchchannelanywhere" in str(caught.value)


async def test_an_unknown_channel_id_and_playlist_id_are_also_not_found() -> None:
    # Google omits `items` entirely rather than sending an empty list, so both shapes are covered.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"kind": "youtube#channelListResponse"})

    client = _client(handler)
    with pytest.raises(YouTubeNotFoundError):
        await client.get_channel(_CHANNEL_ID)
    with pytest.raises(YouTubeNotFoundError):
        await client.get_playlist(_PLAYLIST_ID)
    await client.aclose()


async def test_a_channel_with_no_uploads_playlist_is_an_error_not_a_not_found() -> None:
    # The channel exists; there is simply no list to read. Registering it would create a source
    # that could never be scanned, and calling that "not found" would send the owner hunting for
    # a typo that isn't there.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_channel_json(uploads=None)))

    client = _client(handler)
    with pytest.raises(YouTubeError) as caught:
        await client.resolve_channel_by_handle(_HANDLE)
    await client.aclose()
    assert not isinstance(caught.value, YouTubeNotFoundError)
    assert "uploads playlist" in str(caught.value)


async def test_an_empty_uploads_string_counts_as_no_uploads_playlist() -> None:
    # Google writes an unset related playlist as "", not as absent — an empty id stored as though
    # it were real would fail much later, inside a scan.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_ok(_channel_json(uploads="")))

    client = _client(handler)
    with pytest.raises(YouTubeError):
        await client.resolve_channel_by_handle(_HANDLE)
    await client.aclose()


async def test_the_new_lookups_map_errors_the_same_way_videos_do() -> None:
    # The error mapping lives in one place; these three go through it too rather than around it.
    cases: tuple[tuple[int, str, type[YouTubeError]], ...] = (
        (403, "quotaExceeded", YouTubeQuotaError),
        (400, "badRequest", YouTubeAuthError),
        (503, "backendError", YouTubeUnreachableError),
    )
    for status, reason, expected in cases:
        def handler(
            request: httpx.Request, _s: int = status, _r: str = reason
        ) -> httpx.Response:
            return httpx.Response(_s, json=_error_body(_r, _s))

        client = _client(handler)
        with pytest.raises(expected):
            await client.resolve_channel_by_handle(_HANDLE)
        with pytest.raises(expected):
            await client.get_playlist(_PLAYLIST_ID)
        await client.aclose()


async def test_the_key_never_appears_in_a_channel_lookup_failure() -> None:
    # The redaction lives in `_get`, which these share — but "shares it" is a claim worth an
    # assertion, since a future method could easily call the transport directly.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=_error_body("badRequest", 400))

    client = _client(handler)
    with pytest.raises(YouTubeError) as caught:
        await client.get_channel(_CHANNEL_ID)
    await client.aclose()
    assert _KEY not in str(caught.value)
    assert _KEY not in "".join(traceback.format_exception(caught.value))


# ---- 7. Reading what is IN a playlist (v1.7 slice 4a) --------------------------------------

_UPLOADS = "UUa1b2c3d4e5f6g7h8i9j0k1"


def _playlist_item(
    video_id: str, published: str | None = "2026-01-05T14:00:00Z"
) -> dict[str, object]:
    """One `playlistItems.list` entry, contentDetails only — which is all songbird asks for."""
    details: dict[str, object] = {"videoId": video_id}
    if published is not None:
        details["videoPublishedAt"] = published
    return {"contentDetails": details}


def _playlist_page(*items: dict[str, object], next_token: str | None = None) -> dict[str, object]:
    body: dict[str, object] = {"kind": "youtube#playlistItemListResponse", "items": list(items)}
    if next_token is not None:
        body["nextPageToken"] = next_token
    return body


async def test_a_playlist_page_asks_for_ids_only_fifty_at_a_time() -> None:
    # The part matters as much as the path: asking for `snippet` here would double the response
    # size for fields songbird deliberately ignores (they describe the ENTRY, not the video).
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        for k in ("key", "part", "playlistId", "maxResults"):
            seen[k] = request.url.params.get(k, "<absent>")
        # No cursor on the first page — sending an empty one is not the same as sending none.
        seen["pageToken"] = request.url.params.get("pageToken", "<absent>")
        return httpx.Response(200, json=_playlist_page(_playlist_item(_ID)))

    client = _client(handler)
    await client.list_playlist_page(_UPLOADS)
    await client.aclose()
    assert seen == {
        "path": "/youtube/v3/playlistItems",
        "key": _KEY,
        "part": "contentDetails",
        "playlistId": _UPLOADS,
        "maxResults": "50",
        "pageToken": "<absent>",
    }


async def test_a_page_reads_its_ids_in_the_order_youtube_listed_them() -> None:
    # Order is the whole basis of the incremental stop rule: an uploads playlist is newest-first,
    # so a caller that reordered these would stop in the wrong place.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_playlist_page(
                _playlist_item(_ID, "2026-01-05T14:00:00Z"),
                _playlist_item(_ID2, "2025-12-29T14:00:00Z"),
            ),
        )

    client = _client(handler)
    page = await client.list_playlist_page(_UPLOADS)
    await client.aclose()
    assert page.video_ids == [_ID, _ID2]
    assert page.items[0].published_at == datetime(2026, 1, 5, 14, 0, tzinfo=UTC)
    assert page.next_page_token is None  # a page with no cursor is the last one


async def test_the_page_token_is_handed_straight_back() -> None:
    tokens: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        tokens.append(request.url.params.get("pageToken", "<absent>"))
        return httpx.Response(200, json=_playlist_page(_playlist_item(_ID), next_token="PAGE2"))

    client = _client(handler)
    first = await client.list_playlist_page(_UPLOADS)
    assert first.next_page_token == "PAGE2"
    await client.list_playlist_page(_UPLOADS, first.next_page_token)
    await client.aclose()
    # YouTube's cursor is opaque, so the only correct thing to do with it is give it back.
    assert tokens == ["<absent>", "PAGE2"]


async def test_an_entry_whose_video_is_gone_has_no_date() -> None:
    # A private or deleted video leaves its playlist ENTRY behind with no videoPublishedAt. That
    # must parse, not raise: a real back catalogue has these in it.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_playlist_page(_playlist_item(_ID, published=None)))

    client = _client(handler)
    page = await client.list_playlist_page(_UPLOADS)
    await client.aclose()
    assert page.video_ids == [_ID]
    assert page.items[0].published_at is None


async def test_an_empty_page_is_a_normal_answer_not_a_not_found() -> None:
    # Unlike channels.list, "no items" here is not a missing playlist — an empty playlist and a
    # channel that has posted nothing are both real. `get_playlist` is what says it exists.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"kind": "youtube#playlistItemListResponse", "items": []})

    client = _client(handler)
    page = await client.list_playlist_page(_UPLOADS)
    await client.aclose()
    assert page.video_ids == []
    assert page.next_page_token is None


async def test_the_pager_maps_errors_the_way_every_other_call_does() -> None:
    # It goes through the same `_get`, and this is what proves it rather than assuming it.
    cases: tuple[tuple[int, str, type[YouTubeError]], ...] = (
        (403, "quotaExceeded", YouTubeQuotaError),
        (400, "badRequest", YouTubeAuthError),
        (404, "playlistNotFound", YouTubeNotFoundError),
        (503, "backendError", YouTubeUnreachableError),
    )
    for status, reason, expected in cases:

        def handler(request: httpx.Request, _s: int = status, _r: str = reason) -> httpx.Response:
            return httpx.Response(_s, json=_error_body(_r, _s))

        client = _client(handler)
        with pytest.raises(expected):
            await client.list_playlist_page(_UPLOADS)
        await client.aclose()


async def test_the_pager_never_leaks_the_key(caplog: pytest.LogCaptureFixture) -> None:
    # The redaction is installed by the client, not by each method — but a new method is a new
    # chance to bypass `_get`, and that is exactly what this catches.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    client = _client(handler)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(YouTubeError) as caught:
            await client.list_playlist_page(_UPLOADS)
    await client.aclose()

    rendered = "".join(traceback.format_exception(caught.value))
    assert _KEY not in rendered
    assert "AIza" not in rendered
    assert _KEY not in caplog.text
    assert "key=REDACTED" in caplog.text
