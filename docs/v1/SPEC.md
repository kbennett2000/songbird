# songbird — Design Spec (v1)

**songbird** is a personal, self-hosted app for **annotating Scripture**: read a translation,
highlight a verse, attach a rich note behind it, find it again later by tag or by meaning.

**songbird is built on top of Concord.** Concord runs on the network and exposes its REST
endpoints; **songbird is a separate app that consumes those endpoints** to read Scripture,
search, and look up geography. Concord is the foundation and the data/API provider; songbird
is the annotation app that sits on top of it and delivers the experience to the end user.
songbird depends on Concord; Concord knows nothing about songbird.

This is the founding spec. The **domain model and architecture are settled decisions**
(§1–§7); the **UX/interaction design is presented as options with recommendations** (§8) —
taste calls for the product owner to make when ready.

> **Status — what reality added.** This document is the *founding* design; it has held up
> well, but the app has shipped past it. Auth landed and is now mandatory (not the "if/when"
> of §9), and two feature families the original plan never named — **sermon notes** and
> **translator's notes** — plus **per-profile default translation** are now shipped. The
> founding sections below are left intact as the original reasoning; **§12 records what
> shipped beyond them**, and §9/§11 are annotated with how the roadmap and open questions
> actually resolved. Per the project rule, reality wins: read §12 for current truth.

**Built to last, built small.** soap-journal was the learning exercise; Concord is the
foundation; songbird is the app meant to grow. "Built to last" means clean bones, named
boundaries, spec-first, smallest-slice-first — not big on day one. Ambition lives in the
roadmap; discipline lives in the slices.

---

## 1. What songbird is (and is not)

**Is:** a reading + annotation app. You read Scripture in a chosen translation (text served
by Concord); you mark whole verses; you attach rich-text notes (Markdown/WYSIWYG — links,
formatting, image links) anchored to those verses; notes carry a date, an author, and
semantic tags; you find notes later by tag and (eventually) by meaning. Self-hosted, runs on
the same network as Concord.

**Is not (for now):** a SOAP-style journal (that's soap-journal, complete and unchanged); a
multi-tenant cloud service; a mobile app.

**The core object is the annotation**, not a journal entry. soap-journal is entry-centric;
songbird is **text-centric** — Scripture is the spine, and notes are anchored annotations
hanging off specific verses, like marking up a study Bible.

## 2. The settled domain model (locked)

An **annotation** is:

- **Anchor** — a whole-verse span of Scripture, addressed by **canonical coordinates**: USFM
  book code + chapter + verse, as a range (single verse → start == end). Whole-verse
  granularity is deliberate (§4) and sidesteps cross-translation wording problems entirely.
- **Note** — rich text authored in a WYSIWYG editor, stored as **Markdown** (§6): hyperlinks,
  basic formatting, image links.
- **Translation scope** — which translations the note applies to / displays on. Three tiers:
  **all translations** (default), **the current translation only**, or **a chosen subset**
  (a checklist). Scope is independent of the anchor — the anchor is *which verse*, the scope
  is *in which translations the note shows*.
- **Metadata** — created date, updated date, and **author** (schema multi-user-ready from
  line one; auth has since shipped, so `author` is now a real account — §12).
- **Tags** — free-form semantic tags for retrieval; the on-ramp to semantic search (§7).
- **Color** — an optional highlight color (one default color is fine for v1).

Everything songbird does is reading Scripture (via Concord) and creating, displaying,
editing, and finding annotations (its own data).

## 3. Architecture

songbird is its **own** full-stack app that **consumes Concord's HTTP API** over the network.
Concord runs somewhere reachable on the LAN — the same host or another machine (§ connection
config below) — and songbird is its client.

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async) + aiosqlite, Alembic (migrations),
  Pydantic v2 + pydantic-settings, Argon2 for auth (when it lands). Mirrors soap-journal's
  proven backend.
- **Frontend:** React 18 + TypeScript (strict), Vite, Tailwind, React Router, TanStack Query,
  Zod. Mirrors soap-journal's proven frontend.
- **Editor:** **TipTap** (ProseMirror-based) for the WYSIWYG note editor — mature,
  React-native, links/formatting/images out of the box, round-trips to Markdown.
- **Packaging:** single deployable unit — a multi-stage Dockerfile builds the Vite bundle,
  then one uvicorn process serves the static SPA + songbird's API.

**How songbird uses Concord — over HTTP:**

