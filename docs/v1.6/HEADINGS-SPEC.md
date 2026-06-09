# songbird — Section headings in the reader (v1.6 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which owns the
> section headings this feature shows (they live in the translation sources and are exposed
> read-only). songbird stores none. See [the design spec](../v1/SPEC.md) for that relationship.

Print and study Bibles break a chapter into titled passages — "The Creation", "The First Day",
"The Beatitudes". songbird's reader today shows an unbroken run of verses, so passage boundaries
and the shape of an argument are invisible at a glance. This feature renders those **section
headings inline in the reader**, between verses, so a chapter becomes scannable: you can see where
a story starts and ends and find a passage by its name. Headings are editorial structure, not
Scripture and not user content — a third, clearly-distinct layer alongside verse numbers and the
existing translator's-note markers.

This is the **first slice of the v1.2.0 fan-out epic** (headings, topical Bible, word study,
journeys). It is gated on a **shared** Concord pin bump (Slice 0 below), which unlocks all four
features at once — not just this one.

---

## 1. What this is (and is not)

**Is:** the section headings for the chapter you're reading, in the current translation, rendered
inline as block headings immediately before the verse each one anchors. Best-effort and silent: a
translation that ships none (e.g. BSB) shows nothing, and if Concord is unreachable the reader
simply renders without headings — no banner, because a heading-less chapter is the normal state
for many translations and an error notice would be noise.

**Is not:** a navigation outline / table-of-contents UI (deferred — the data would support a
"jump to passage" later), no heading-scoped annotation or "note on this passage" (headings are not
verses; deferred), no cross-translation heading reconciliation (headings are per-translation, as
Concord serves them), no editing of headings (read-only, Concord-owned).

## 2. The boundary — a shared pin bump, then a thin songbird slice

This slice is **not** pure-songbird the way Verse-of-the-Day was. The headings endpoint exists only
in Concord **v1.2.0**; songbird is pinned to **v1.1.0** (`docker-compose.yml`,
`backend/tests/fixtures/concord-openapi.json` at `info.version: "1.1.0"`). So it depends on a
prerequisite that is **shared across the whole v1.2.0 epic** and should be done once:

**Slice 0 — Concord pin bump (shared; its own PR).**
- `docker-compose.yml`: `ghcr.io/kbennett2000/concord:v1.1.0` → `:v1.2.0`.
- Regenerate `backend/tests/fixtures/concord-openapi.json` from Concord v1.2.0's published spec.
- `backend/tests/concord_contract_test.py`: update `test_fixture_is_the_pinned_concord_version`
  from `"1.1.0"` to `"1.2.0"`.
- Leaves the tree green on its own: songbird doesn't *call* any v1.2.0 endpoint yet, so the
  contract test still passes (it only checks that endpoints songbird calls exist in the fixture).
- **Unlocks headings, topics, strongs/words, and journeys simultaneously.** The three later
  features depend on this same Slice 0 and must not repeat it.

Everything in §3–§6 below is **Slice 1**, layered on top of Slice 0.

## 3. Concord contract used

`GET /v1/translations/{translation}/headings/{book}/{chapter}` →

```json
{
  "translation": "WEB",
  "book": "GEN",
  "chapter": 1,
  "total": 2,
  "headings": [
    { "book": "GEN", "chapter": 1, "before_verse": 1, "text": "The Creation",  "ordinal": 1, "reference": "Genesis 1:1" },
    { "book": "GEN", "chapter": 1, "before_verse": 3, "text": "The First Day", "ordinal": 2, "reference": "Genesis 1:3" }
  ]
}
```

`before_verse` is the verse the heading renders *above*; `ordinal` orders headings within the
chapter (and disambiguates two headings before the same verse). A known translation with no
headings for the chapter returns `headings: []` with **200**, not an error. Unknown
translation/book → 4xx. This mirrors the notes read exactly (`/v1/translations/{t}/notes/{b}/{c}`).

## 4. songbird changes

This is the same proxy-through shape as translator's notes; **`api/notes.py` is the template** for
the backend and `fetchNotes` / `notesByVerse` are the templates for the frontend.

- **Client** (`concord/client.py`): `get_headings(translation, book, chapter)` → a
  `HeadingsResponse`-shaped result. Mirror `get_notes` verbatim, including the error mapping: a
  Concord `400/404` → `ConcordNotFoundError`; any other HTTP error → `ConcordUnreachableError`.
  An empty-but-known result is a normal `200`, not an error.

- **Concord schema** (`concord/schemas.py`): add `SectionHeading` (`book, chapter, before_verse,
  text, ordinal, reference`) and `HeadingsResponse` (`translation, book, chapter, total,
  headings`), mirroring `NotesResponse`.

- **songbird API** (`api/headings.py`, new): a router (`prefix="/api/v1"`, `tags=["headings"]`)
  with `GET /headings/{translation}/{book}/{chapter}` → `response_model=list[SectionHeading]`,
  passing Concord's headings through verbatim. `ConcordNotFoundError` → `404 NOT_FOUND`;
  `ConcordUnreachableError` → `502 CONCORD_UNREACHABLE`. `api/schemas.py` gains the API-layer
  `SectionHeading` model (the response shape the frontend consumes — the same deliberate
  hand-mirror songbird already keeps between `concord/schemas.py` and `api/schemas.py`; the
  codegen question stays deferred per the epic plan). Mount the router in `main.py`
  (`headings_router`), beside `notes_router`.

