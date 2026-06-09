"""Request/response models for songbird's own API (annotations + the chapter overlay).

Kept separate from `concord/schemas.py` (which models Concord's responses).
"""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --- Auth (Slice 8) ---

USERNAME_PATTERN = r"^[A-Za-z0-9_-]+$"
UsernameStr = Annotated[str, Field(min_length=3, max_length=32, pattern=USERNAME_PATTERN)]
PasswordStr = Annotated[str, Field(min_length=8)]


class RegisterRequest(BaseModel):
    username: UsernameStr
    password: PasswordStr


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str | None
    is_admin: bool
    last_translation: str | None
    last_book: str | None
    last_chapter: int | None
    theme: str | None
    created_at: datetime


class UserUpdate(BaseModel):
    """Per-profile preference patch — reading position (translation + book + chapter) and the UI
    theme. All optional so one PATCH can save any subset; only the fields the client sent are
    applied (partial update via `model_fields_set`). No Concord round-trip — a preference write
    must not fail when Concord blips."""

    last_translation: str | None = Field(default=None, min_length=1, max_length=16)
    last_book: str | None = Field(default=None, min_length=1, max_length=3)
    last_chapter: int | None = Field(default=None, ge=1)
    theme: Literal["light", "dark", "system"] | None = Field(default=None)


class AuthEnvelope(BaseModel):
    user: UserResponse


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


class SermonNoteCreate(BaseModel):
    """Author a sermon note. The client sends only the human `reference` (e.g. "Joshua 6:1-16");
    the server resolves it through Concord to the canonical anchor — book + verse span (invariant
    4) — and the `book_order_index`. Coordinates stay server-authoritative (a client can't assert
    a wrong one), and a ranged reference covers every verse in the range."""

    title: str = Field(min_length=1)
    sermon_url: str = Field(min_length=1)
    reference: str = Field(min_length=1, max_length=128)
    event_date: date | None = None
    tags: list[str] = Field(default_factory=list)


class SermonNoteUpdate(BaseModel):
    """Edit a sermon note. Changing `reference` re-anchors the note: the server re-resolves it
    through Concord and updates the canonical span to match, so reference and coverage never
    drift apart. All coordinate logic stays server-side (invariant 4)."""

    title: str | None = Field(default=None, min_length=1)
    sermon_url: str | None = Field(default=None, min_length=1)
    reference: str | None = Field(default=None, min_length=1, max_length=128)
    event_date: date | None = None
    tags: list[str] | None = None


class SermonNoteOut(BaseModel):
    """A sermon note (songbird-owned). Canonical anchor + a stored display `reference`; the body
    is an external sermon URL. Always visible on every translation — there is no scope/in_scope
    concept (unlike an annotation)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    sermon_url: str
    reference: str
    book_usfm: str  # USFM code — canonical (overlay match key)
    book_order_index: int  # canonical sort order
    start_chapter: int
    start_verse: int
    end_chapter: int
    end_verse: int
    event_date: date | None
    tags: list[str]
    author_id: int
    created_at: datetime
    updated_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def _tag_names(cls, value: Any) -> list[str]:
        # Map ORM Tag objects → names (from_attributes); pass plain strings through.
        return [getattr(t, "name", t) for t in value]


# --- Import / Export (issue #41) ---


class AnnotationExport(BaseModel):
    """A portable annotation — canonical anchor + scope + tags + Markdown body, carried verbatim
    (invariant 6). No id/author/timestamps, so an export drops cleanly into any account."""

    book_usfm: str = Field(min_length=1, max_length=3)
    start_chapter: int = Field(ge=1)
    start_verse: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    end_verse: int = Field(ge=1)
    note_markdown: str
    color: str | None = None
    scope_type: str = "all"
    scope_translations: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class SermonNoteExport(BaseModel):
    """A portable sermon note — no id/author/timestamps, and no `book_order_index` (re-resolved
    from Concord on import so canonical order stays server-authoritative)."""

    title: str = Field(min_length=1)
    sermon_url: str = Field(min_length=1)
    reference: str = Field(min_length=1, max_length=128)
    book_usfm: str = Field(min_length=1, max_length=3)
    start_chapter: int = Field(ge=1)
    start_verse: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    end_verse: int = Field(ge=1)
    event_date: date | None = None
    tags: list[str] = Field(default_factory=list)


class ExportDocument(BaseModel):
    """The whole portable bundle of a user's songbird-owned notes. `version` lets a future import
    adapt older files; `exported_at` is informational (ignored on import)."""

    version: int = 1
    exported_at: datetime | None = None
    annotations: list[AnnotationExport] = Field(default_factory=list)
    sermon_notes: list[SermonNoteExport] = Field(default_factory=list)


class ImportOutcome(BaseModel):
    """Per-kind tally for one import run."""

    created: int = 0
    skipped: int = 0  # an exact duplicate of something already present (this run is idempotent)
    failed: int = 0  # rejected (e.g. unknown book / translation) — see ImportSummary.errors


class ImportSummary(BaseModel):
    annotations: ImportOutcome = Field(default_factory=ImportOutcome)
    sermon_notes: ImportOutcome = Field(default_factory=ImportOutcome)
    errors: list[str] = Field(default_factory=list)  # a few human-readable reasons for failures


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


class TopicSummary(BaseModel):
    """A topic from Concord's curated topical index (songbird owns none). `see_also` is another
    topic's id for a "See X" redirect (those carry no verses of their own), else null. Pure
    pass-through of Concord's topic data."""

    id: str
    name: str
    section: str
    see_also: str | None