- songbird's backend calls **Concord's REST endpoints** over the network to read Scripture
  text (`/v1/verses`, `/v1/chapters/...`, `/v1/translations`), to search
  (`/v1/search`, later `/v1/semantic-search`), and to look up geography
  (`/v1/places...`, `/v1/verses/{ref}/places`) and cross-references
  (`/v1/cross-references/...`). Concord is the data/API provider; songbird is the client.
- songbird's **own backend** exposes its **own** REST API to its **own** React frontend
  (annotations, tags, and thin pass-throughs/proxies for reading where useful). The frontend
  talks to songbird; songbird talks to Concord. (Whether the frontend reads Scripture via
  songbird's backend proxy or — same network — calls Concord directly is a slice-1 detail;
  default lean is **through songbird's backend**, so songbird owns one coherent API surface
  and can attach annotation data to reading responses.)

**Concord connection config:** a single base URL (`CONCORD_BASE_URL`). songbird makes **no
assumption about where Concord lives** — it calls whatever URL it's given. Concord may be on
the **same host** or **any other machine on the LAN**, on any port; the location is purely
config. The default *value* is a sensible localhost address (so the common same-host case
works with zero config), but that's only a default — set `CONCORD_BASE_URL` to a LAN address
(e.g. `http://192.168.1.62:8000`) and songbird talks to Concord there instead. One config
value; no service discovery; no hardcoded "same server."

**When Concord is unreachable: error.** The real requirement is that Concord is **reachable**
at `CONCORD_BASE_URL` over HTTP — not that it's co-located. If a Concord call fails (server
down, network gone, wrong URL), songbird **surfaces a clear error** — it does **not** attempt
offline fallback, a bundled copy of the text, or graceful degradation. This is a deliberate
simplicity decision: Concord is a hard runtime dependency reached over HTTP, and its absence
is an error state, not a mode to design around. (Same-host is the maintainer's own
deployment and the zero-config default — a convenience, not an architectural constraint.)

**songbird owns only its annotation data.** songbird's **own** SQLite database (under a
configurable `DATA_DIR`, like soap-journal) holds annotations, tags, and users, via
songbird's SQLAlchemy models, Alembic-migrated. songbird stores **no** Bible text — that
always comes from Concord at request time. (Caching Concord responses for performance is a
possible later optimization, not a data-ownership change.)

## 4. The canonical-coordinate bridge — the named hard invariant

