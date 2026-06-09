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


class TopicSummary(BaseModel):
    """A topic from Concord's curated topical index (songbird owns none). `see_also` is another
    topic's id for a "See X" redirect (those carry no verses of their own), else null."""

    id: str
    name: str
    section: str
    see_also: str | None = None


class VerseTopicsResponse(BaseModel):
    """The topics a verse appears under (the reverse lookup) — the full deduped union."""

    reference: str
    total: int
    topics: list[TopicSummary]


class TopicVerse(BaseModel):
    """One verse curated under a topic. `text` is null when not requested or absent."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str | None = None


class TopicVersesResponse(BaseModel):
    """A page of the verses curated under a topic, echoing the request state. `translation` is
    null unless include_text=true."""

    id: str
    translation: str | None = None
    include_text: bool
    limit: int
    offset: int
    total: int
    verses: list[TopicVerse]


class TopicsResponse(BaseModel):
    """A page of the topics browse: the echoed filter/pagination state, total count, and
    summaries. `total` drives pagination."""

    q: str | None = None
    section: str | None = None
    limit: int
    offset: int
    total: int
    topics: list[TopicSummary]


class TopicDetail(BaseModel):
    """A single topic's full detail plus its verse count (0 for a "See X" redirect)."""

    id: str
    name: str
    section: str
    see_also: str | None = None
    verse_count: int


class WordTokenOut(BaseModel):
    """One tagged word of a verse (from Concord's original-language text). `surface_form` is the
    word as printed; the lemma/transliteration/gloss/strongs_id/morph_code are null for untagged
    tokens (punctuation, particles) or a Strong's with no lexicon entry."""

    position: int
    surface_form: str
    strongs_id: str | None = None
    morph_code: str | None = None
    lemma: str | None = None
    transliteration: str | None = None
    gloss: str | None = None


class VerseWordsResponse(BaseModel):
    """A verse's tagged original-language tokens. `text_id` is the tagged text used (auto-selected
    by testament: OT → Hebrew/OSHB, NT → Greek/SBLGNT). A valid ref with no tagged original
    (e.g. deuterocanon) returns tokens: [] (200), not an error."""

    reference: str
    text_id: str
    total: int
    tokens: list[WordTokenOut]


class StrongsDetail(BaseModel):
    """A single Strong's lexicon entry's full detail, including the definition and its source."""

    strongs_id: str
    language: str
    lemma: str
    transliteration: str
    gloss: str
    definition: str
    source: str


class StrongsVerse(BaseModel):
    """One verse where a Strong's number occurs (the concordance row). `text` is null when not
    requested or absent. Structurally identical to TopicVerse but kept distinct, mirroring
    Concord's own model."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str | None = None


class StrongsVersesResponse(BaseModel):
    """A page of the verses where a Strong's number occurs (the concordance), echoing the request
    state. `text_id` is the tagged text searched; `translation` is null unless include_text=true."""

    strongs_id: str
    text_id: str
    translation: str | None = None
    include_text: bool
    limit: int
    offset: int
    total: int
    verses: list[StrongsVerse]


class JourneySummary(BaseModel):
    """A curated journey's summary (Concord SPEC v7) — metadata + its stop count. `dating` is null
    when genuinely debated. songbird owns no journey data; pure pass-through."""

    id: str
    name: str
    scripture: str
    dating: str | None = None
    stop_count: int


class JourneysResponse(BaseModel):
    """A page of journeys: the echoed pagination state, total count, and summaries."""

    limit: int
    offset: int
    total: int
    journeys: list[JourneySummary]


class JourneyStop(BaseModel):
    """One ordered stop of a journey, resolved to its place. Coordinates/confidence/status are null
    when the place has no confident location (the honesty model rides along — such a stop is listed
    but not mapped). `reference` is the optional scripture citation for this leg."""

    ordinal: int
    place_id: str
    name: str | None = None
    friendly_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    confidence: str | None = None
    status: str | None = None
    reference: str | None = None


class JourneyDetail(BaseModel):
    """A single journey's full detail: its metadata — including `source` and the one-reconstruction
    `note` (the honesty caveat) — plus its ordered stops."""

    id: str
    name: str
    scripture: str
    dating: str | None = None
    source: str
    note: str
    stops: list[JourneyStop]


class PlaceJourneysResponse(BaseModel):
    """The journeys that pass through a place (the inverse lookup): the full deduped set."""

    id: str
    total: int
    journeys: list[JourneySummary]


class Place(BaseModel):
    """A place named in Scripture, with Concord's honesty model: coordinates + confidence are
    null for unknown/symbolic/multiple places — surfaced, not hidden."""

    id: str  # OpenBible id, e.g. "a15257a"
    friendly_id: str
    name: str
    type: str
    latitude: float | None = None
    longitude: float | None = None
    confidence: str | None = None  # "high" | "medium" | "low" | null
    confidence_score: int | None = None
    status: str  # identified | disputed | unknown | symbolic | multiple


class VersePlacesResponse(BaseModel):
    places: list[Place]


class PlacesPage(BaseModel):
    """One page of the gazetteer browse (`/v1/places`). `total` drives pagination."""

    places: list[Place]
    total: int


class PlaceDetail(Place):
    """A single place's full record (`/v1/places/{id}`) — the summary `Place` (honesty model and
    all) plus the detail-only fields the gazetteer screen shows."""

    url_slug: str | None = None
    preceding_article: str | None = None
    modern_name: str | None = None
    verse_count: int = 0


class PlaceVerse(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str


class PlaceVersesResponse(BaseModel):
    verses: list[PlaceVerse]


class SemanticResult(BaseModel):
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    score: float
    text: str | None = None


class SemanticSearchResponse(BaseModel):
    results: list[SemanticResult]


class _RandomVerseInner(BaseModel):
    """The inner verse object Concord nests under `verse` in its `/v1/random` body."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str