class TopicVerse(BaseModel):
    """One verse curated under a topic (from Concord). Canonical coords (jump reuses navigation);
    `text` is the verse snippet in the read translation, or null when absent."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str  # human-readable, e.g. "John 3:16"
    text: str | None


class TopicDetail(TopicSummary):
    """A single topic's full record for the browse detail screen — the summary plus its verse
    count (0 for a "See X" redirect). Pass-through of Concord's topic data."""

    verse_count: int


class TopicsPageOut(BaseModel):
    """One page of the topics browse — `total` lets the client paginate ("Load more"). Mirrors
    PlacesPageOut: the client tracks limit/offset itself, so they aren't echoed here."""

    topics: list[TopicSummary]
    total: int


class WordTokenOut(BaseModel):
    """One tagged word of a verse (from Concord's original-language text). The
    strongs_id/morph_code/lemma/transliteration/gloss are null for untagged tokens (punctuation,
    particles) or a Strong's with no lexicon entry. Pure pass-through."""

    position: int
    surface_form: str
    strongs_id: str | None
    morph_code: str | None
    lemma: str | None
    transliteration: str | None
    gloss: str | None


class VerseWordsOut(BaseModel):
    """A verse's original-language tokens. Carries `text_id` (the tagged text, auto-selected by
    testament) so the client can choose direction (RTL for Hebrew) — NOT a bare token list."""

    reference: str
    text_id: str
    tokens: list[WordTokenOut]


class StrongsDetail(BaseModel):
    """A single Strong's lexicon entry (from Concord) — the lexical payoff. Pure pass-through."""

    strongs_id: str
    language: str
    lemma: str
    transliteration: str
    gloss: str
    definition: str
    source: str


class StrongsVerse(BaseModel):
    """One verse where a Strong's number occurs (the concordance row, from Concord). Canonical
    coords (jump reuses navigation); `text` is the verse snippet, or null. Structurally identical
    to TopicVerse but kept distinct, mirroring Concord's own model."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str  # human-readable, e.g. "John 1:1"
    text: str | None


class JourneySummary(BaseModel):
    """A curated journey's summary (from Concord). `dating` is null when genuinely debated. Pure
    pass-through of Concord's journey data."""

    id: str
    name: str
    scripture: str  # human-readable span, e.g. "Acts 13–14"
    dating: str | None
    stop_count: int


class JourneysPageOut(BaseModel):
    """One page of the journeys list — `total` lets the client paginate ("Load more"). Mirrors
    PlacesPageOut: the client tracks limit/offset itself, so they aren't echoed here."""

    journeys: list[JourneySummary]
    total: int


class JourneyStop(BaseModel):
    """One ordered stop of a journey (from Concord). Coordinates/confidence/status are null when
    the place has no confident location (honesty model) — such a stop is listed but not mapped.
    `reference` is the optional scripture citation for this leg."""

    ordinal: int
    place_id: str
    name: str | None
    friendly_id: str | None
    latitude: float | None
    longitude: float | None
    confidence: str | None
    status: str | None
    reference: str | None


