"""Semantic Scripture search — a thin proxy of Concord's `/v1/semantic-search`. The heaviest
capability in the system (a 313MB embedding model + ONNX runtime) reached as one HTTP call,
because the model lives in Concord and never in songbird (CLAUDE.md dependency discipline).
(Semantic search of the user's *notes* awaits a Concord embed-arbitrary-text endpoint — which
doesn't exist — so notes use keyword search; see the annotations browse `q` param.)"""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import SemanticResult
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
