"""Turning a reference string into a canonical anchor (invariant 4).

This is the one place songbird converts "Acts 7:33-35" into coordinates, and it does it by asking
Concord — never by parsing the reference itself. It was written for the sermon-note routes; it
lives here now because the catalogue scan creates sermon notes too, and a note made by a check has
to be built by exactly the same code as a note made by hand. Two resolvers would be two chances to
disagree about what a reference means, on the one axis the whole app is pinned to.

**No FastAPI here.** The routes still answer 404 / 422 / 502; they do it by catching the errors
below and translating, which keeps this module usable from a background task that has no request to
fail. The exceptions are Concord's own, plus `UnknownBookError` for the one condition Concord
cannot report: a book code that resolved fine but is missing from the book list.
"""

from dataclasses import dataclass

from songbird.concord.client import ConcordClient, ConcordNotFoundError
from songbird.concord.schemas import ChapterVerse


class UnknownBookError(Exception):
    """A USFM code Concord resolved to but does not list. Only reachable if `resolve_reference`
    and `list_books` disagree, which would be a Concord bug rather than a bad reference — so it is
    its own error rather than a "couldn't find that" the caller might quietly discard."""

    def __init__(self, book_usfm: str) -> None:
        self.book_usfm = book_usfm
        super().__init__(f"unknown book '{book_usfm}'")


@dataclass(frozen=True, slots=True)
class ResolvedSpan:
    """What Concord made of a reference: the ends of the span, and its own name for it."""

    first: ChapterVerse
    last: ChapterVerse
    reference: str

    @property
    def book_usfm(self) -> str:
        return self.first.book.strip().upper()


async def resolve_span(reference: str, concord: ConcordClient) -> ResolvedSpan:
    """Resolve a human reference to its canonical span (invariant 4).

    Returns the first and last verse, so a ranged reference like `Joshua 6:1-16` covers every verse
    in it and a chapter-only one covers the chapter. Also returns **Concord's own reference
    string**, which the caller may prefer to the text it passed in: Concord normalizes as it
    resolves, so `2 Cor 5:17` comes back as `2 Corinthians 5:17` and a shouted `MATTHEW 28:19` as
    `Matthew 28:19` (both checked live). That is what gives scan-created notes one consistent
    spelling instead of whatever a church happened to type.

    An empty verse list is a "couldn't find that reference", not a success with nothing in it.
    """
    chapter = await concord.resolve_reference(reference)
    if not chapter.verses:
        raise ConcordNotFoundError(f"Concord could not resolve '{reference}'")
    return ResolvedSpan(chapter.verses[0], chapter.verses[-1], chapter.reference)


class BookOrder:
    """Concord's canonical book order, fetched once and kept.

    The 66-book map does not change while a scan runs, and a check that places two hundred notes
    would otherwise fetch it two hundred times. A request makes a fresh one and throws it away,
    which is exactly what the routes did before this existed.
    """

    def __init__(self) -> None:
        self._by_usfm: dict[str, int] | None = None

    async def index_for(self, book_usfm: str, concord: ConcordClient) -> int:
        """Concord's `canonical_order` for a USFM code. Raises `UnknownBookError` for a code the
        book list does not carry, and Concord's own error if the list cannot be fetched."""
        if self._by_usfm is None:
            books = await concord.list_books()
            self._by_usfm = {b.id.upper(): b.canonical_order for b in books}
        order = self._by_usfm.get(book_usfm.strip().upper())
        if order is None:
            raise UnknownBookError(book_usfm)
        return order


async def book_order_index(book_usfm: str, concord: ConcordClient) -> int:
    """`BookOrder.index_for` for a caller with nothing to cache — one reference, one lookup."""
    return await BookOrder().index_for(book_usfm, concord)
