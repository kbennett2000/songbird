"""Request/response models for songbird's own API (annotations + the chapter overlay).

Kept separate from `concord/schemas.py` (which models Concord's responses).
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AnnotationCreate(BaseModel):
    book_usfm: str = Field(min_length=1, max_length=3)
    start_chapter: int = Field(ge=1)
    start_verse: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    end_verse: int = Field(ge=1)
    note_markdown: str
    color: str | None = None
    scope_type: str = "all"
    # Concrete translation codes for 'current' (exactly 1) / 'subset' (≥1); empty for 'all'.
    translations: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AnnotationUpdate(BaseModel):
    note_markdown: str | None = None
    color: str | None = None
    scope_type: str | None = None
    translations: list[str] | None = None
    tags: list[str] | None = None


class AnnotationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_usfm: str
    start_chapter: int
    start_verse: int
    end_chapter: int
    end_verse: int
    note_markdown: str
    color: str | None
    scope_type: str
    scope_translations: list[str]  # resolved codes; [] for 'all'
    tags: list[str]
    author_id: int
    created_at: datetime
    updated_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def _tag_names(cls, value: Any) -> list[str]:
        # Map ORM Tag objects → names (from_attributes); pass plain strings through.
        return [getattr(t, "name", t) for t in value]


class ReadAnnotation(AnnotationOut):
    """An overlaid annotation, with whether it is in scope for the translation being read
    (decision B: out-of-scope annotations are shown-but-marked, never hidden)."""

    in_scope: bool


class CrossReference(BaseModel):
    """A cross-reference target (from Concord) — canonical coords + the optional snippet/votes.
    songbird stores none of this; it's a pass-through of Concord's TSK data."""

    book: str  # USFM code — canonical (jump reuses navigation directly)
    chapter: int
    verse_start: int
    verse_end: int | None
    reference: str  # human-readable, e.g. "Romans 5:8" or "1 John 4:9-10"
    votes: int | None
    text: str | None  # the target's snippet (in the read translation), if available


class Place(BaseModel):
    """A place named in Scripture (from Concord). The honesty model is carried through
    verbatim: `latitude`/`longitude`/`confidence` are null for unknown/symbolic/multiple
    places — songbird never fabricates a coordinate."""

    id: str
    friendly_id: str
    name: str
    type: str
    latitude: float | None
    longitude: float | None
    confidence: str | None
    confidence_score: int | None
    status: str  # identified | disputed | unknown | symbolic | multiple


class PlaceVerse(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str


class SemanticResult(BaseModel):
    """A ranked Scripture result from Concord's semantic search. Canonical coords → jump
    reuses navigation; `score` is Concord's confidence, surfaced honestly."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    score: float
    text: str | None


class ResolvedReference(BaseModel):
    """A raw reference resolved (by Concord) to canonical coordinates. `verse` is set only
    when the reference named a single verse (so the reader can scroll to / highlight it)."""

    reference: str  # Concord's parsed/canonical form, e.g. "John 3"
    book: str  # USFM code
    chapter: int
    verse: int | None


class ReadVerse(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str | None
    annotations: list[ReadAnnotation]


class ReadChapter(BaseModel):
    translation: str
    book: str
    chapter: int
    reference: str
    verses: list[ReadVerse]