This is songbird's load-bearing invariant, and it exists to **not inherit soap-journal's
limitation** (its recon found it links entries by per-translation `verse.id`, so an NKJV
entry won't match a BSB lookup).

**The invariant: annotation anchors are ALWAYS canonical (USFM book + chapter + verse),
never a translation-specific id.** An annotation is pinned to an *address* — `JHN 3:16` —
not to a verse in some translation's rendering. This is **clean over HTTP**, because
**Concord's endpoints already speak canonical coordinates**: songbird reads a chapter from
Concord (which returns verses keyed by book/chapter/verse), overlays its annotations by
matching on those same coordinates, and the note shows correctly in *every* translation it's
scoped to — because it's pinned to the verse *address*, not the *text*.

Consequences this guarantees:
- A note displays correctly across every translation it's scoped to.
- Concord's semantic-search hits and geography place→verse links — both canonical — line up
  with songbird's annotations for free ("verses about anxiety" → "you have 2 notes here").
- One shared coordinate language between songbird and Concord, now and for any future Concord
  capability.

This invariant gets a **test** in slice 1 (an annotation created while reading one
translation displays correctly when the reader switches to another).

## 5. Data model (songbird's own database)

SQLAlchemy async models, Alembic-migrated. Sketch (refine in slice 1):

**`annotations`** — `id`, `book_usfm`, `start_chapter`, `start_verse`, `end_chapter`,
`end_verse` (canonical anchor; single verse → start == end), `note_markdown`, `color`
(nullable), `scope_type` (`all` / `current` / `subset`), `author_id`, `created_at`,
`updated_at`.

**`annotation_translations`** — `annotation_id`, `translation_code` — the subset when
`scope_type = subset`.

**`tags`** — `id`, `name` (unique). **`annotation_tags`** — `annotation_id`, `tag_id`.

**`users`** — `id`, `name`, plus Argon2 auth fields. Multi-user-ready from the start (every
annotation has `author_id`). _Shipped since:_ auth now exists and is mandatory — `username`
(unique), `password_hash`, `is_admin`, and `last_translation` columns, with a `sessions` table
for cookie-session auth, and a `sermon_notes` table alongside `annotations` (see §12).

Indexes for the hot path: annotations by anchor (fetch "all notes for this chapter" fast) and
by author. Translation codes match Concord's translation codes.

## 6. Note storage format — Markdown, for durability

Notes are stored as **Markdown**, not editor-native JSON or raw HTML — the durable, portable,
editor-agnostic format. If the editor is swapped later, the notes survive as readable text.
TipTap is configured to read/write Markdown. Markdown covers links + image links + the
formatting set the product owner asked for.

## 7. How Concord weaves in (over HTTP, over time)

songbird consumes Concord's capabilities in increasing order of cost — which drives the slice
plan:

- **Bible text (now, slice 1):** songbird reads translations/chapters/verses from Concord's
  endpoints. The reader is backed by Concord's API.
- **Cross-references (mid):** songbird calls Concord's `/v1/cross-references/...` to surface
  cross-refs for the passage.
- **Geography (mid):** songbird calls Concord's `/v1/places...` and `/v1/verses/{ref}/places`
  to show places for a passage (and, per UX taste, a map). Concord's honesty model carries
  through (unknown places show as unknown).
- **Semantic search (late):** songbird calls Concord's `/v1/semantic-search` to find
  Scripture by meaning, and combines it with songbird's own annotation search to find *notes*
  by meaning. No heavy ML inside songbird — Concord does the embedding; songbird makes an
  HTTP call. (This is a real advantage of the HTTP model: the 313 MB model and ONNX runtime
  stay in Concord, and songbird stays lean.)

Tags (§2) are the bridge: manual semantic retrieval now; Concord-powered semantic retrieval
over the same notes later.

## 8. The UX design space — options, not decrees

The product owner's taste, where the app lives or dies. Options + tradeoffs + my
recommendation, for you to react to when ready. None of this blocks the backend.

**8.1 — How to invoke a highlight?** (a) tap/click a verse number; (b) select text → floating
button; (c) a margin gutter. **Rec: (a)** verse-number-as-button (simplest given whole-verse
granularity), evolving toward (c)'s margin for *displaying* notes.

**8.2 — Where does the note editor appear?** (a) side panel/drawer; (b) inline expansion; (c)
modal. **Rec: (a) side panel** — keeps the verse in view while writing, scales to long notes,
natural home for TipTap on desktop.

**8.3 — How do existing annotations show in the text?** background highlight on the verse +
a margin marker that opens the note. **Rec: both** — tint shows what's annotated; marker is
the affordance to read the note without inline clutter.

**8.4 — Reading view layout.** **Rec:** a centered reading column + a margin gutter for
markers + the editor as a side panel; translation selector + jump-to-reference in a header.
Study-Bible feel, matches Concord's character.

**8.5 — Translation scope when writing.** **Rec:** default **All**, one-tap **this
translation only**, a **"choose translations…"** disclosure for the subset.

**8.6 — Tags UI.** **Rec:** type-ahead tag input on the editor; a faceted tag filter on a
browse-notes view.

We iterate on these as the reading view becomes real — seeing it beats arguing it cold.

## 9. Slice plan

Smallest reviewable, load-bearing unit; spec-first; PR-per-slice; never break a shipped
slice. Each slice is a thin vertical cut, not a horizontal layer.

> **Roadmap complete (and then some).** This S0–S8 plan has all shipped — and the real history
> went past it with slices the founding plan never named: the **map view** (v1.1),
> **translator's notes**, **sermon notes** (model → overlay → count badge → seed import → full
> CRUD), and **per-profile default translation**. The actual shipped order also differed from
> the list below (auth landed mid-stream, not last). The list is preserved as the original
> roadmap; **§12 is the current inventory.**

