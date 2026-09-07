"""The single HTTP client songbird uses to talk to YouTube's Data API v3.

Modelled on `ConcordClient` — one class, one base URL, explicit failure types — with two
deliberate differences, both forced by the fact that this client carries a secret and Concord's
does not:

* **Every raise is `from None`.** Concord's client chains with `from exc`, which is right when
  the cause is harmless. Here it is not: httpx puts the full request URL — including
  `?key=<the secret>` — into `HTTPStatusError`'s message, and a chained cause is rendered by
  `traceback.format_exception` and therefore by `logger.exception`. Suppressing the chain and
  carrying a redacted message of our own is what actually keeps the key out of a log.
* **Nothing keeps the httpx exception.** `ConcordUnreachableError` stores `.cause`; the
  equivalent here would keep `exc.request.url` — and the key with it — reachable forever. The
  exceptions carry `status` and `reason` instead: safe scalars, and exactly what spec §6 needs
  to word a source's `last_check_status`.

Unlike Concord (a hard dependency — its absence is an error), YouTube being unreachable is a
recorded condition, not a fatal one (spec §2). That is why the four failures share one base.
"""

import logging
import re
from typing import Any

import httpx

from songbird.youtube.schemas import Video
from songbird.youtube.urls import is_video_id

YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3"

# videos.list accepts up to 50 ids per call, and costs one quota unit however many you send —
# so batching is what keeps a full back-catalogue scan affordable (spec §2).
_BATCH_SIZE = 50
_VIDEO_PARTS = "snippet,contentDetails,liveStreamingDetails"

# Google's two ways of saying "you're out of quota for today".
_QUOTA_REASONS = frozenset({"quotaExceeded", "dailyLimitExceeded"})

_REDACTED = "REDACTED"
_QUERY_KEY = re.compile(r"([?&]key=)[^&\s'\"]*")

logger = logging.getLogger("songbird")


