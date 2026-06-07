# CLAUDE.md — songbird

songbird is a personal, self-hosted app for **annotating Scripture**: read a translation,
highlight a verse, attach a rich Markdown note anchored to it, find it later by tag or
meaning.

**songbird is built on top of Concord.** Concord runs on the network and exposes its REST
endpoints; **songbird is a separate app that consumes those endpoints** over HTTP to read
Scripture, search, and look up geography. Concord is the foundation and the data/API
provider; songbird is the client that sits on top of it. songbird depends on Concord;
Concord knows nothing about songbird.

The design canon is `docs/v1/SPEC.md`. Read it. This file is the always-on rules.

---

## The posture: built to last, built small

songbird is the app intended to grow (soap-journal was the learning exercise; Concord is the
foundation). "Built to last" means **clean bones, named boundaries, spec-first,
smallest-slice-first** — not big on day one. Ambition lives in the roadmap; discipline lives
in the slices. Every slice is a thin vertical cut through the whole app that ships on its own
— never a horizontal layer built in isolation.

## Hard invariants (do not violate)

1. **songbird consumes Concord over HTTP. It does not embed Concord, and it does not bundle
   Bible text.** songbird calls Concord's REST endpoints (`/v1/verses`, `/v1/chapters/...`,
   `/v1/translations`, `/v1/search`, later `/v1/semantic-search`, `/v1/places...`,
   `/v1/cross-references/...`) for all Scripture, search, and geography. songbird never
   stores or ships its own copy of the Bible text — it comes from Concord at request time.

2. **Concord's location is configuration, never an assumption.** songbird reads a single
   `CONCORD_BASE_URL` and calls whatever is there. Concord may be on the **same host** or
   **any other machine on the LAN**, on any port — the location is pure config. A localhost
   default is fine (zero-config convenience), but **never hardcode "same server" / localhost
   as a requirement**. The requirement is that Concord is *reachable* at that URL.

3. **When Concord is unreachable, error — no fallback.** If a Concord call fails (server
   down, network gone, wrong URL), songbird surfaces a clear error. It does **not** attempt
   offline operation, a bundled copy of the text, or graceful degradation. Concord is a hard
   runtime HTTP dependency; its absence is an error state, not a mode to design around.

4. **The canonical-coordinate bridge.** Annotation anchors are **always** canonical — USFM
   book code + chapter + verse — **never** a translation-specific id. An annotation is pinned
   to an *address* (e.g. `JHN 3:16`), not to a verse in some translation's rendering. This is
   clean over HTTP because Concord's endpoints already return canonical coordinates: songbird
   reads a chapter from Concord, overlays its annotations by matching on those same
   coordinates, and a note shows correctly in every translation it's scoped to — pinned to
   the verse *address*, not the *text*. This is the invariant that keeps songbird from
   inheriting soap-journal's "a note made in NKJV won't match a BSB lookup" limitation. It is
   tested. Protect it like a load-bearing wall.

5. **songbird owns only its annotation data.** songbird's **own** SQLite database (under a
   configurable `DATA_DIR`) holds annotations, tags, and users — songbird's SQLAlchemy
   models, Alembic-migrated. No Bible text lives in it. (Caching Concord responses for
   performance is a possible later optimization, not a change to this ownership.)

6. **Notes are stored as Markdown** — durable, portable, editor-agnostic. Never store
   editor-native (TipTap/ProseMirror) JSON as the canonical form. If the editor is swapped,
   the notes must survive as readable text.

7. **Never break a shipped slice.** Each merged slice leaves `main` working and usable.
   Additive growth; no regressions.

## Git workflow

- **Branch per slice**, off `main`: `slice/N-short-name`.
- **Scoped conventional commits**, small and atomic: `feat(api)`, `feat(web)`,
  `feat(reader)`, `feat(annotations)`, `fix(...)`, `test(...)`, `docs(...)`, `chore(...)`.
- **PR per slice** via `gh`. The PR body states what landed, the open-question answers, and
  how it was verified.
- **Kris reviews and merges. Claude Code never self-merges. Never push to `main`. Never
  `--force`.**
- Plan Mode for every slice: produce a plan, Kris approves, then implement.

## Engineering principles

- **Tests are required**, and the canonical-coordinate bridge (invariant 4) gets explicit
  tests. Mark slow/integration tests (including any that need a live Concord) so the fast
  suite stays fast.
- **Type-checked and linted**: backend Pyright-strict-clean and Ruff-clean; frontend
  TypeScript-strict and lint-clean. Green before a PR.
- **Migrations**: schema changes go through Alembic. No ad-hoc drift.
- **Single deployable unit**: a multi-stage Dockerfile builds the Vite SPA, then one uvicorn
  process serves the static SPA + songbird's API.
