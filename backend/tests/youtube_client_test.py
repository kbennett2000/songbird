"""Unit tests for the YouTube client's batching, parsing, error mapping and — above all — its
handling of the API key, using httpx's built-in MockTransport (no live YouTube, no network).

The key is a secret (spec §2). Three separate mechanisms keep it out of sight, and each is
tested here, because two of them are invisible in ordinary use and would rot unnoticed.
"""

import logging
import traceback

import httpx
import pytest
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeClient,
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
    if started is not None:
        item["liveStreamingDetails"] = {"actualStartTime": started}
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