class JourneyDetail(BaseModel):
    """A single journey's full record (from Concord): metadata + `source` + the one-reconstruction
    `note` (the honesty caveat — surfaced, not hidden) + the ordered stops."""

    id: str
    name: str
    scripture: str
    dating: str | None
    source: str
    note: str
    stops: list[JourneyStop]


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


class PlaceDetail(Place):
    """A single place's full record for the gazetteer detail screen — the summary `Place`
    (honesty model and all) plus the detail-only fields."""

    url_slug: str | None = None
    preceding_article: str | None = None
    modern_name: str | None = None
    verse_count: int = 0


class PlacesPageOut(BaseModel):
    """One page of the gazetteer browse — `total` lets the client paginate ("Load more")."""

    places: list[Place]
    total: int


class RandomVerse(BaseModel):
    """One random verse from Concord, for the Welcome "verse of the day" card. Canonical coords →
    "Open" reuses the verse jump. Fresh on every call (`/v1/random` is `no-store`)."""

    translation: str
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str


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


class KeywordResult(BaseModel):
    """An exact word/phrase match from Concord's keyword search. Canonical coords → jump reuses
    navigation. `snippet` is the verse text with the matched term(s) wrapped in `<mark>…</mark>`
    (the client renders the highlight by splitting on the tags — never as raw HTML). No `score`:
    a keyword match is literal, not ranked."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    snippet: str | None
    # Multi-translation keyword search: highlighted snippet per translation that matched (id →
    # snippet), top-ranked first. Null for a single matched translation (render `snippet` alone).
    matches: dict[str, str] | None = None


class NoteCrossReference(BaseModel):
    """A cross-reference carried by a translator's note (from Concord) → a target verse or
    range. Canonical coords, so the note popover reuses songbird's coordinate navigation."""

    to_book: str  # USFM code — canonical (jump reuses navigation directly)
    to_chapter: int
    to_verse_start: int
    to_verse_end: int | None
    reference: str  # human-readable, e.g. "Romans 5:8"


class TranslatorNote(BaseModel):
    """One translator's note (from Concord). Translation-specific: `char_offset` is a point
    anchor into THAT translation's verse text where the marker attaches. songbird stores
    none of this — it's a pass-through of Concord's notes data."""

    book: str  # USFM code — canonical (the note's anchor)
    chapter: int
    verse: int
    reference: str  # human-readable, e.g. "John 3:16"
    type: str | None  # tn | sn | tc | map | null (plain footnote)
    text: str
    char_offset: int  # point anchor into the verse text — where the marker attaches
    marker: str | None  # source marker (e.g. NET's footnote number)
    ordinal: int  # stable order within a verse
    cross_references: list[NoteCrossReference]


class SectionHeading(BaseModel):
    """One section heading (from Concord) — an editorial passage title that renders above the
    verse it anchors. Per-translation, read-only; songbird stores none — a pass-through of
    Concord's headings data. `before_verse` is the verse the heading sits above; `ordinal`
    orders headings within the chapter (and disambiguates two before the same verse)."""

    book: str  # USFM code — canonical (the heading's anchor)
    chapter: int
    before_verse: int  # the verse this heading renders immediately above
    text: str
    ordinal: int  # order within the chapter
    reference: str  # human-readable, e.g. "Genesis 1:1"


class StudyNoteResult(BaseModel):
    """One keyword match from Concord's translator's/study notes search ("Study notes" on the
    Search page — distinct from the user's own "Your notes"). Canonical coords → jump reuses
    navigation. `snippet` is the note text with the matched term(s) wrapped in `<mark>…</mark>`
    (the client renders the highlight by splitting on the tags — never as raw HTML)."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    translation: str  # which translation's notes the hit came from
    type: str | None  # tn | sn | tc | map | other → a readable badge client-side
    snippet: str | None


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
    # Sermon notes covering this verse — always present regardless of translation (no scope).
    sermon_notes: list[SermonNoteOut]


class ReadChapter(BaseModel):
    translation: str
    book: str
    chapter: int
    reference: str
    verses: list[ReadVerse]