class _RedactApiKeyFilter(logging.Filter):
    """Strips the API key out of httpx's own request log.

    httpx logs `HTTP Request: GET <full url> "200 OK"` at INFO on **every** request, and
    `create_app()` calls `logging.basicConfig(level=INFO)` — so without this, a working
    deployment prints the key on every single call. Redacting our exception messages does
    nothing about that; this filter is what makes "the key is never logged" (spec §2) true.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _QUERY_KEY.sub(rf"\1{_REDACTED}", message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def _install_log_filter() -> None:
    """Attach the redacting filter to the `httpx` logger, once. Idempotent, because a client
    may be rebuilt (a test, a future reload) and duplicate filters would compound."""
    httpx_logger = logging.getLogger("httpx")
    if not any(isinstance(f, _RedactApiKeyFilter) for f in httpx_logger.filters):
        httpx_logger.addFilter(_RedactApiKeyFilter())


class YouTubeError(Exception):
    """Base for every YouTube failure.

    Exists — where Concord's two exceptions share no base — because spec §2 makes YouTube's
    failures *recordable* rather than fatal: the scan catches this one type, writes the reason
    onto the source, and moves on. It is also the honest bucket for a status none of the four
    named cases covers.
    """

    def __init__(self, message: str, *, status: int | None = None, reason: str | None = None):
        self.status = status
        self.reason = reason  # Google's machine-readable token, e.g. "quotaExceeded"
        super().__init__(message)


class YouTubeUnreachableError(YouTubeError):
    """The network failed, or YouTube returned a server error. Transient — try again later."""


class YouTubeQuotaError(YouTubeError):
    """The daily quota is spent. Not an error in the key or the request; it resets."""


class YouTubeAuthError(YouTubeError):
    """The key is missing, malformed, restricted, or the Data API isn't enabled for it.
    Needs a human to fix the key — retrying will not help."""


class YouTubeNotFoundError(YouTubeError):
    """YouTube says there is no such thing — a real "not found", not unreachability."""


class YouTubeClient:
    def __init__(
        self,
        api_key: str,
        timeout: float = 10.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        # The key rides on the client, not on each call: httpx merges client-level params into
        # every request's params, so the secret appears in exactly one line of songbird and no
        # call site can forget it — or accidentally log a params dict containing it.
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=YOUTUBE_API_BASE_URL,
            timeout=timeout,
            transport=transport,
            params={"key": api_key},
        )
        _install_log_filter()

    async def aclose(self) -> None:
        await self._client.aclose()

    def _redact(self, text: str) -> str:
        """Remove the key from anything about to become an exception message. Belt and braces:
        the literal key, and any `key=` query parameter (which catches a URL-encoded or
        truncated rendering the literal match would miss)."""
        return _QUERY_KEY.sub(rf"\1{_REDACTED}", text.replace(self._api_key, _REDACTED))

    @staticmethod
    def _error_reasons(response: httpx.Response) -> list[str]:
        """Every machine-readable reason Google offers, in preference order.

        Google writes the reason in two places and they do not agree. Observed live against a
        deliberately wrong key:

            "errors":  [{"domain": "global",            "reason": "badRequest"}]
            "details": [{"@type": "…/ErrorInfo",        "reason": "API_KEY_INVALID"},
                        {"@type": "…/LocalizedMessage", "message": "…"}]

        `errors[]` is the legacy field and carries a generic HTTP-shaped token; `details[]` is
        the modern `google.rpc.ErrorInfo` and carries the token that actually says what is
        wrong. The quota failure, by contrast, still puts `quotaExceeded` in `errors[]`. So both
        are read, legacy first then modern — so the LAST reason is the most specific one, and
        that is the one reported. Entries may carry no `reason` at all, as the
        LocalizedMessage above shows.

        Tolerant by design — this runs while handling an error and must never raise one.
        """
        reasons: list[str] = []
        try:
            payload: Any = response.json()
            error: Any = payload["error"]
            for key in ("errors", "details"):
                entries: Any = error.get(key)
                for entry in entries or ():
                    reason: Any = entry.get("reason")
                    if isinstance(reason, str) and reason not in reasons:
                        reasons.append(reason)
        except (ValueError, KeyError, TypeError, AttributeError):
            return reasons
        return reasons

    def _from_status(self, exc: httpx.HTTPStatusError) -> YouTubeError:
        """Map a failing response to the right exception. Never raises, never leaks the key."""
        status = exc.response.status_code
        reasons = self._error_reasons(exc.response)
        # The LAST reason, because `_error_reasons` reads legacy-then-modern and the modern one
        # is the specific one: a rejected key gives ["badRequest", "API_KEY_INVALID"], and
        # "badRequest" tells an admin nothing. Where Google offers only one — quota, a
        # restricted key — first and last are the same, so nothing else shifts.
        reason = reasons[-1] if reasons else None
        detail = f"{status}" + (f" ({', '.join(reasons)})" if reasons else "")

        if status == 403 and any(r in _QUOTA_REASONS for r in reasons):
            return YouTubeQuotaError(
                f"YouTube's daily quota is spent: {detail}", status=status, reason=reason
            )
        if status in (400, 401, 403):
            return YouTubeAuthError(
                f"YouTube rejected the API key: {detail}", status=status, reason=reason
            )
        if status == 404:
            return YouTubeNotFoundError(
                f"YouTube has no such resource: {detail}", status=status, reason=reason
            )
        return YouTubeUnreachableError(
            f"YouTube returned an unexpected status: {detail}", status=status, reason=reason
        )

    async def _get(self, path: str, params: dict[str, str]) -> httpx.Response:
        try:
            response = await self._client.get(path, params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # `from None`, not `from exc`: the chained HTTPStatusError's message contains the
            # full URL, key included, and would be printed by any traceback.
            raise self._from_status(exc) from None
        except httpx.HTTPError as exc:
            raise YouTubeUnreachableError(
                f"YouTube is unreachable: {self._redact(str(exc))}"
            ) from None
        return response

    async def get_videos(self, ids: list[str]) -> list[Video]:
        """Details for each of `ids`, in the order given.

        Ids YouTube doesn't return — private, deleted, never existed — are simply absent from
        the result rather than an error: a channel's back catalogue routinely contains them, and
        a scan should skip them, not stop. Input order is preserved because YouTube's own
        ordering isn't guaranteed, and a caller matching results back to a ledger needs
        something deterministic.
        """
        # De-dupe (order-preserving) and drop anything that isn't shaped like a video id, so a
        # stray value can't turn the whole batch into a 400.
        wanted = [i for i in dict.fromkeys(ids) if is_video_id(i)]
        if not wanted:
            return []  # nothing to ask about — don't spend a quota unit saying so

        found: dict[str, Video] = {}
        for start in range(0, len(wanted), _BATCH_SIZE):
            batch = wanted[start : start + _BATCH_SIZE]
            response = await self._get("/videos", {"part": _VIDEO_PARTS, "id": ",".join(batch)})
            for video in Video.parse_youtube(response.json()):
                found[video.id] = video

        return [found[i] for i in wanted if i in found]
