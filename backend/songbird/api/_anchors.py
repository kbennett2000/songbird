"""The HTTP half of `songbird/sermons/anchor.py` — Concord's errors as status codes.

Two shims, and they live here rather than in one router because two routers now resolve a
reference: the sermon-note form, where a person types one, and the review list, where a person taps
one. A reference that will not resolve must fail the same way in both — the same 404, naming the
same reference — or the review list would quietly grow its own idea of what a bad reference is.

`anchor.py` itself stays free of FastAPI so the background scan, which has no request to fail, can
use it too.
"""

from songbird.concord.client import ConcordClient, ConcordNotFoundError, ConcordUnreachableError
from songbird.core.errors import ErrorCode, raise_http
from songbird.sermons.anchor import (
    ResolvedSpan,
    UnknownBookError,
    book_order_index,
    resolve_span,
)


async def resolve_anchor(reference: str, concord: ConcordClient) -> ResolvedSpan:
    """Resolve a human `reference` to its canonical span via Concord (songbird never parses
    references itself — invariant 4). Returns the (first, last) verse of the range, so a ranged
    reference like "Joshua 6:1-16" covers every verse in it. Unparseable / unknown reference →
    404; Concord unreachable → 502 (it's a hard dependency, invariant 3).

    The 404 carries the reference itself, which is what lets a multi-reference place action say
    WHICH one it could not find (spec §8 — all-or-nothing, and the failing one is named).

    Returns the whole `ResolvedSpan`, **Concord's own spelling included**. The sermon-note form
    keeps the words a person typed, which is the right answer for a note somebody wrote; the review
    list stores Concord's, which is the right answer for a note built from a suggestion, so that
    "Psalm 23" tapped on one video and "Psalms 23" read off another are one reference.
    """
    try:
        span = await resolve_span(reference, concord)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, f"Couldn't find reference '{reference}': {exc}")
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return span


async def resolve_book_order_index(book_usfm: str, concord: ConcordClient) -> int:
    """Map a USFM book code → Concord's canonical_order. Raises 422 for an unknown code, 502 if
    Concord can't be reached (it's a hard dependency — its absence is an error, invariant 3)."""
    try:
        return await book_order_index(book_usfm, concord)
    except UnknownBookError:
        raise_http(422, ErrorCode.INVALID_BOOK, f"unknown book '{book_usfm}'")
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
