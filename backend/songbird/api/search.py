"""Semantic Scripture search — a thin proxy of Concord's `/v1/semantic-search`. The heaviest
capability in the system (a 313MB embedding model + ONNX runtime) reached as one HTTP call,
because the model lives in Concord and never in songbird (CLAUDE.md dependency discipline).
(Semantic search of the user's *notes* awaits a Concord embed-arbitrary-text endpoint — which
doesn't exist — so notes use keyword search; see the annotations browse `q` param.)"""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import KeywordResult, RandomVerse, SemanticResult, StudyNoteResult
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


@router.get("/study-notes-search", response_model=list[StudyNoteResult])
async def study_notes_search(
    q: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[StudyNoteResult]:
    """Keyword search over Concord's translator's/study notes — the Search page's "Study notes"
    section, distinct from "Scripture" and the user's own "Your notes". Named to avoid colliding
    with the user's-own-notes search (`/annotations?q=`).

    Best-effort by design: this is the rarely-populated reference layer (the public Concord image
    ships zero notes), so **any** failure — client error *or* unreachable — is swallowed to `[]`,
    and the section simply doesn't render. This is a deliberate divergence from the Scripture
    search endpoints (which surface a 502): the Scripture section is already the page's
    Concord-health signal, so a redundant error here would be noise and would degrade the page."""
    if not q.strip():
        return []  # no query → no call
    try:
        result = await concord.search_notes(q)
    except (ConcordNotFoundError, ConcordUnreachableError):
        return []  # best-effort: never degrade the Scripture / Your-notes sections
    return [
        StudyNoteResult(
            book=h.book,
            chapter=h.chapter,
            verse=h.verse,
            reference=h.reference,
            translation=h.translation,
            type=h.type,
            snippet=h.snippet,
        )
        for h in result.hits
    ]


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
