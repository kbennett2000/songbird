"""Request/response models for songbird's own API (annotations + the chapter overlay).

Kept separate from `concord/schemas.py` (which models Concord's responses).
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AnnotationCreate(BaseModel):
    book_usfm: str = Field(min_length=1, max_length=3)
    start_chapter: int = Field(ge=1)
    start_verse: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    end_verse: int = Field(ge=1)
    note_markdown: str
    color: str | None = None
    scope_type: str = "all"


class AnnotationUpdate(BaseModel):
    note_markdown: str | None = None
    color: str | None = None


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
    author_id: int
    created_at: datetime
    updated_at: datetime


class ReadVerse(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str | None
    annotations: list[AnnotationOut]


class ReadChapter(BaseModel):
    translation: str
    book: str
    chapter: int
    reference: str
    verses: list[ReadVerse]
