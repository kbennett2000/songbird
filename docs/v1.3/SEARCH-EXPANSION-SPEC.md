# songbird — Search Expansion (v1.3 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which provides
> all Scripture text, search, and notes. See [the design spec](../v1/SPEC.md) for that
> relationship. This spec adds two Concord capabilities songbird does not yet use, behind one
> shared prerequisite.

Concord v5 added two things songbird doesn't expose yet: **keyword search across translations**
(`/v1/search?translations=`) and **keyword search over translator's notes** (`/v1/notes/search`).
This spec brings both into songbird's Search page. Both depend on a Concord version bump that is
load-bearing in its own right, so the bump is **Slice 0**.

Work splits into three PRs, each a thin vertical slice that ships on its own:

- **Slice 0 — Concord pin → v1.1.0** (prerequisite for everything below)
- **Slice 1 — Feature A: multi-translation keyword search**
- **Slice 2 — Feature B: notes ("Study notes") keyword search**

Slices 1 and 2 are independent of each other; both depend only on Slice 0.

---

## 1. What this is (and is not)

**Is:** keyword Scripture search that searches **all loaded translations by default**, with the
ability to narrow to a chosen subset; and a new, distinct **"Study notes"** search section that
surfaces Concord's translator's/study/text-critical notes by keyword. Both reuse the existing
Search page and the existing `<mark>` highlight rendering.

**Is not:** semantic search changes (semantic is translation-agnostic by Concord's design — it
ranks in WEB meaning-space and renders in one display translation; "search all translations" has
no meaning for it, per Concord's own docs); no semantic search *of notes* (Concord exposes no
embed-arbitrary-text endpoint — keyword is the honest stand-in); no new search filters beyond
what each slice states.

## 2. The three result types — keep them crisply distinct

The Search page already shows two result categories. This spec adds a third. They are easy to
conflate and **must not be**, in copy or in code:

| Section | What it searches | Owner | Slice |
|---|---|---|---|
| **Scripture** | Concord verse text (semantic or keyword) | Concord | A extends keyword |
| **Your notes** | the **user's own annotations** | songbird (own DB) | exists, unchanged |
| **Study notes** | Concord's **translator's/study/text-critical notes** | Concord | B (new) |

"Your notes" is the user's private annotation data, searched via songbird's own
`/annotations?q=` (Concord-free). "Study notes" is Concord's footnote corpus. Different data,
different owner, different endpoint. Name them as above throughout.

---

## Slice 0 — Concord pin → v1.1.0 (prerequisite)

### Why this is load-bearing, not housekeeping

`docker-compose.yml` pins `ghcr.io/kbennett2000/concord:v1.0.0`. That image **predates** the
endpoints this work needs, and one already-shipped feature:

- **No `/v1/search?translations=`** — multi-translation search is v5. (Feature A needs it.)
- **No `/v1/notes/search`** — notes search is v5. (Feature B needs it.)
- **No `/v1/translations/{t}/notes/{b}/{c}`** — the notes passage read is v4, absent from
  v1.0.0. songbird's **translator's-notes reader markers already ship**, but against v1.0.0 the
  route 404s on every translation, so the reader shows a misleading "unavailable (is Concord
  reachable?)" notice. The bump **resurrects a shipped feature**, flipping 404 → an honest
  empty `200` (no notes on the stock image) or real notes (if an operator bakes them in).
- **CORS `Vary: Origin`** cache-poisoning fix shipped in v1.0.2 (carried forward in v1.1.0).

Geography (`/v1/places*`, `/v1/verses/{ref}/places`) and `/v1/random` already exist at v1.0.0,
so the map and the two bonus slices (v1.4/v1.5) are not blocked by missing endpoints — but they
ride this same bump and benefit from the CORS fix.

