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