- **Talking to Concord**: use one configured HTTP client against `CONCORD_BASE_URL`; handle
  failures explicitly (invariant 3); don't scatter base URLs or assume co-location.
- **Dependency discipline**: songbird is deliberately lean — new dependencies need a reason.
  Note the payoff of the HTTP model: the heavy ML (the embedding model + ONNX runtime) stays
  in **Concord**; songbird reaches semantic search with an HTTP call and stays light. No ML
  stack in songbird.
- **ADRs** in `docs/adr/` for genuinely new architectural decisions (not routine work).
- **Spec is canon — until reality corrects it.** If implementation reveals the spec is wrong
  (it happened repeatedly building Concord), fix the spec in the same PR with a `docs:`
  commit and note why. Reality wins; the spec gets updated, not worked around.

## Documentation
### The one rule everything serves

**Write for one real reader — and run every line past them.** Picture a specific person: curious,
non-technical, has never done this before, one frustration from closing the tab. Before anything
ships, hold each sentence and each step up to them and ask three things — *would they know what this
means? would they know how to do it? would they see why they're doing it?* Any "no" → cut it, explain
it, or move it. Every rule below is an instance of this one.

### The voice rules (each paired with the mistake it prevents — the mistake is what makes it stick)

- **Break the wall — a scannable page is itself reassurance.** Short paragraphs, frequent plain
  subheads, numbered steps for anything sequential, a code block for anything they'd type, one bold
  phrase per section. *Prevents:* a dense wall that signals "this is hard" before they've read a word.
- **No unexplained jargon — especially tooling.** Gloss and link every tool or term on first mention
  (the editor, the terminal, the package manager, the language). *Prevents:* the reader stranded on a
  word — and the subtler error of naming a scary unknown to "reassure" ("don't worry, no [X]"), which
  only teaches them [X] is something to fear.
- **Just-in-time, not just-in-case.** Explain a thing in the step that needs it, never earlier. Put
  the roadmap at the *end* as encouragement, not a syllabus at the front. *Prevents:* front-loaded
  caveats — and, worst, answering an unasked question, because a reassurance *plants* the fear it
  meant to soothe.
- **Motivation is timed, not cut.** The "you did it / this is real / you're becoming a builder" beats
  land hardest right after a win, at a section's close — never as opening preamble. *Prevents:*
  identity and proof beats falling flat because they arrived before the reader earned the feeling.
- **Show the win before the explanation.** Get the reader to a working, visible result as fast as
  possible, *then* explain how it works for the reader who's now curious. *Prevents:* the teach-then-do
  wall — making someone read a full explanation before anything happens.
- **Set up once; don't re-gate.** Establish setup a single time; later steps assume it's done and link
  back rather than re-explaining. Setup reappears only as symptom-tied troubleshooting. *Prevents:*
  re-charging a toll every section, which reads as friction and mild condescension.

### Two traps to name explicitly (we hit both, repeatedly)

- **Break-to-test.** Never ask the reader to do something whose only purpose is to exercise the work —
  break something, stop a service, force an error. That's the builder's job, already done for them.
  The reader only does what a real user would naturally do, and meets error states through reassurance
  ("if you ever see this, here's what it means"), never by being told to cause them. *(This one slipped
  past every specific rule above — it's the reason the root rule has to exist.)*
- **Completeness as a reflex.** "Everything true" is not "everything useful." If a sentence isn't
  helping the reader do the thing in front of them right now, it's costing them attention and
  confidence. Cut it.

### Before you call a page done

**Read it back as the reader, not the author.** Walk it top to bottom as that first-timer following it
literally — not as the writer confirming it works. Every noun explained or obvious; every step has a
how and a why; nothing asks them to break, inventory, or pre-learn. If you wouldn't follow it
comfortably with zero background, fix it before you ship.

## Out of scope (no build without an explicit scope decision)

- A native mobile app. (The web UI **is** kept responsive — phone/tablet layouts and mobile
  fixes are in scope; a packaged iOS/Android app is not.)
- Offline operation / Bible-text fallback when Concord is unreachable (invariant 3 — its
  absence is an error).
- Sub-verse / word-level highlighting (whole-verse is the deliberate v1 granularity).
- Cloud / multi-tenant hosting (self-hosted single-unit is the model).

## Don't

- Don't embed Concord or bundle Bible text (invariant 1) — consume the HTTP API.
- Don't hardcode localhost / same-server as a requirement (invariant 2) — it's config.
- Don't invent offline fallback when Concord is down (invariant 3) — error.
- Don't anchor annotations to anything translation-specific (invariant 4).
- Don't store Bible text in songbird's database (invariant 5).
- Don't store notes as editor-native JSON (invariant 6).
- Don't put an ML stack in songbird — that's Concord's job.
- Don't self-merge, push to `main`, or `--force`.
- Don't build a horizontal layer in isolation — slice vertically.
