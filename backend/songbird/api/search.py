"""Semantic Scripture search — a thin proxy of Concord's `/v1/semantic-search`. The heaviest
capability in the system (a 313MB embedding model + ONNX runtime) reached as one HTTP call,
because the model lives in Concord and never in songbird (CLAUDE.md dependency discipline).
(Semantic search of the user's *notes* awaits a Concord embed-arbitrary-text endpoint — which
doesn't exist — so notes use keyword search; see the annotations browse `q` param.)"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from songbird.api.deps import get_concord_client
from songbird.api.schemas import (
    KeywordResult,
    RandomVerse,
    SemanticResult,
    StudyNoteResult,
    StudyNotesPageOut,
)
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["search"])


@router.get("/semantic-search", response_model=list[SemanticResult])
async def semantic_search(
    q: str,
    translation: str | None = None,
    limit: int = 20,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[SemanticResult]:
    if not q.strip():
        return []  # no query → no call (Concord 422s on empty q)
    try:
        result = await concord.semantic_search(q, translation, limit)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        SemanticResult(
            book=r.book,
            chapter=r.chapter,
            verse=r.verse,
            reference=r.reference,
            score=r.score,
            text=r.text,
        )
        for r in result.results
    ]


@router.get("/keyword-search", response_model=list[KeywordResult])
async def keyword_search(
    q: str,
    translations: str | None = None,
    limit: int = 20,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[KeywordResult]:
    """Exact word/phrase Scripture search — a thin proxy of Concord's `/v1/search`. The literal
    counterpart to semantic search; no embedding model involved (issue #46). Searches **all loaded
    translations** by default; `translations` is an optional CSV of translation ids to narrow."""
    if not q.strip():
        return []  # no query → no call (Concord 422s on empty q)
    # Absent/blank → None → Concord searches all (`*`); a CSV narrows to that subset.
    narrowed = [t for t in translations.split(",") if t.strip()] if translations else None
    try:
        result = await concord.keyword_search(q, narrowed, limit=limit)
    except ConcordNotFoundError:
        # Concord's keyword search is FTS5, which 400s on ordinary punctuation (apostrophes,
        # commas, hyphens, …). That isn't an outage and isn't worth surfacing as an error —
        # present an unrunnable (or genuinely empty) keyword query as "no results" and let the UI
        # offer semantic search, which doesn't use FTS5 (issue #51). A real outage is still a 502.
        return []
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        KeywordResult(
            book=h.book,
            chapter=h.chapter,
            verse=h.verse,
            reference=h.reference,
            snippet=h.snippet,
            matches=h.matches,
        )
        for h in result.hits
    ]


@router.get("/study-notes-search", response_model=StudyNotesPageOut)
async def study_notes_search(
    q: str,
    translation: Annotated[
        str | None, Query(min_length=1, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> StudyNotesPageOut:
    """Keyword search over Concord's translator's/study notes — the Search page's "Study notes"
    section, distinct from "Scripture" and the user's own "Your notes". Named to avoid colliding
    with the user's-own-notes search (`/annotations?q=`).

    One page at a time (`limit` 1–100 from `offset`, Concord's own bounds) with the `total` across
    all pages, so the page can offer "Load more"; `translation` narrows to one Bible's notes.

    A query Concord can't run (FTS5 rejects punctuation) or a Bible it doesn't hold is an empty
    page, like keyword search. An unreachable Concord is a 502 (invariant 3): this section now
    shows an empty state, so an outage swallowed to "no results" would read as "nothing matches".
    The Scripture and Your-notes sections are separate requests, so they're unaffected."""
    if not q.strip():
        return StudyNotesPageOut(results=[], total=0)  # no query → no call
    try:
        result = await concord.search_notes(
            q,
            translation=translation.upper() if translation else None,
            limit=limit,
            offset=offset,
        )
    except ConcordNotFoundError:
        return StudyNotesPageOut(results=[], total=0)
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    results = [
        StudyNoteResult(
            book=h.book,
            chapter=h.chapter,
            verse=h.verse,
            reference=h.reference,
            translation=h.translation,
            type=h.type,
            snippet=h.snippet,
            label=h.label,
            text_format=h.text_format,
            title=h.title,
            image=h.image,
        )
        for h in result.hits
    ]
    # A Concord that doesn't send `total` gets no "Load more": this page counts as the last.
    total = result.total if result.total is not None else offset + len(results)
    return StudyNotesPageOut(results=results, total=total)


@router.get("/random-verse", response_model=RandomVerse)
async def random_verse(
    translation: str | None = None,
    concord: ConcordClient = Depends(get_concord_client),
) -> RandomVerse:
    """One random verse for the Welcome "verse of the day" card, in the reading translation. Stays
    honest — unreachable → 502, a 404 → 404 — and the frontend hides the card on any error (the
    Welcome page must not break when Concord is down; the card is a bonus)."""
    try:
        v = await concord.random_verse(translation)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return RandomVerse(
        translation=v.translation,
        book=v.book,
        chapter=v.chapter,
        verse=v.verse,
        reference=v.reference,
        text=v.text,
    )