> **Reality note (Slice 0 outcome, 2026-06-07).** The empirical gate below caught that the
> published `concord:v1.0.2` image **predated v5** (`/v1/notes/search` 404'd; `/v1/search`
> ignored `?translations=`). v5 was cut and published as a **new release, `v1.1.0`** — not a
> re-tagged v1.0.2. So this slice moves the whole pin to `v1.1.0` *together*: the
> `docker-compose.yml` runtime, the contract fixture (`tests/fixtures/concord-openapi.json`,
> **regenerated** from v1.1.0), the contract test's `assert version == "1.1.0"`, and the nightly
> workflow (`.github/workflows/nightly-concord.yml`). The earlier assumption that these "already
> target v1.0.2 / need no fixture change" was wrong: the committed v1.0.2 fixture itself predated
> v5 (no `/v1/notes/search`, no `translations` param).

### Acceptance gate — verify the image before building on it

**First step, before any code:** pull `ghcr.io/kbennett2000/concord:v1.1.0` and confirm it
actually serves `/v1/search?translations=*`, `/v1/notes/search`, and
`/v1/translations/{t}/notes/{b}/{c}` (curl them; notes endpoints return `200` with an empty list
on the stock image — that is success, not failure). **If the pinned image predates v5**
(endpoints 404), STOP and surface it: a fresh Concord image must be cut from Concord `main` and
published first. Do not start Slice 1/2 until this passes.

### Changes

- `docker-compose.yml`: `concord` image tag `v1.0.0` → `v1.1.0`.
- `tests/fixtures/concord-openapi.json`: regenerate from the v1.1.0 image's `/openapi.json`
  (now carries `/v1/notes/search` and the `translations` param).
- `backend/tests/concord_contract_test.py`: `assert version == "1.0.2"` → `"1.1.0"`.
- `.github/workflows/nightly-concord.yml`: pinned image `v1.0.2` → `v1.1.0`.
- `docs/dev-notes.md`: add a Slice 0 entry recording the bump, the gate's resurrected-notes
  finding, and the verification result.
- Reader notes notice: if the reader surfaces a notes-fetch failure as a user-visible notice,
  adjust so an **empty/`200`** notes response shows **no notice** (markers simply absent); a
  genuine Concord outage still surfaces normally. (Small; the bump is what makes the fix correct.)

### Definition of done

- Image verification above passes (recorded in dev-notes).
- Full existing suite green; nightly live suite (now v1.1.0) green.
- Reader: translator's-notes path no longer 404s; no misleading notice on the stock (no-notes)
  image.
- `docker compose up` → both services healthy. Fixture, contract test, and nightly now pin 1.1.0.

### Risk

Low. Concord's v4/v5 are purely additive (no schema rewrites, per Concord's CLAUDE.md); the CORS
change is a correctness fix. No songbird-breaking change is expected.

---

## Slice 1 — Feature A: multi-translation keyword search

### Intent

Keyword (exact word/phrase) Scripture search searches **all loaded translations by default**,
with a control to **narrow** to a chosen subset. Semantic search is unchanged in behavior.

### Boundary

Mostly a songbird slice; the one new dependency is Concord's `?translations=` param (v5), so it
needs Slice 0. **No Concord change.**

### Concord contract used

