# songbird — Design Spec (v1)

**songbird** is a personal, self-hosted app for **annotating Scripture**: read a translation,
highlight a verse, attach a rich note behind it, find it again later by tag or by meaning.

**songbird is built on top of [Concord](https://github.com/kbennett2000/concord).** Concord runs on the network and exposes its REST
endpoints; **songbird is a separate app that consumes those endpoints** to read Scripture,
search, and look up geography. Concord is the foundation and the data/API provider; songbird
is the annotation app that sits on top of it and delivers the experience to the end user.
songbird depends on Concord; Concord knows nothing about songbird.

This is the founding spec. The **domain model and architecture are settled decisions**
(§1–§7); the **UX/interaction design is presented as options with recommendations** (§8) —
taste calls for the product owner to make when ready.

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
  line one, though there is one user today).
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

**`users`** — `id`, `name`, plus Argon2 auth fields **when auth lands**. Multi-user-ready
from the start (every annotation has `author_id`); a single default user until auth is built.

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
slice. **Slice 1 firmly defined; the rest a roadmap.** Each slice is a thin vertical cut, not
a horizontal layer.

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
- **Slice 8 — auth / multi-user.** Argon2 cookie-session (soap-journal pattern) — *if/when*
  wanted; deferred while single-user.
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

## 11. Open questions (resolve as slices reach them)

1. **Frontend reads Scripture via songbird's backend proxy, or directly from Concord?**
   (Lean: through songbird's backend, so songbird owns one API surface and can attach
   annotations to reading responses.) Resolve in slice 0/1.
2. **`scope_type = current` modeling** — store literal "current" + resolve at display, or
   resolve-at-creation into a one-translation subset? (Lean: resolve to a concrete subset.)
3. **Markdown ↔ TipTap wiring** — confirm the Markdown extension covers links + images + the
   formatting set; settle the round-trip in slice 1.
4. **Concord response caching** — none to start (call through every time); revisit only if
   performance warrants. Not a data-ownership change if added.
5. **The UX choices in §8** — yours to settle as the reading view becomes real.

None block starting. Slice 0 stands up the stack + the Concord HTTP client; slice 1 is the
core loop.
