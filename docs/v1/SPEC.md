# songbird — Design Spec (v0)

**songbird** is a personal, self-hosted app for **annotating Scripture**: highlight a verse,
attach a rich note behind it, find it again later by tag or by meaning. It is built **on
Concord** — Concord serves the text (and search, and geography); songbird is what you write
in the margins of it.

This is the founding spec. Unlike the Concord specs, it has two registers on purpose: the
**domain model and architecture are written as settled decisions** (we worked them out
deliberately and they're locked); the **UX/interaction design is written as options with
recommendations** (§8) — taste calls for the product owner to make when ready, not decrees.

A note on intent, because it shapes every decision below: songbird is **built to last.**
soap-journal was the learning exercise — a complete, working app that taught the lessons.
Concord was the foundation extracted from those lessons. songbird is the payoff: the app
intended to grow. "Built to last" does **not** mean "built big on day one" — it means
**clean bones, named boundaries, spec-first, smallest-slice-first**, so the small thing can
become the large thing without a rewrite. The ambition lives in the roadmap; the discipline
lives in the slices.

---

## 1. What songbird is (and is not)

**Is:** a reading + annotation app. You read Scripture in a chosen translation; you mark
whole verses; you attach rich-text notes (Markdown/WYSIWYG — links, formatting, image
links) anchored to those verses; notes carry a date, an author, and semantic tags; you find
notes later by tag and (eventually) by meaning. Self-hosted, offline-first, single
deployable unit.

**Is not (for now):** a SOAP-style journal (that's soap-journal, complete and unchanged — a
future songbird *could* offer a SOAP template, but the core model here is annotation, not
the SOAP entry); a multi-tenant cloud service; a mobile app (Concord is LAN/in-process, the
mobile constraint is real — deferred).

**The core object is the annotation**, not the journal entry. soap-journal is entry-centric
(you write a dated entry that references a passage). songbird is **text-centric**: Scripture
is the spine, and notes are anchored annotations hanging off specific verses — closer to
marking up a study Bible than to keeping a journal.

## 2. The settled domain model (locked)

An **annotation** is:

- **Anchor** — a whole-verse span of Scripture, addressed by **canonical coordinates**: USFM
  book code + chapter + verse, as a range (a single verse is start == end). Whole-verse
  granularity is a deliberate choice (§4) — it sidesteps cross-translation wording/offset
  problems entirely.
- **Note** — rich text authored in a WYSIWYG editor, stored as **Markdown** (§6): supports
  hyperlinks, basic formatting, image links.
- **Translation scope** — which translations the annotation applies to / displays on. Three
  tiers, per the product owner: **all translations** (default), **the current translation
  only**, or **a chosen subset** (a checklist). The scope is independent of the anchor —
  the anchor is *which verse*, the scope is *in which translations the note shows*.
- **Metadata** — created date, updated date, and **author** (the schema is multi-user-ready
  from line one, even though there is one user today — §3).
- **Tags** — free-form semantic tags for later retrieval; the on-ramp to semantic search
  (§7).
- **Color** — an optional highlight color (a single default color is fine for v1;
  multi-color is a trivial later enhancement).

That is the whole model. Everything songbird does is reading Scripture and creating,
displaying, editing, and finding annotations.

## 3. Architecture

**Stack: reuse the soap-journal shape**, deliberately — because songbird is built to last,
*not* despite it. Familiarity is velocity, and the velocity belongs in getting the
*architecture* clean, not in relearning tooling. The future-proofing that matters is
boundary discipline (§4), which is stack-agnostic.

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async) + aiosqlite, Alembic (migrations),
  Pydantic v2 + pydantic-settings, Argon2 for auth (when auth lands). Mirrors soap-journal's
  proven backend.
- **Frontend:** React 18 + TypeScript (strict), Vite, Tailwind, React Router, TanStack
  Query, Zod. Mirrors soap-journal's proven frontend.
- **Editor:** **TipTap** (ProseMirror-based) for the WYSIWYG note editor — mature, React-
  native, extensible, serializes cleanly. (Rationale: it's the strongest React rich-text
  option, handles links/formatting/images out of the box, and round-trips to Markdown via a
  well-supported extension. Lexical was the alternative; TipTap's ecosystem and Markdown
  story win for our needs.)
- **Packaging:** single deployable unit — a multi-stage Dockerfile builds the Vite bundle,
  then one uvicorn process serves both the static SPA and the API. Offline-first, **zero
  outbound calls at runtime.** Same model as soap-journal and Concord.

**Concord embeds in-process** (this is the heart of the architecture):

