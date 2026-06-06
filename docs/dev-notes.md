# songbird — dev notes

A running log of per-slice decisions, gotchas, and how each slice was verified. Newest first.

---

## Slice 1 — The core loop

- **Date:** 2026-06-05
- **PR:** [#3 — Slice 1: The core loop](https://github.com/kbennett2000/songbird/pull/3)
- **Branch:** `slice/1-core-loop`

### What it establishes
The core loop: read a chapter (from Concord, via songbird's backend) → click a verse number →
write a Markdown note in a side-panel TipTap editor → save to songbird's own DB → return and
see the highlight + note overlaid. This is the slice that makes invariant 4 real and tested.

### Open-question resolutions
1. **Overlay delivery = inline** in the read response — each verse carries its annotations; one
   round trip. `GET /api/v1/read/{translation}/{book}/{chapter}`.
2. **Verse ranges:** schema is range-ready (`start/end` chapter+verse); the **UI ships
   single-verse** (start == end) this slice.
3. **Editor ↔ Markdown:** `tiptap-markdown` (StarterKit + Link). Markdown out via
   `editor.storage.markdown.getMarkdown()`; `immediatelyRender:false` for React 18 strict mode.
4. **First-cut UX (taste, not final):** verse-number click → side-panel editor; annotated verses
   show a tint + a margin marker; explicit Save button. Reader is the front door (`/`); the
   Slice 0 status page moved to `/status`. Translation fixed to **KJV** (switching is Slice 2).

### The canonical-coordinate bridge (invariant 4) — how it's built and tested
- **Built:** the read endpoint fetches the chapter from Concord, then overlays annotations by
  matching on the **USFM code Concord returns** (`chapter.verses[0].book`), not the raw URL
  spelling — so `/read/KJV/john/3` and `/read/KJV/JHN/3` both overlay correctly. The coverage
  predicate in `api/read.py` is range-ready; single-verse reduces to an exact match.
- **Tested:** `tests/bridge_test.py` — create an annotation on `JHN 3:16`, fetch the overlay as
  KJV then WEB, assert the same annotation lands on v16 in both (and not v15/v17); the text
  differs, the anchor doesn't. A `concord`-marked live variant does this against real Concord.

### Concord 404 vs unreachable (refinement of Slice 0's client)
Slice 0's `ConcordClient` mapped *all* HTTP errors to "unreachable" (502). `get_chapter` now
splits them: a Concord **404** (bad book / no such chapter) → `ConcordNotFoundError` → songbird
**404 NOT_FOUND**; connection/5xx → `ConcordUnreachableError` → **502 CONCORD_UNREACHABLE** (no
fallback, invariant 3 intact).

### Gotchas
- **TipTap deps:** added `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`,
  `@tiptap/extension-link`, `tiptap-markdown`. No ML, no heavy stack — just the editor.
- **Markdown storage:** notes are stored as Markdown verbatim; `editor.storage.markdown` is
  read defensively (typed accessor) since the lib doesn't augment TipTap's `storage` types.
- **Bundle size:** the SPA is now ~766 KB (TipTap/ProseMirror). Advisory only; lazy-loading the
  editor is a reasonable later optimization (not done here — keep it simple).
- **TipTap mounts in happy-dom** for tests (the real NoteEditor test passes). The ReaderView
  flow test still stubs NoteEditor via `vi.mock` to keep the flow test independent of editor
  internals.
- **In-memory test DB:** `conftest.py` uses `sqlite+aiosqlite://` + `StaticPool` (one shared
  connection) so the arranging session and the route's session see the same DB; `get_db` is
  overridden alongside `get_concord_client`.
- **Shell gotcha (process cleanup):** `pkill -f "uvicorn songbird.main"` also matches the
  launching script's own command line and SIGTERMs the shell — kill by saved PID or
  `fuser -k 8077/tcp` instead.

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 18 passed (3 `concord` live deselected); live
  `pytest -m concord` passes against real Concord.
- Frontend: ESLint + `tsc` clean; Vitest 7 passed; `vite build` OK.
- Live API walkthrough (uvicorn + real Concord): list books → read John 3 KJV (no notes) → POST
  note on JHN 3:16 → KJV overlay shows it → **WEB overlay shows the same note** → v15/v17 clean
  → bad book/chapter 404 → lowercase `john` overlays.

---

## Slice 0 — Skeleton & boot

- **Date:** 2026-06-05
- **PR:** [#2 — Slice 0: Skeleton & boot](https://github.com/kbennett2000/songbird/pull/2)
- **Branch:** `slice/0-skeleton-boot`

### What it establishes
songbird as a running single deployable unit (FastAPI backend + React/Vite SPA from one
uvicorn process) that reaches Concord over HTTP and renders one real endpoint call. No
annotation features, no annotation DB tables — that's Slice 1.

### Open-question resolutions
1. **Frontend reads via songbird's backend proxy**, not directly from Concord. songbird owns
   one coherent API surface, and it's where annotation overlay attaches in Slice 1. The
   browser only ever talks to songbird; songbird talks to Concord.
2. **End-to-end proof endpoint = `GET /v1/translations`** (proxied as
   `GET /api/v1/translations`) — simplest, lowest-risk; proves the stack + client without
   reference parsing. Reading the text proper is Slice 1.
3. **Repo layout** = `backend/songbird/` + `frontend/` split; single multi-stage Dockerfile.
4. **`/healthz` shape** = `{status, version, concord:{base_url, reachable, status,
   translation_count, error}}`. Stays HTTP 200 even when Concord is down (songbird is alive;
   the dependency's status is reported in the body).

### Key decisions
- **Default port `8077`.** 8045 (soap-journal) and the 8051–8058 cluster are taken on this
  box, and 8000 is Concord; 8077 is clear. `CONCORD_BASE_URL` default `http://localhost:8000`
  — a default *value*, never a co-location assumption (invariant 2).
- **Empty Alembic baseline (`0001_baseline`).** Proves the migration pipeline runs on a fresh
  data dir without creating any feature tables.
- **One `ConcordClient` (httpx).** All Concord access routes through it; unreachable →
  `ConcordUnreachableError`. Data routes map that to **502 `CONCORD_UNREACHABLE`**; `/healthz`
  reports `reachable=false`. No fallback (invariant 3).

### Gotchas / things to know
- **httpx client lifecycle:** the `ConcordClient` is built in the FastAPI lifespan and stored
  on `app.state.concord`; `api/deps.get_concord_client` reads it. Tests **override that
  dependency** with a fake, so the fast suite needs no live Concord and doesn't run the
  lifespan.
- **Alembic needs the data dir to exist** before it opens the SQLite file. The app's lifespan
  mkdirs it, but `alembic upgrade head` runs standalone (in the entrypoint), so `alembic/env.py`
  also mkdirs `DATA_DIR`.
- **Container `localhost` ≠ host.** Inside the container, Concord on the host is **not** at
  `localhost`. docker-compose sets `extra_hosts: host.docker.internal:host-gateway` and
  defaults `CONCORD_BASE_URL=http://host.docker.internal:8000`; a LAN IP works too. This is
  invariant 2 in practice.
- **Python version:** dev/test ran on **Python 3.12** (system Python here is 3.14, which has
  no `pydantic-core` wheels yet and fails to build from source). The image is
  `python:3.12-slim`, matching. Use a 3.12 venv locally (`python3.12 -m venv .venv`).
- **`tsconfig.node.json`** must set `composite: true` and not `noEmit` (project-reference
  requirement), else `tsc` errors TS6306/TS6310.

### How it was verified
- Backend: `ruff check`, `ruff format --check`, `pyright` (strict, 0 errors), `pytest`
  (8 passed, 2 live deselected). Live `pytest -m concord` passes against real Concord.
- Frontend: `eslint`, `tsc --noEmit`, `vitest` (3 passed), `vite build` (hashed assets).
- Live (Concord up): `/healthz` → `reachable=true`, 13 translations; `/api/v1/translations`
  → 200 with all 13. Vite dev proxy forwards `/api` + `/healthz` to uvicorn.
- Live (Concord down): `/healthz` → 200 `reachable=false`; `/api/v1/translations` → 502
  `CONCORD_UNREACHABLE`.
- Docker: `docker build` + `docker run` (CONCORD_BASE_URL=host.docker.internal:8000) →
  entrypoint applies the Alembic baseline, `/healthz` reachable, translations served, SPA +
  hashed assets served.

### Local dev quickstart
```bash
# Concord (dependency) — from the concord repo
cd ../concord && docker compose up -d        # serves on :8000

# Backend
cd backend && python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn songbird.main:create_app --factory --port 8077

# Frontend (separate shell)
cd frontend && npm install && npm run dev     # proxies /api + /healthz to :8077
```
