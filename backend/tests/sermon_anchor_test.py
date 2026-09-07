"""The shared anchor resolver (invariant 4).

This is the one place songbird turns a reference string into coordinates, and it now has two
callers: the sermon-note routes and the catalogue scan. Two resolvers would be two chances to
disagree about what a reference means, on the one axis the whole app is pinned to — so what these
tests hold is that there is one, that it hands back Concord's own spelling, and that the routes
still answer exactly what they answered before it moved.
"""

import httpx
import pytest
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import Book, Chapter
from songbird.sermons.anchor import (
    BookOrder,
    UnknownBookError,
    book_order_index,
    resolve_span,
)
from tests.conftest import FakeConcordClient
from tests.helpers import build_range

_BOOKS = [
    Book(id="GEN", name="Genesis", testament="OT", chapter_count=50, canonical_order=1),
    Book(id="ACT", name="Acts", testament="NT", chapter_count=28, canonical_order=44),
]


async def test_a_reference_resolves_to_the_ends_of_its_span() -> None:
    fake = FakeConcordClient(resolved=build_range("ACT", 7, 33, 35), books=_BOOKS)
    span = await resolve_span("Acts 7:33-35", fake)  # type: ignore[arg-type]

    assert (span.first.chapter, span.first.verse) == (7, 33)
    assert (span.last.chapter, span.last.verse) == (7, 35)
    assert span.book_usfm == "ACT"


async def test_the_span_carries_concords_own_spelling_of_the_reference() -> None:
    # Concord normalizes as it resolves — live, "2 Cor 5:17" comes back "2 Corinthians 5:17" and a
    # shouted "MATTHEW 28:19" comes back "Matthew 28:19". A scan-created note stores THAT, so a
    # church's typing habits don't decide how songbird spells the passage.
    resolved = Chapter(
        reference="2 Corinthians 5:17",
        translations=["KJV"],
        verses=build_range("2CO", 5, 17, 17).verses,
    )
    fake = FakeConcordClient(resolved=resolved, books=_BOOKS)

    span = await resolve_span("2 Cor 5:17", fake)  # type: ignore[arg-type]

    assert span.reference == "2 Corinthians 5:17"


async def test_a_reference_that_resolves_to_nothing_is_not_found() -> None:
    # A span with no verses in it is a "couldn't find that", not a success holding nothing.
    empty = Chapter(reference="Hesitations 3", translations=["KJV"], verses=[])
    fake = FakeConcordClient(resolved=empty, books=_BOOKS)

    with pytest.raises(ConcordNotFoundError):
        await resolve_span("Hesitations 3", fake)  # type: ignore[arg-type]


async def test_concords_own_errors_come_through_unchanged() -> None:
    # The caller decides what each one MEANS: a route turns them into 404 and 502, a scan discards
    # one candidate and stops the whole evaluation on the other.
    for error in (
        ConcordNotFoundError("nope"),
        ConcordUnreachableError("http://concord.test", httpx.ConnectError("down")),
    ):
        fake = FakeConcordClient(error=error, books=_BOOKS)
        with pytest.raises(type(error)):
            await resolve_span("Acts 7", fake)  # type: ignore[arg-type]


async def test_the_book_list_is_fetched_once_however_many_notes_a_run_places() -> None:
    # The whole reason BookOrder exists. Without it a check placing two hundred notes would fetch
    # the 66-book map two hundred times.
    class CountingConcord(FakeConcordClient):
        def __init__(self) -> None:
            super().__init__(books=_BOOKS)
            self.book_calls = 0

        async def list_books(self) -> list[Book]:
            self.book_calls += 1
            return await super().list_books()

    fake = CountingConcord()
    cache = BookOrder()
    for _ in range(5):
        assert await cache.index_for("ACT", fake) == 44  # type: ignore[arg-type]

    assert fake.book_calls == 1


async def test_a_caller_with_nothing_to_cache_still_gets_an_answer() -> None:
    # What a request does: one reference, one lookup, nothing kept.
    fake = FakeConcordClient(books=_BOOKS)
    assert await book_order_index("gen", fake) == 1  # type: ignore[arg-type]


async def test_a_book_concord_does_not_list_is_its_own_error() -> None:
    # Only reachable if resolve_reference and list_books disagree, which would be a Concord bug
    # rather than a bad reference — so it must not look like "couldn't find that reference".
    fake = FakeConcordClient(books=_BOOKS)
    with pytest.raises(UnknownBookError):
        await book_order_index("XYZ", fake)  # type: ignore[arg-type]