- songbird's backend depends on Concord's **`bible-core`** (pure Python, stdlib sqlite3) and
  calls it **in-process** to read Bible text, cross-references, and geography. No HTTP to a
  Concord server, no second service, no extra startup step for the user — which is exactly
  the "zero extra steps / transparent" bar the product owner set. `bible-core` was built
  web-free and embeddable for precisely this.
- Later, songbird's backend depends on Concord's **`bible-semantic`** (the ML layer) for
  semantic search — also in-process (§7).
- songbird exposes its **own** thin REST API to its **own** React frontend (e.g.
  `GET /api/v1/read/{translation}/{book}/{chapter}`), and *internally* those handlers call
  `bible-core`. The frontend never talks to Concord directly; it talks to songbird, which
  embeds Concord. This is the in-process pattern: Concord is a **library** songbird calls,
  not a service songbird depends on.

**The async/sync boundary — a known, named design point** (surfaced by the soap-journal
recon): songbird is async (SQLAlchemy async + aiosqlite); `bible-core` is **sync** (stdlib
sqlite3). songbird's handlers call `bible-core` through a **threadpool**
(`asyncio.to_thread` / FastAPI's `run_in_threadpool`) so the sync DB calls don't block the
event loop. Not a blocker; just an explicit boundary to honor wherever `bible-core` is
called.

**Two databases, one data dir** (like soap-journal's `DATA_DIR` convention):
- songbird's **own** SQLite database holds annotations, tags, users — owned by songbird's
  SQLAlchemy models, migrated by Alembic.
- Concord's baked artifacts (`bible.db` now; `embeddings.db` + the int8 model when semantic
  lands) live in the same data dir, read by `bible-core` / `bible-semantic`. **songbird
  never writes to Concord's data** — it's read-only reference data.

**How songbird obtains Concord's baked data** (an architecture decision worth stating, with
its alternative): the lean is that songbird's **build** produces `bible.db` via `bible-core`'s
loaders from Concord's committed source data (the translation JSONs, cross-references, and
geocoding data) — the same way Concord's own Docker build bakes `bible.db` — so the artifact
is reproducible rather than a vendored blob. The alternative is to **vendor** Concord's
pre-built `bible.db` as a build input (simpler build, but a stale-blob risk and a coupling to
Concord's build output). Either keeps the runtime fully offline with the data baked in. *This
is the one architecture question I'd resolve explicitly during slice 1.*

## 4. The canonical-coordinate bridge — the named hard invariant

This is songbird's load-bearing invariant, the analogue of `bible-core`'s web-free rule, and
it exists to **not inherit soap-journal's limitation.** The soap-journal recon found that it
links journal entries to verses by **per-translation `verse.id`** — so an entry made against
NKJV won't match a BSB lookup of the same verse, because they're different rows. songbird
must not repeat this.

**The invariant: annotation anchors are ALWAYS canonical (USFM book + chapter + verse),
never a translation-specific row id.** An annotation is anchored to *John 3:16* — an
address, not a row in some translation's table. When songbird displays annotations while you
read a given translation, it **resolves the canonical anchor to that translation's verse via
`bible-core`** (which itself keys on canonical coordinates). Notes are translation-
independent addresses; rendering resolves per-translation.

Consequences this guarantees:
- A note shows up correctly in *every* translation it's scoped to, because it's pinned to
  the verse *address*, not the verse *text*.
- Concord's semantic-search hits and geography place→verse links — both canonical — line up
  with annotations for free. "Verses about anxiety" can light up "and you have 2 notes
  here."
- A future journeys/routes capability, or any other Concord feature, references the same
  coordinate system. songbird and Concord speak one address language.

This invariant gets a **test** in slice 1 (an annotation created while reading one
translation displays correctly when the reader switches to another), the way Concord's
foundation requirements were tested.

## 5. Data model (songbird's own database)

SQLAlchemy async models, Alembic-migrated. Sketch (refine in slice 1):

**`annotations`** — `id`, `book_usfm`, `start_chapter`, `start_verse`, `end_chapter`,
`end_verse` (the canonical anchor; single verse → start == end), `note_markdown` (the note
body), `color` (nullable; default highlight color), `scope_type`
(`all` / `current` / `subset`), `author_id`, `created_at`, `updated_at`.

**`annotation_translations`** — `annotation_id`, `translation_code` — the explicit subset
when `scope_type = subset` (empty for `all`; the single current code for `current`, or model
`current` as resolved-at-creation into a subset of one — decide in slice).

**`tags`** — `id`, `name` (unique). **`annotation_tags`** — `annotation_id`, `tag_id`
(many-to-many).

**`users`** — `id`, `name`, plus auth fields (Argon2 hash, sessions) **when auth lands**.
Multi-user-ready from the start (every annotation has `author_id`); a single default user
until auth is built (§ slice plan).

Indexes supporting the hot path: annotations by anchor (to fetch "all notes for this
chapter" fast), and by author.

## 6. Note storage format — Markdown, for durability

Notes are stored as **Markdown**, not as TipTap/ProseMirror JSON or raw HTML. Reason: songbird
is built to last, and Markdown is the **durable, portable, editor-agnostic** format — if the
editor is ever swapped, the notes survive as readable text. TipTap is configured to read/write
Markdown (via its Markdown support); the small wiring cost is worth the longevity. Markdown
covers everything the product owner asked for: hyperlinks, basic formatting, image links.
(HTML was the alternative — also portable, but Markdown is more durable and human-readable as
stored text. TipTap-native JSON was rejected: it's editor-locked.)

## 7. How Concord weaves in (over time, not all at once)

songbird consumes Concord's three capabilities, in increasing order of cost — and that order
drives the slice plan:

- **Bible text (now, slice 1):** `bible-core` read in-process — translations, books,
  chapters, verses. The reader is backed by Concord, not by a songbird-owned corpus. Small,
  pure, no ML.
- **Cross-references (cheap, mid):** `bible-core` already serves cross-references; songbird
  surfaces them for the passage you're reading. Pure data, no new dependency.
- **Geography (cheap, mid):** `bible-core` serves places + place↔verse links; songbird can
  show "places mentioned here" for a passage (and eventually a map). Pure data, no ML. (The
  honesty model carries through — unknown places show as unknown.)
- **Semantic search (heavy, late):** `bible-semantic` embedded in-process — find Scripture,
  and your own annotations, by **meaning**, not just keyword/tag. This is the one that drags
  in the int8 model (~313 MB) + ONNX runtime + vectors, and a one-time first-run model fetch
  + a startup warm-up. It goes **late**, on rails the cheaper slices already proved. (The
  product owner's "show a random verse during warm-up" idea — Concord's `random` capability
  — turns the one user-visible seam into a feature.)

The tags users write by hand (§2) are the bridge: tags are manual semantic retrieval;
`bible-semantic` is automatic semantic retrieval over the same notes.

## 8. The UX design space — options, not decrees

This is the half that's the product owner's taste, and where the app lives or dies. For each
decision: the options, the tradeoffs, and my recommendation. These are **for you to react to
when ready** — nothing here blocks writing the backend, and the recommendations are starting
points, not settled choices.

**8.1 — How do you invoke a highlight?**
- *(a) Tap/click a verse number* — verse numbers become the affordance; click one to
  highlight/annotate that verse. Clean, discoverable, works on touch and desktop.
- *(b) Select text, then a floating button appears* — closer to "highlighting" physically,
  but with whole-verse granularity the free-text selection is slightly at odds with
  verse-snapping (you'd snap the selection to whole verses anyway).
- *(c) A margin gutter* — a clickable strip beside the text; click beside a verse to
  annotate it. Very "study Bible margin," scales to showing existing-note markers (8.3).
- **Recommendation: (a) for the core gesture, possibly evolving toward (c)'s margin for
  *displaying* existing notes.** Verse-number-as-button is the simplest discoverable
  invocation given whole-verse granularity; the margin is where existing annotations live
  visually. They compose well.

**8.2 — Where does the note editor appear?**
- *(a) A side panel / drawer* — text stays put on the left, the editor opens on the right.
  Keeps reading context visible while writing. Best on desktop (your primary environment).
- *(b) Inline expansion* — the verse expands and the editor appears beneath it. Very direct,
  but pushes the text around and gets awkward for long notes.
- *(c) A modal* — focused writing, but hides the passage (bad — you want the verse visible
  while annotating it).
- **Recommendation: (a) side panel/drawer.** Keeps the Scripture you're annotating in view
  while you write, scales to long notes, and is the natural home for the TipTap editor on
  desktop.

**8.3 — How do existing annotations show in the text?**
- *(a) Background highlight on the verse* (the literal highlighter) + *(b) a margin marker*
  (a dot/icon beside annotated verses) — these aren't exclusive; the strong combination is
  **both**: the verse is tinted (the highlight color), and a margin marker signals "there's
  a note here," clicking it opens the note.
- **Recommendation: highlight color on the verse + a margin marker that opens the note.**
  The tint shows *what's* annotated at a glance; the marker is the affordance to *read* the
  note without cluttering the text inline.

**8.4 — The reading view layout.**
- A single comfortable reading column, with a margin gutter (8.1c/8.3) for annotation
  markers, and the note editor as a side panel (8.2a). Translation selector and a
  jump-to-reference bar in a header. **Recommendation: this — a centered reading column +
  margin + side panel** — it's the study-Bible feel, matches Concord's serif-and-parchment
  character, and uses desktop width well.

**8.5 — Choosing translation scope when writing a note.**
- A small control in the editor panel: a default of **All translations**, with a quick toggle
  to **This translation only**, and an expandable **checklist** for a subset.
  **Recommendation: default to All (the common case), one-tap "this translation only," and a
  "choose translations…" disclosure for the subset** — matches the three-tier model without
  cluttering the common path.

**8.6 — Tags UI.**
- A simple tag input on the note editor (type-to-add, autocomplete from existing tags), and a
  tag filter on a "browse notes" view. **Recommendation: type-ahead tag input on the editor;
  a faceted tag filter on the notes-browse view.** Keep it boring and fast.

These are the seams worth designing on purpose. We'll iterate on them as slices land —
seeing a real reading view will sharpen them more than arguing in the abstract.

## 9. Slice plan

Same discipline as Concord: smallest reviewable, load-bearing unit; spec-first; PR-per-slice;
never break a shipped slice. **Slice 1 is firmly defined; the rest is a roadmap, refined as
we go.** Each slice is a *thin vertical cut* through the whole app — never a horizontal layer
built in isolation.

- **Slice 1 — the core loop.** Open a chapter in one translation (reader backed by
  `bible-core` in-process), highlight a verse, write a rich-text (Markdown/TipTap) note in
  the side panel, save it (songbird's own DB), and see the highlight + note when you return
  to that chapter. Establishes: the repo + stack, `bible-core` embedding (with the
  threadpool boundary), the annotation schema + persistence, the canonical anchor + **the
  bridge invariant test** (§4), the TipTap editor, and the reading view skeleton. It ships;
  it's usable; it hits the riskiest thing (the annotation model + the bridge) first.
- **Slice 2 — translation switching + scope.** Multiple translations in the reader; the
  three-tier translation scope for annotations; prove an annotation displays correctly across
  translations per its scope (the bridge invariant, exercised for real).
- **Slice 3 — navigation.** Jump-to-reference bar (reuse `bible-core`'s reference parsing),
  book/chapter navigation.
- **Slice 4 — tags + browse.** Tag input on notes; a browse-notes view with tag filtering.
- **Slice 5 — cross-references.** Surface `bible-core` cross-references for the current
  passage.
- **Slice 6 — geography.** Surface `bible-core` places for the passage (and, per UX taste, a
  map); honesty model carried through.
- **Slice 7 — semantic search.** Embed `bible-semantic`; find Scripture and your own notes by
  meaning. The heavy slice (model footprint, first-run fetch, warm-up-with-a-verse), on proven
  rails.
- **Slice 8 — auth / multi-user.** Argon2 cookie-session (the soap-journal pattern), turning
  the multi-user-ready schema into real multi-user — *if/when* you want it; deferred while
  single-user.
- **Ongoing — deploy + polish.** Single-unit Docker, the offline `--network none` discipline.

Slice ordering mirrors Concord's lesson: cheap/pure capabilities first, the ML-heavy one
late, on rails the earlier slices proved.

## 10. Out of scope / deferred

- A SOAP-format entry mode (soap-journal does that, complete; a future songbird template
  could, but the core model here is annotation).
- Mobile (the Concord LAN/in-process constraint; deferred — soap-journal-mobile is the
  offline SOAP option).
- Sub-verse / word-level highlighting (whole-verse is the deliberate v1 granularity, §4).
- Multi-color highlighting beyond a default (trivial later enhancement).
- Cloud/multi-tenant hosting (self-hosted single-unit is the model).
- Replacing soap-journal (a someday question; soap-journal stays as-is for now).

## 11. Open questions (resolve as slices reach them)

1. **Concord data acquisition** (§3) — build `bible.db` via `bible-core` loaders at build
   time (reproducible, lean) vs. vendor Concord's pre-built artifact (simpler, stale risk).
   Resolve in slice 1.
2. **`scope_type = current` modeling** — store as a literal "current" + resolve at display,
   or resolve-at-creation into a one-translation subset? (Lean: resolve to a concrete subset
   so the stored intent is explicit.)
3. **Markdown ↔ TipTap wiring** — confirm the TipTap Markdown extension covers links +
   images + the formatting set cleanly; settle the round-trip in slice 1.
4. **Concord as a dependency** — path dependency, git submodule, or installed package? (Both
   are your repos; affects how songbird's build references `bible-core`.)
5. **The UX choices in §8** — yours to settle as the reading view becomes real.

None block starting. Slice 1 is well-defined; the spec is the bottle, the cellar is open.
