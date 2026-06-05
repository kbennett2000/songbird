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

## Out of scope (no build without an explicit scope decision)

- A SOAP-format entry mode (soap-journal does that; songbird's model is annotation).
- Mobile.
- Offline operation / Bible-text fallback when Concord is unreachable (invariant 3 — its
  absence is an error).
- Sub-verse / word-level highlighting (whole-verse is the deliberate v1 granularity).
- Cloud / multi-tenant hosting (self-hosted single-unit is the model).
- Replacing soap-journal (a someday question; soap-journal stays as-is).

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