- **Frontend — fetch** (`schemas.ts` + `lib/reader.ts`):
  - `schemas.ts`: `sectionHeadingSchema = z.object({ book: z.string(), chapter: z.number(),
    before_verse: z.number(), text: z.string(), ordinal: z.number(), reference: z.string() })`,
    a `sectionHeadingsSchema = z.array(sectionHeadingSchema)`, and the inferred `SectionHeading`
    type. Model it on `translatorNoteSchema`.
  - `lib/reader.ts`: `fetchHeadings(translation, book, chapter)` mirroring `fetchNotes` — `GET
    /headings/{translation}/{book}/{chapter}`, parsed with `sectionHeadingsSchema`.

- **Frontend — render** (`ReaderView.tsx`): this is the only non-mechanical part.
  - A `headingsQuery` keyed `["headings", translation, chapterBook, chapter]`, `queryFn`
    `fetchHeadings`, parallel to the existing `notesQuery`.
  - A `headingsByBeforeVerse` memo: `Map<number, SectionHeading[]>` keyed by `before_verse`, each
    bucket sorted by `ordinal`. Mirror the `notesByVerse` memo.
  - **Injection point (exact):** inside the existing `chapterQuery.data.verses.map((v) => …)`, wrap
    the return in a `Fragment key={v.verse}`. *Before* the verse's `<p id={`v-${v.verse}`}>`,
    render `headingsByBeforeVerse.get(v.verse) ?? []` as block headings — so a heading sits **above
    the whole verse row**: above the blue verse-number button and above `<VerseText>`. Multiple
    headings before one verse render in `ordinal` order. A heading whose `before_verse` matches no
    verse in the chapter is dropped (attachment is purely by verse-number match, exactly like
    notes).
  - **Element & style:** a real heading element (`<h3>`) for screen-reader structure, nested under
    the chapter's existing `<h2>` reference title. Visually it must read as a *third* layer,
    distinct from the blue verse-number superscripts and the violet translator's-note superscripts,
    and subordinate to the chapter `<h2>` (smaller/quieter than the title, set off with top space).
    Exact classes are cc's call within the frontend-design conventions; the requirement is the
    three-way visual distinction and the block placement.
  - **Error/empty:** render nothing and show **no banner** on error or empty (deliberate divergence
    from notes, which *does* banner a genuine outage — headings are pure enrichment and a missing
    heading is indistinguishable from a translation that ships none, so a notice would be noise).

## 5. Tests

- **Backend** (`headings_test.py`): returns a chapter's headings in order; `translation` /
  `book` / `chapter` passthrough; a known-but-empty result → `200 []`; unknown translation/book →
  `404 NOT_FOUND`; unreachable → `502`. `FakeConcordClient` gains `get_headings` (mirror its
  `get_notes`).

- **Frontend** (`ReaderView.test.tsx`): a heading renders before its `before_verse` verse (query
  by `role="heading"`); two headings before the same verse render in `ordinal` order; a chapter
  with no headings renders unchanged (no heading elements, **no banner**); on fetch error the
  reader renders verses with no headings and no banner. Add an MSW handler for
  `/headings/{translation}/{book}/{chapter}`.

- **Contract** (**required**): add `("GET", "/v1/translations/{}/headings/{}/{}")` to
  `_REQUIRED_ENDPOINTS` in `concord_contract_test.py`. (The fixture version bump to `1.2.0` is
  Slice 0; this line is what pins the headings endpoint specifically and belongs to Slice 1.)

## 6. Definition of done

Section headings render inline in the reader, above the verse each anchors, in `ordinal` order,
visually distinct from verse numbers and translator's-note markers and subordinate to the chapter
title, as real `<h3>` elements; a translation with none — or a Concord outage — shows nothing and
no banner; the Concord pin is `v1.2.0` and the contract test pins both the version and the
headings endpoint; backend + frontend tests, types, and lint are green; a `dev-notes.md` entry
records the slice (and notes that Slice 0 is the shared epic prerequisite).

## 7. PR shape (flag for your call)

- **Slice 0** is its own PR (shared infrastructure; load-bearing on its own).
- **Slice 1** is thin on both ends — a verbatim-mirror backend proxy and a small render change. It
  *could* ship as a **single backend+frontend PR** rather than the usual split, since neither half
  is independently load-bearing (a headings endpoint nothing calls, or a render with no data, each
  proves little alone). This is a **deliberate exception to the smallest-reviewable-unit default** —
  raised here for your decision, not assumed. If you'd rather keep the split, the seam is clean:
  backend proxy + contract line first, frontend render second.

## 8. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; songbird owns zero Scripture text — headings are
Concord-owned editorial data, proxied verbatim; branch + PR per slice; tests required; types/lint
clean; never self-merge, push to `main`, or `--force`.