`GET /v1/search?q=…&translations=KJV,WEB,…` (or `translations=*` for all). In multi-translation
mode each hit carries `matches: {translation_id: snippet}` (only the translations where that
verse matched) plus a flat `snippet` (the top-ranked translation's), and the response echoes
`translations: [...]`. Snippets wrap matched terms in `<mark>…</mark>`.

### songbird changes

- **Client** (`concord/client.py`): `keyword_search` takes `translations: list[str] | None`.
  When `None`, send `translations=*` (all); otherwise send the comma-joined ids. Drop the old
  singular `translation` param from this method — the Search page is the only caller and no
  longer needs single-translation keyword search. Keep the existing FTS5-punctuation handling:
  a `400/404/422` still maps to `ConcordNotFoundError` (→ presented as "no results", not an
  outage; a real outage is still a `502`).
- **Concord schema** (`concord/schemas.py`): `KeywordResult` gains
  `matches: dict[str, str] | None = None`; `KeywordSearchResponse` gains
  `translations: list[str] | None = None`. (Tolerant — only fields songbird reads.)
- **songbird API** (`api/search.py`): the `/keyword-search` endpoint takes
  `translations: str | None = None` (CSV; absent → all). `api/schemas.py` `KeywordResult` gains
  `matches: dict[str, str] | None`. Return hits including `matches`.
- **Frontend**
  - `schemas.ts`: `keywordResultSchema` gains `matches: z.record(z.string()).nullable().optional()`.
  - `lib/reader.ts`: `keywordSearch(q, translations?: string[], limit)` — sends `&translations=`
    (CSV) when narrowing; omits the param for "all" (backend defaults to all).
  - `SearchView.tsx`:
    - **Remove** the hardcoded `SEARCH_TRANSLATION = "KJV"`.
    - Add a **translation scope control**, shown in keyword mode: default **"All translations"**,
      with a multi-select (checklist/dropdown) of the loaded translations from
      `fetchTranslations()` to narrow. Surface which are selected.
    - **Render multi-translation hits**: per verse, show the reference once, then each matching
      translation's snippet from `matches`, **each labeled with its translation id** and
      `<mark>`-highlighted via the existing `markSegments`. One match (or a single-translation
      narrowing) renders as today (just the snippet). "Open" jumps to the verse in the reader.
    - **Semantic** mode unchanged, but it needs a single display translation now that the
      hardcode is gone: use the user's reading translation (`user.last_translation` via
      `useAuth`) when available, else a sensible default (first loaded translation, or keep `KJV`
      as the fallback constant). The scope control is **keyword-only**.

### Tests

- Backend (`keyword_search_test.py`): multi-translation request returns `matches`; absent param
  searches all (`*`); narrowing to a subset; single-translation narrowing; FTS5-punctuation →
  empty preserved. `FakeConcordClient.keyword_search` updated for the `translations`/`matches`
  shape.
- Frontend (`SearchView.test.tsx`): picker defaults to all; narrowing changes the request;
  multi-translation hit renders per-translation labeled, highlighted snippets. MSW handler updated.
- Contract (optional but nice): assert the `translations` param exists on `/v1/search` in the
  fixture.

### Definition of done

Keyword search defaults to all translations; hits group per verse with each matching
translation's snippet labeled + highlighted; narrowing works; semantic behavior unchanged (now
displays in the reading translation); tests/types/lint green.

---

## Slice 2 — Feature B: notes ("Study notes") keyword search

### Intent

Search Concord's translator's/study/text-critical notes by keyword — a new **third** section on
the Search page: **"Study notes"**, distinct from "Scripture" and "Your notes" (see §2).

### The dormant-on-stock reality (drives the UX)

The public Concord image ships **zero notes** (the richest source, NET, is copyrighted; notes are
user-supplied). So on essentially every deployment, notes search returns empty — only an operator
who baked in their own legally-obtained notes gets hits. Therefore:

- The **"Study notes" section renders only when Concord returns at least one hit.** No empty
  section, no "no matching notes" line for the stock no-notes case. (Contrast "Your notes", which
  always renders — the user has their own.)
- This section is **best-effort**: any failure on this call (client error *or* unreachable) is
  swallowed to empty, so the section simply doesn't appear and **never degrades** the Scripture
  or Your-notes results. The Scripture section is already the page's Concord-health signal (it
  shows "Couldn't search (is Concord reachable?)" on outage), so a redundant error here would be
  noise. This is a deliberate divergence from the Scripture-search error handling — note it in
  the code.

### Boundary

Pure songbird slice over Concord's v5 `/v1/notes/search`; needs Slice 0. **No Concord change.**

### Concord contract used

