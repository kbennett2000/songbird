"""Annotation CRUD. Notes are stored as Markdown (CLAUDE.md invariant 6); anchors are
canonical coordinates only (invariant 4). Single default author until auth (Slice 8).

Three-tier scope (SPEC §2): 'all' (no codes), 'current' (exactly one code — resolved at
creation to the translation being read), 'subset' (≥1 code). Codes are validated against
Concord's translation list.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_concord_client, get_db
from songbird.api.schemas import AnnotationCreate, AnnotationOut, AnnotationUpdate
from songbird.concord.client import ConcordClient, ConcordUnreachableError
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import Annotation, AnnotationTranslation

router = APIRouter(prefix="/api/v1/annotations", tags=["annotations"])

DEFAULT_AUTHOR_ID = 1


async def _resolve_scope(
    scope_type: str, translations: list[str], concord: ConcordClient
) -> list[str]:
    """Validate a scope and return its normalized translation codes ([] for 'all').

    Raises 422 for a malformed scope / unknown code, 502 if Concord can't be reached to
    validate (consistent with it being a hard dependency).
    """
    codes = list(dict.fromkeys(c.strip().upper() for c in translations if c.strip()))

    if scope_type == "all":
        return []
    if scope_type == "current":
        if len(codes) != 1:
            raise_http(
                422, ErrorCode.INVALID_SCOPE, "'current' scope needs exactly one translation"
            )
    elif scope_type == "subset":
        if not codes:
            raise_http(
                422, ErrorCode.INVALID_SCOPE, "'subset' scope needs at least one translation"
            )
    else:
        raise_http(422, ErrorCode.INVALID_SCOPE, f"unknown scope_type '{scope_type}'")

    try:
        valid = {t.id.upper() for t in await concord.list_translations()}
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    unknown = [c for c in codes if c not in valid]
    if unknown:
        raise_http(
            422, ErrorCode.INVALID_TRANSLATION, f"unknown translation(s): {', '.join(unknown)}"
        )
    return codes


async def _get_or_404(db: AsyncSession, annotation_id: int) -> Annotation:
    # select() (not db.get) so the selectin-loaded `translations` are populated.
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    annotation = result.scalar_one_or_none()
    if annotation is None:
        raise_http(404, ErrorCode.ANNOTATION_NOT_FOUND, f"No annotation {annotation_id}")
    return annotation


@router.post("", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
) -> AnnotationOut:
    codes = await _resolve_scope(body.scope_type, body.translations, concord)
    annotation = Annotation(
        book_usfm=body.book_usfm,
        start_chapter=body.start_chapter,
        start_verse=body.start_verse,
        end_chapter=body.end_chapter,
        end_verse=body.end_verse,
        note_markdown=body.note_markdown,
        color=body.color,
        scope_type=body.scope_type,
        author_id=DEFAULT_AUTHOR_ID,
        translations=[AnnotationTranslation(translation_code=c) for c in codes],
    )
    db.add(annotation)
    await db.commit()  # expire_on_commit=False keeps the in-memory translations
    return AnnotationOut.model_validate(annotation)


@router.get("/{annotation_id}", response_model=AnnotationOut)
async def get_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
) -> AnnotationOut:
    annotation = await _get_or_404(db, annotation_id)
    return AnnotationOut.model_validate(annotation)


@router.patch("/{annotation_id}", response_model=AnnotationOut)
async def update_annotation(
    annotation_id: int,
    body: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
) -> AnnotationOut:
    annotation = await _get_or_404(db, annotation_id)
    if body.note_markdown is not None:
        annotation.note_markdown = body.note_markdown
    if body.color is not None:
        annotation.color = body.color
    if body.scope_type is not None or body.translations is not None:
        new_scope_type = body.scope_type if body.scope_type is not None else annotation.scope_type
        new_codes = (
            body.translations if body.translations is not None else annotation.scope_translations
        )
        codes = await _resolve_scope(new_scope_type, new_codes, concord)
        annotation.scope_type = new_scope_type
        annotation.translations = [AnnotationTranslation(translation_code=c) for c in codes]
    await db.commit()
    return AnnotationOut.model_validate(annotation)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    annotation = await _get_or_404(db, annotation_id)
    await db.delete(annotation)
    await db.commit()
