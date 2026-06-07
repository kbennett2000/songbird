"""Annotation CRUD. Notes are stored as Markdown (CLAUDE.md invariant 6); anchors are
canonical coordinates only (invariant 4). Single default author until auth (Slice 8).

Three-tier scope (SPEC §2): 'all' (no codes), 'current' (exactly one code — resolved at
creation to the translation being read), 'subset' (≥1 code). Codes are validated against
Concord's translation list.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._tags import normalize_tags as _normalize_tags
from songbird.api._tags import resolve_tags as _resolve_tags
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.api.schemas import AnnotationCreate, AnnotationOut, AnnotationUpdate
from songbird.concord.client import ConcordClient, ConcordUnreachableError
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import Annotation, AnnotationTranslation, Tag, User

router = APIRouter(prefix="/api/v1/annotations", tags=["annotations"])


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


async def _get_or_404(db: AsyncSession, annotation_id: int, author_id: int) -> Annotation:
    # select() (not db.get) so the selectin-loaded `translations` are populated. Scoped to the
    # author: another user's annotation is a 404 (no existence leak).
    result = await db.execute(
        select(Annotation).where(Annotation.id == annotation_id, Annotation.author_id == author_id)
    )
    annotation = result.scalar_one_or_none()
    if annotation is None:
        raise_http(404, ErrorCode.ANNOTATION_NOT_FOUND, f"No annotation {annotation_id}")
    return annotation


@router.get("", response_model=list[AnnotationOut])
async def list_annotations(
    tags: str | None = None,
    match: str = "all",
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AnnotationOut]:
    """Browse / search the current user's annotations. Concord-free — annotations are
    songbird's own domain. `tags` filters by tag (`match=all` default → all the given tags;
    `any` → any). `q` is a case-insensitive keyword search over the note text (the honest
    stand-in for semantic note search, which awaits a Concord embed endpoint). Filters compose."""
    stmt = select(Annotation).where(Annotation.author_id == user.id)
    names = _normalize_tags(tags.split(",")) if tags else []
    if names:
        stmt = stmt.join(Annotation.tags).where(Tag.name.in_(names)).group_by(Annotation.id)
        if match == "all":
            stmt = stmt.having(func.count(func.distinct(Tag.id)) == len(names))
    if q and q.strip():
        stmt = stmt.where(Annotation.note_markdown.ilike(f"%{q.strip()}%"))
    stmt = stmt.order_by(
        Annotation.book_usfm, Annotation.start_chapter, Annotation.start_verse, Annotation.id
    )
    annotations = (await db.execute(stmt)).scalars().unique().all()
    return [AnnotationOut.model_validate(a) for a in annotations]


@router.post("", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
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
        author_id=user.id,
        translations=[AnnotationTranslation(translation_code=c) for c in codes],
        tags=await _resolve_tags(db, body.tags),
    )
    db.add(annotation)
    await db.commit()  # expire_on_commit=False keeps the in-memory translations + tags
    return AnnotationOut.model_validate(annotation)


@router.get("/{annotation_id}", response_model=AnnotationOut)
async def get_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationOut:
    annotation = await _get_or_404(db, annotation_id, user.id)
    return AnnotationOut.model_validate(annotation)


@router.patch("/{annotation_id}", response_model=AnnotationOut)
async def update_annotation(
    annotation_id: int,
    body: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
) -> AnnotationOut:
    annotation = await _get_or_404(db, annotation_id, user.id)
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
    if body.tags is not None:
        annotation.tags = await _resolve_tags(db, body.tags)
    await db.commit()
    return AnnotationOut.model_validate(annotation)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    annotation = await _get_or_404(db, annotation_id, user.id)
    await db.delete(annotation)
    await db.commit()