`GET /v1/notes/search?q=…` (v1 of this feature is **q-only**; `type`/`book`/`translation`
filters are deferred). Each hit: `book, chapter, verse, reference, translation, type`
(tn/sn/tc/map/other), `char_offset, marker, ordinal, snippet` (with `<mark>`).

### songbird changes

- **Client** (`concord/client.py`): `search_notes(q, limit=20)` → `NoteSearchResponse`.
- **Concord schema** (`concord/schemas.py`): `NoteSearchHit` (`book, chapter, verse, reference,
  translation, type, snippet`; `char_offset/marker/ordinal` optional — not needed for v1
  rendering) and `NoteSearchResponse` (`hits`).
- **songbird API** (`api/search.py`): `GET /api/v1/study-notes-search?q=` →
  `list[StudyNoteResult]`. Name chosen to avoid collision with the user's-own-notes search
  (`/annotations?q=`) and its `note-search` query key. **Swallow all non-success to `[]`** (see
  the best-effort rule above). `api/schemas.py` `StudyNoteResult` (`book, chapter, verse,
  reference, translation, type, snippet`).
- **Frontend**
  - `schemas.ts`: `studyNoteResultSchema` + `studyNoteResultsSchema`.
  - `lib/reader.ts`: `searchStudyNotes(q)` → `/study-notes-search`.
  - `SearchView.tsx`: a **"Study notes"** section, placed **after "Your notes"** (the
    rarely-populated reference layer sits last; easy to reorder). **Renders only when
    `data && data.length > 0`.** Each hit: reference heading + a small **type badge**
    (Translator's note / Study note / Text-critical / Map, from tn/sn/tc/map) + the
    `<mark>`-highlighted snippet + "Open in reader" (jumps to the verse; the reader's existing
    translator's-notes markers handle the rest). Fires only when `query.length > 0`.

### Tests

- Backend (`notes_search_test.py`): hits returned and shaped; empty when Concord has none;
  client error/unreachable → `[]` (section absent). `FakeConcordClient.search_notes` added.
- Frontend (`SearchView.test.tsx`): Study-notes section hidden when empty; shown with hits; type
  badge + highlight render; "Open in reader" target. MSW handler for `/study-notes-search`.
- Contract (**required**): add `("GET", "/v1/notes/search")` to `_REQUIRED_ENDPOINTS` in
  `concord_contract_test.py` (it is in the v1.1.0 fixture).

### Definition of done

Searching surfaces matching Concord notes in a distinct "Study notes" section that appears only
on hits; type + highlight render; jump works; the section never degrades the other two; the
contract test now pins `/v1/notes/search`; tests/types/lint green.

---

## What's deferred (not this spec)

- Notes-search filters (`type`, `book`, `translation`) — the endpoint supports them; the v1 of
  Feature B is q-only.
- Semantic search *of notes* — awaits a Concord embed-arbitrary-text endpoint (does not exist).
- Keyword search `book` filter in the UI, semantic `min_score`, cross-ref `min_votes`/paging —
  parameter-level completeness, not part of this work.
- The two other Concord gaps — **place browse / gazetteer** (`docs/v1.4/PLACES-SPEC.md`) and
  **verse of the day** (`docs/v1.5/RANDOM-VERSE-SPEC.md`) — are separate slices, gated on the
  same Slice 0 bump.

## Invariants this work must respect (CLAUDE.md)

- songbird consumes Concord over HTTP through the single `ConcordClient`; no embedding, no
  bundled Bible/notes text.
- Snippets render by splitting on `<mark>` tags via `markSegments` — **never** as raw HTML.
- Annotation anchoring (the canonical-coordinate bridge) is untouched here, but don't regress it.
- Branch per slice; PR per slice; tests required; Pyright-strict + Ruff clean (backend),
  TypeScript-strict + lint clean (frontend); a dev-notes entry per slice. **Never** self-merge,
  push to `main`, or `--force`.
