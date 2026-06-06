"""Annotation CRUD. Notes are stored as Markdown (CLAUDE.md invariant 6); anchors are
canonical coordinates only (invariant 4). Single default author until auth (Slice 8)."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_db
from songbird.api.schemas import AnnotationCreate, AnnotationOut, AnnotationUpdate
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import Annotation

router = APIRouter(prefix="/api/v1/annotations", tags=["annotations"])

DEFAULT_AUTHOR_ID = 1


async def _get_or_404(db: AsyncSession, annotation_id: int) -> Annotation:
    annotation = await db.get(Annotation, annotation_id)
    if annotation is None:
        raise_http(404, ErrorCode.ANNOTATION_NOT_FOUND, f"No annotation {annotation_id}")
    return annotation


@router.post("", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
) -> AnnotationOut:
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
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
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
) -> AnnotationOut:
    annotation = await _get_or_404(db, annotation_id)
    if body.note_markdown is not None:
        annotation.note_markdown = body.note_markdown
    if body.color is not None:
        annotation.color = body.color
    await db.commit()
    await db.refresh(annotation)
    return AnnotationOut.model_validate(annotation)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    annotation = await _get_or_404(db, annotation_id)
    await db.delete(annotation)
    await db.commit()
