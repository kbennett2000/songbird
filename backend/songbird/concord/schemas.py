"""Pydantic models for the Concord responses songbird parses.

Only the fields songbird uses in Slice 0 are modelled; Concord may return more (Pydantic
ignores unknown fields by default).
"""

from pydantic import BaseModel


class Translation(BaseModel):
    id: str
    name: str
    language: str
    versification: str
    attribution: str | None = None


class TranslationsResponse(BaseModel):
    translations: list[Translation]


class ConcordHealth(BaseModel):
    status: str
    translation_count: int = 0
    verse_count: int = 0
    cross_ref_count: int = 0
    book_count: int = 0
    place_count: int = 0


class ChapterVerse(BaseModel):
    book: str  # USFM code, e.g. "JHN" — the canonical coordinate
    chapter: int
    verse: int
    reference: str
    text: dict[str, str | None]  # {translation_id: text-or-null}, even for one translation


class Chapter(BaseModel):
    reference: str
    translations: list[str]
    verses: list[ChapterVerse]


class Book(BaseModel):
    id: str  # USFM code
    name: str
    testament: str
    chapter_count: int | None = None
    canonical_order: int


class BooksResponse(BaseModel):
    books: list[Book]


class CrossRefTarget(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse_start: int
    verse_end: int | None = None
    reference: str


class CrossRefEntry(BaseModel):
    to: CrossRefTarget
    votes: int | None = None
    text: str | None = None  # the target's snippet (present when include_text=true)


class CrossRefResponse(BaseModel):
    cross_references: list[CrossRefEntry]


class SemanticResult(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    score: float
    text: str | None = None


class SemanticSearchResponse(BaseModel):
    results: list[SemanticResult]