class _ConcordRandomVerse(BaseModel):
    """Concord's `/v1/random` wire shape: a top-level `translation` + the nested verse object.
    Flattened into the public `RandomVerse` so the rest of songbird sees one flat record."""

    translation: str
    verse: _RandomVerseInner


class RandomVerse(BaseModel):
    """One random verse from Concord (`/v1/random`), flattened. `no-store` on Concord's side, so
    every call is a fresh verse — there's nothing to cache."""

    translation: str
    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    text: str

    @classmethod
    def parse_concord(cls, payload: object) -> "RandomVerse":
        """Validate Concord's nested `/v1/random` body and flatten it into this record."""
        wire = _ConcordRandomVerse.model_validate(payload)
        return cls(
            translation=wire.translation,
            book=wire.verse.book,
            chapter=wire.verse.chapter,
            verse=wire.verse.verse,
            reference=wire.verse.reference,
            text=wire.verse.text,
        )


class KeywordResult(BaseModel):
    """One exact word/phrase match from Concord's `/v1/search`. Concord returns the verse as a
    `snippet` with the matched term(s) wrapped in `<mark>…</mark>` for highlighting; there is no
    relevance score (a keyword match is literal, not ranked)."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    snippet: str | None = None  # verse text with <mark>…</mark> around the matched term(s)
    # In multi-translation mode, the highlighted snippet per translation that matched (id →
    # snippet), top-ranked first. Absent for legacy single-translation responses.
    matches: dict[str, str] | None = None


class KeywordSearchResponse(BaseModel):
    hits: list[KeywordResult]
    # The translations actually searched (Concord echoes this back; `*` expands to all loaded).
    translations: list[str] | None = None


class NoteCrossReference(BaseModel):
    """A cross-reference carried by a translator's note → a target verse or range. Canonical
    coordinates (so the popover reuses songbird's coordinate navigation)."""

    to_book: str  # USFM code — canonical
    to_chapter: int
    to_verse_start: int
    to_verse_end: int | None = None
    reference: str


class TranslatorNote(BaseModel):
    """One translator's note: its canonical anchor, the `char_offset` point a client uses to
    place the marker in the verse text, and the note's own cross-references."""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    type: str | None = None  # tn | sn | tc | map | null (plain footnote)
    text: str
    char_offset: int
    marker: str | None = None
    ordinal: int
    cross_references: list[NoteCrossReference]


class NotesResponse(BaseModel):
    """A passage's translator's notes. A known translation with no notes returns notes: []
    (200), not an error — every translation on the public image ships zero notes."""

    translation: str
    book: str  # USFM code — canonical
    chapter: int
    verse: int | None = None
    total: int
    notes: list[TranslatorNote]


class SectionHeading(BaseModel):
    """One section heading — editorial passage title ("The Creation") that renders above the
    verse it anchors. Concord-owned, per-translation; songbird stores none. `before_verse` is
    the verse the heading sits above; `ordinal` orders headings within the chapter."""

    book: str  # USFM code — canonical
    chapter: int
    before_verse: int
    text: str
    ordinal: int
    reference: str  # human-readable, e.g. "Genesis 1:1"


class HeadingsResponse(BaseModel):
    """A chapter's section headings in one translation. A known translation with no headings
    returns headings: [] (200), not an error — most translations ship none."""

    translation: str
    book: str  # USFM code — canonical
    chapter: int
    total: int
    headings: list[SectionHeading]


class NoteSearchHit(BaseModel):
    """One keyword match from Concord's `/v1/notes/search` over its translator's/study notes.
    Tolerant — only the fields songbird renders. The note arrives as a `snippet` with the matched
    term(s) wrapped in `<mark>…</mark>`. (Concord also returns char_offset/marker/ordinal; not
    needed for v1 search rendering, so they're ignored.)"""

    book: str  # USFM code — canonical
    chapter: int
    verse: int
    reference: str
    translation: str  # which translation's notes the hit came from
    type: str | None = None  # tn | sn | tc | map | other
    snippet: str | None = None  # note text with <mark>…</mark> around the matched term(s)


class NoteSearchResponse(BaseModel):
    hits: list[NoteSearchHit]
