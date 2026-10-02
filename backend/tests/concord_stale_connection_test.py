"""A connection Concord has just closed must never reach the user as an outage.

Concord's uvicorn closes a keep-alive connection after 5 s idle, and httpx used to keep one for
5 s. A request sent about 5 s after the last one could go out on a connection Concord was closing at
that instant; httpx then raised `RemoteProtocolError` ("Server disconnected without sending a
response") or `ReadError` (a reset), and songbird answered 502 for a Concord that was up — the
request never reached it (docs/dev-notes.md, "v1.8 fix — the brief Concord failures").

The race itself is a few milliseconds wide, so these tests don't time it. A tiny local server
does to a *reused* connection exactly what Concord's idle close does to a request racing it: it
reads the request and hangs up without answering. No live Concord, no sleeps.
"""

import asyncio
import json
import socket
import struct
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import httpx
import pytest
from songbird.concord.client import ConcordClient, ConcordUnreachableError

_BODY = json.dumps({"translations": []}).encode()
_RESPONSE = (
    b"HTTP/1.1 200 OK\r\n"
    b"content-type: application/json\r\n"
    b"content-length: " + str(len(_BODY)).encode() + b"\r\n"
    b"\r\n" + _BODY
)

HangUp = Literal["close", "reset"]


class _HangsUpOnReuse:
    """Answers the first request on each connection and keeps it open; on any later request on that
    connection, reads it and hangs up without a response. `close` ends the connection cleanly
    (httpx sees `RemoteProtocolError`); `reset` aborts it with an RST (`ReadError`). With
    `every=True` it hangs up on every request, even a connection's first."""

    def __init__(self, hang_up: HangUp, *, every: bool = False) -> None:
        self.hang_up = hang_up
        self.every = every
        self.connections = 0
        self.requests = 0

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        answered = 0
        try:
            while True:
                await reader.readuntil(b"\r\n\r\n")  # a GET has no body
                self.requests += 1
                if answered or self.every:
                    if self.hang_up == "reset":
                        sock = writer.get_extra_info("socket")
                        sock.setsockopt(
                            socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)
                        )
                        writer.transport.abort()
                    return
                writer.write(_RESPONSE)
                await writer.drain()
                answered += 1
        except (asyncio.IncompleteReadError, ConnectionError):
            return
        finally:
            writer.close()


@asynccontextmanager
async def _serving(server: _HangsUpOnReuse) -> AsyncIterator[str]:
    listener = await asyncio.start_server(server.handle, "127.0.0.1", 0)
    port = listener.sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        listener.close()
        await listener.wait_closed()


@pytest.mark.parametrize("hang_up", ["close", "reset"])
async def test_a_connection_closed_under_a_request_is_retried_on_a_fresh_one(
    hang_up: HangUp,
) -> None:
    server = _HangsUpOnReuse(hang_up)
    async with _serving(server) as base_url:
        client = ConcordClient(base_url)
        try:
            assert await client.list_translations() == []
            # Goes out on the kept-alive connection, which the server hangs up on — the race.
            assert await client.list_translations() == []
        finally:
            await client.aclose()
    # The second call was sent twice: once on the reused connection, once on a new one.
    assert server.requests == 3
    assert server.connections == 2


async def test_a_concord_that_never_answers_is_still_an_error_after_one_retry() -> None:
    # Invariant 3: a retry of the same request is not a fallback. A Concord that hangs up on every
    # request is unreachable, and songbird says so after exactly two attempts — no loop.
    server = _HangsUpOnReuse("close", every=True)
    async with _serving(server) as base_url:
        client = ConcordClient(base_url)
        try:
            with pytest.raises(ConcordUnreachableError):
                await client.list_translations()
        finally:
            await client.aclose()
    assert server.requests == 2


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("connection refused"),  # Concord down: fail at once
        httpx.ReadTimeout("timed out"),  # a slow Concord: don't double the wait
    ],
)
async def test_a_down_or_slow_concord_is_asked_once(error: httpx.TransportError) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise error

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ConcordUnreachableError):
            await client.list_translations()
    finally:
        await client.aclose()
    assert calls == 1