- **Slice 0 — skeleton & boot.** Repo skeleton in the soap-journal stack shape (FastAPI
  backend + React/Vite frontend, single-unit dev + Dockerfile), tooling
  (Ruff/Pyright/pytest; TS strict/lint), `CONCORD_BASE_URL` config, a `/healthz` that also
  reports **Concord reachability** (a ping to Concord's `/healthz`), and a trivial proof that
  songbird can call **one** Concord endpoint and render the result. Establishes the stack and
  the HTTP client to Concord.
- **Slice 1 — the core loop.** Read a chapter in one translation **from Concord**, highlight
  a verse, write a Markdown/TipTap note in the side panel, save it (songbird's own DB), and
  see the highlight + note when you return — overlaid on Concord's chapter by canonical
  coordinates. Establishes: the annotation schema + persistence, the canonical anchor + **the
  bridge invariant test** (§4), the editor, the reading-view skeleton.
- **Slice 2 — translation switching + scope.** Multiple translations from Concord; the
  three-tier translation scope; prove annotations display correctly across translations (the
  bridge, for real).
- **Slice 3 — navigation.** Jump-to-reference + book/chapter navigation (Concord's
  `/v1/verses/{ref}` resolution).
- **Slice 4 — tags + browse.** Tag input; a browse-notes view with tag filtering.
- **Slice 5 — cross-references.** Surface Concord cross-references for the passage.
- **Slice 6 — geography.** Surface Concord places for the passage (and, per taste, a map).
- **Slice 7 — semantic search.** Call Concord's `/v1/semantic-search`; combine with
  annotation search to find Scripture and notes by meaning.
- **Slice 8 — auth / multi-user.** Argon2 cookie-session (soap-journal pattern). _Shipped, and
  no longer optional:_ every route except the health probe and register/login is gated; data is
  author-scoped per user.
- **Ongoing — deploy + polish.** Single-unit Docker.

## 10. Out of scope / deferred

- A SOAP-format entry mode (soap-journal does that).
- Mobile.
- Offline operation / Bible-text fallback when Concord is unreachable (Concord is a hard HTTP
  dependency; its absence is an error — §3).
- Sub-verse / word-level highlighting (whole-verse is the deliberate v1 granularity).
- Multi-color highlighting beyond a default.
- Cloud / multi-tenant hosting.
- Replacing soap-journal.

## 11. Open questions (resolved)

All five have been settled by implementation:

1. **Frontend reads Scripture via songbird's backend proxy, or directly from Concord?**
   → **Through songbird's backend.** The SPA talks only to songbird; songbird talks to Concord
   via one `ConcordClient`, and the reader response carries annotations + sermon notes already
   overlaid.
2. **`scope_type = current` modeling** → kept as the literal `current` (alongside `all` and
   `subset`), resolved against the active translation at display time; `annotation_translations`
   holds the explicit list only for `subset`.
3. **Markdown ↔ TipTap wiring** → settled; TipTap reads/writes Markdown and notes are stored as
   Markdown (invariant 6).
4. **Concord response caching** → **none.** Every read calls through; no cache added.
5. **The UX choices in §8** → settled as the reader became real (verse-number-as-button, side
   panel editor, highlight + marker, type-ahead tags, default-All scope) — all shipped.

## 12. Implemented since v1 — what shipped beyond this spec

The founding spec above is preserved as written. This section is the **current inventory** of
what the app actually does, where it grew past the original plan. (Per-slice detail lives in
`docs/dev-notes.md`.)

**Auth & profiles (shipped, mandatory).** Argon2 cookie-session auth. `users` carries
`username` (unique), `password_hash`, `is_admin`, and `last_translation`; a `sessions` table
holds server-side sessions keyed by an httponly cookie. The first person to register claims the
default user / becomes owner. Every endpoint except `/healthz` and register/login is gated, and
annotations and sermon notes are **author-scoped** — you only see your own.

**Per-profile default translation.** `users.last_translation` plus `PATCH /api/v1/auth/me`
remembers each profile's translation; the reader opens to it.

**Sermon notes (a second annotation type).** A `sermon_notes` table pins a sermon — `title`,
`sermon_url`, `reference`, `event_date` — to a canonical verse span (same USFM coordinates as
annotations, so the bridge invariant §4 applies equally). They overlay in the reader (markers,
a count badge, and a newest-first stacked popover when several land on one verse), appear in the
Browse view, are taggable from the **shared** tag vocabulary, and have full CRUD. A one-time
**seed importer** transforms a soap-journal backup into sermon notes (with guards so it never
mutates the real backup). Unlike annotations, sermon notes have no translation scope — they're
always visible.

**Translator's notes.** A pass-through to Concord's per-chapter translator's-notes endpoint,
rendered as inline footnote markers with a popover in the reader. Pure proxy — no songbird data.

**Concord consumer contract test.** A test validates songbird's hand-written Concord types
against Concord's pinned OpenAPI schema, catching drift between the two services.

**Map view (v1.1).** Documented separately in `docs/v1.1/MAP-SPEC.md` and ADR 0001 — an offline
bundled basemap with honest pin placement.

**The data model, restated.** songbird's database now holds: `users`, `sessions`, `annotations`,
`annotation_translations`, `tags` (+ `annotation_tags`, `sermon_note_tags` joins), and
`sermon_notes` — seven Alembic migrations. Still **no Bible text** (invariant 5 intact).
