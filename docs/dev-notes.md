# songbird — dev notes

A running log of per-slice decisions, gotchas, and how each slice was verified. Newest first.

---

## v1.1.0 — Map view documented + released

- **Date:** 2026-06-06
- **Branch:** `docs/v1.1-release`
- **PR:** _Docs & v1.1.0 release_

### What it establishes
songbird is now at **v1.1** — the offline **map view** is the v1.1 addition on top of the
feature-complete v1.0.0 core (still fully offline, still built on Concord). The map shipped (slices
S9/S10) and was live-verified, but the docs didn't show or mention it. This makes it **visible**: a
finished feature a stranger reading the README can't tell exists isn't really done.

### What changed (docs only — no feature/behavior/Concord change)
- **README "See it":** swapped the places-*list* screenshot for the **map** (`map-desktop.png`,
  reused from the live-visual-verify pass) — geography now leads with the map. Still three
  screenshots (reader, search, map).
- **README copy:** the intro line, the "Using songbird" tour (tap the globe → places on a map, when
  known), and the "How it works" link to **`docs/v1.1/MAP-SPEC.md`** + a light "added in v1.1" note.
  Honest framing kept throughout — located places pinned, unknown/off-map listed, never faked.

### Topology note
The map feature + screenshots lived on `slice/9-map-projection` (PRs #14/#15 merged there), not yet
on `main`. This PR was cut off `slice/9-map-projection`, so the single merge to `main` brought the
already-reviewed map feature (#14), the verification (#15), **and** these v1.1 docs together — then
`v1.1.0` was tagged on `main`.

---

## v1.1 Map View — live visual verification

- **Date:** 2026-06-06
- **Branch:** `docs/map-visual-verify`
- **Scope:** verification + screenshots only — **no feature code changed.** The only code touched
  is the screenshot tooling (`scripts/screenshots/capture.mjs`, new `captureMapDesktop` /
  `captureMapMobile`, gated behind `MAP_ONLY=1` for a map-only run).

### Why
The Map View (slices A+B) was component-tested and the projection accuracy test proves the
lat/lon→pixel math to ±2px, but the **rendered modal had never been looked at** — real pins on the
real parchment basemap, desktop and mobile. This is the human confirmation that "≈90% from the
left" *actually sits on Mesopotamia*, that confidence encoding reads at a glance, and that the
mobile modal is usable with touch.

### How
`docker compose up` (real Concord v1.0.0 + songbird at :8077), then drove the login-gated UI with
Playwright (system Chrome) against **Genesis 2** — a place-rich chapter (Euphrates, Tigris,
Assyria, Cush, Pishon, Gihon, Havilah located; **Eden** unknown). Two viewports: **desktop
1440×900** and **mobile 390×844** (touch, `.tap()` not hover). Screenshots in `docs/screenshots/`:
`map-desktop.png`, `map-desktop-card.png`, `map-mobile.png`, `map-mobile-card.png`,
`map-globe-disabled.png`.

### Result — all 7 points pass
1. **Pins land right** — Euphrates/Tigris/Assyria cluster in Mesopotamia (right side), Cush/Havilah
   toward the Nile/south; nothing in the Mediterranean.
2. **Basemap** — parchment/ink, legible, coastlines recognizable, no rendering garbage.
3. **Confidence reads** — solid (high) vs faded-hollow (med/low) clearly distinguishable; an
   *identified-but-medium* place (Pishon) renders **faded** — the chosen honest read, confirmed.
4. **Honesty line** — "Also mentioned, location unknown: **Eden**" listed, not plotted; no
   off-extent places this chapter.
5. **Tap → card → jump** — tapping a pin shows name/status/confidence + verse chips; clicking a
   verse navigates the reader and **closes the modal**.
6. **Mobile correct** — near-full-screen modal, map scales to fit (no horizontal scroll),
   finger-sized pins, **touch** selection (no hover), obvious ✕.
7. **Globe state** — enabled on GEN 2 (7 located); **disabled + "No mapped locations in this
   passage"** on place-free chapters (PSA 23, PRO 3, JHN 17 — 0 located).

### Gotchas / observations (none blocking)
- **Playwright `isMobile` framing artifact:** with `isMobile:true` + a fixed `deviceScaleFactor`,
  the page laid out at ~484 CSS px while the screenshot framed at the requested 390 → the shot
  looked falsely right-clipped. A DOM probe proved `scrollWidth === innerWidth` (no real overflow).
  Fix: capture mobile with `hasTouch:true` but **`isMobile` off** so layout width matches the shot.
  (No songbird change — purely a harness setting.)
- **Dense-cluster overlap:** the Mesopotamian rivers sit almost on top of each other; the
  deterministic offset separates them enough to read as distinct pins, but they overlap enough that
  one pin can intercept a click meant for its neighbour (the harness now selects the most-isolated
  pin). Acceptable graceful degradation for v1.1; tighter de-clustering is the deferred polish.

---

## v1.0.0 — Documentation & first public release (songbird is shipped)

- **Date:** 2026-06-06
- **PR:** _Docs & v1.0.0 release_
- **Branch:** `docs/readme-and-release`

### What it establishes
The first public release. songbird is feature-complete (S0–S8); this slice makes it something a
**stranger can run**: the beginner-first README + banner, the one-command `docker compose up`
(verified), three real seeded screenshots, the repo's public face, and the `v1.0.0` tag. No
feature/behavior change — docs + packaging + release only.

### The one-command setup — verified, no fix needed
The combined `docker-compose.yml` replaces the Slice-0 single-service compose: it **pulls**
`ghcr.io/kbennett2000/concord:v1.0.0` from GHCR and **builds songbird** from source on one private
network, wiring `CONCORD_BASE_URL=http://concord:8000`, with songbird gated on
`depends_on: condition: service_healthy`. Verified end to end from a clean state
(`docker compose down -v` → `up`):
- Concord image pulls; songbird builds (Vite SPA + uvicorn backend, multi-stage).
- Ordering fires: Concord → **healthy**, *then* songbird starts (entrypoint runs
  `alembic upgrade head`, seeds the unclaimed default user).
- `GET /healthz` → 200 `concord.reachable: true` (13 translations) — songbird reaches Concord over
  the compose network.
- Register the owner (id=1, admin) → authed `GET /api/v1/read/KJV/JHN/3` → 36 verses. The whole
  read path works through the auth gate + Concord. **The compose was correct as prepared.**

### Screenshots — real, seeded, login-gated (Playwright)
`scripts/screenshots/capture.mjs` (isolated, reproducible; `node_modules` gitignored) drives the
running stack at :8077 through the **real login-gated UI**, seeds two tasteful notes via
authenticated API calls (the browser's session cookie rides along), and captures three
viewport-framed (1440×900 @2×) shots at the README's exact paths:
- `reader.png` — John 3:16 highlighted, the note open in the drawer (TipTap-rendered, tagged).
- `search.png` — "anxiety" → ranked semantic Scripture results with scores.
- `places.png` — Genesis 2 places, the honesty model on display (Eden "Location unknown" beside
  identified rivers with confidence).

### Gotchas
- **Playwright ships no Chromium build for this distro (ubuntu 26.04).** Fixed by launching the
  system Google Chrome via `channel: "chrome"` (override with `PLAYWRIGHT_CHROME_CHANNEL`).
- **Viewport, not full-page.** Full-page shots of a 36-verse chapter were ~5000px tall and read
  badly in the README; viewport-framed shots are the clean hero look. The side panel is a fixed
  right drawer, so it stays visible regardless of scroll.
- **Prepared files arrived prefixed** (`songbird-README.md`, `songbird-docker-compose.yml`) and
  were moved onto `README.md` / `docker-compose.yml`, replacing the bootstrap stub + Slice-0 compose.

### How it was verified
- `docker compose pull concord` + `docker compose up` from clean → both healthy, songbird at
  :8077, `/healthz` reachable, register + authed John 3 read returns verses.
- Three screenshots captured against real Concord data, committed at the README paths; README
  renders banner + all three.
- No app code touched → backend/frontend gates untouched and green.

### songbird is shipped — S0–S8 complete.

---

## Slice 8 — Auth & multi-user (final slice)

- **Date:** 2026-06-06
- **PR:** _Slice 8: Auth & multi-user_
- **Branch:** `slice/8-auth`

### What it establishes
Real users + login, turning on the multi-user capability the schema has carried since S1
(`users` + `author_id` on every annotation). Argon2 cookie-session auth (mirroring
soap-journal's proven pattern), annotations scoped to their author, the whole app gated behind
login. **Auth is entirely songbird's domain — Concord stays read-only and user-unaware; the
`ConcordClient` is unchanged.** This completes S0–S8.

### The four open-question resolutions
1. **Default-user migration = claim-on-first-registration.** The seeded user (id=1) is left
   *unclaimed* (nullable `username`/`password_hash`); the **first registration claims it in
   place** (sets credentials + `is_admin=true`) rather than inserting a new row — so every
   pre-auth annotation (author_id=1) stays owned, never orphaned. Later signups insert new users.
2. **User creation = open registration.** First account claims the default + becomes admin;
   registration stays open (personal/small-group tool — an admin-gated toggle is deferred, noted).
3. **Sessions = soap-journal's exact cookie-session.** DB-backed `sessions` table (random
   `token_urlsafe(48)`, 30-day sliding TTL extended on resolve), httponly cookie
   `songbird_session` (`secure=False` for LAN HTTP, `samesite=lax`). **No signing secret** — the
   tokens are random DB rows, so logout truly revokes server-side.
4. **Gate the whole app.** Every data route requires a user (read, annotations, tags,
   translations, places, semantic-search); only `/healthz` + `/api/v1/auth/*` are open. Frontend:
   every route behind `RequireAuth` except `/login`.

### Author scoping
- `annotations`: `create` → `author_id=user.id`; `list` (browse/search) → `where(author_id ==
  user.id)`; `_get_or_404` also filters `author_id` so another user's note is a **404, not 403**
  (no existence leak) — get/patch/delete inherit it.
- `read.py`: the chapter overlay query gains `author_id == user.id` — a reader sees only their
  own notes overlaid.
- `tags`-list stays a global vocabulary for type-ahead (low-sensitivity; per-user tag visibility
  is a deferred nicety, noted).

### Gotchas
- **Gating breaks every existing test.** Router-level `dependencies=[Depends(get_current_user)]`
  401s all ~78 pre-auth tests. Fix: the shared **`client_for` fixture overrides
  `get_current_user`** to return the seeded user (id=1) — existing tests stay green and behave as
  before (their annotations are author 1, the overlay filters to author 1). A separate
  **`unauth_client`** (real `get_current_user`, persistent cookie jar) drives the actual auth /
  scoping / gating tests.
- **Nullable `username`/`password_hash`** is what makes the unclaimed-default claim work — NULL
  hash = claimable; `_unclaimed_default` finds it, `_any_claimed_user` decides first-vs-later.
- **No signing secret needed** — random DB tokens, unlike a signed-JWT scheme. One less config
  knob, and logout is a real DELETE.
- **passlib `crypt` DeprecationWarning** on 3.12 (and an argon2 `__version__` warning) are
  harmless — argon2id hashing/verification works; warnings only.
- **FastAPI caches the dependency**, so a router-level gate plus a route-level `user: User =
  Depends(get_current_user)` value-dep resolves once per request (no double DB hit).

### How it was verified
- Backend: Ruff + `ruff format --check` + Pyright-strict clean; `pytest` **92 passed** (3
  `concord` live deselected). New: `auth_test.py`, `scoping_test.py`, `gating_test.py`,
  `default_claim_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest **37 passed**; `vite build` ok. New: `useAuth.test.tsx`,
  `RequireAuth.test.tsx`, `LoginPage.test.tsx`.
- Live (Concord up, fresh DATA_DIR): unauth read / annotations → **401**; `/healthz` → 200;
  register → **claims default user id=1, is_admin=true**, cookie set; `me` → 200; authed read of
  John 3 (36 verses, from Concord) works; create note → 201, overlay shows it; logout → 204, then
  `me` → 401; second user (bob, id=2, not admin) sees **none** of kris's notes (browse `[]`,
  overlay empty, GET kris's note → 404).

---

## Slice 7 — Semantic search

- **Date:** 2026-06-06
- **PR:** [#9 — Slice 7: Semantic search](https://github.com/kbennett2000/songbird/pull/9)
- **Branch:** `slice/7-semantic-search`

### What it establishes
Search Scripture by meaning via Concord's `/v1/semantic-search` (ranked verses with scores,
each jumping to the verse), plus keyword search of the user's own notes. The architectural
payoff: the heaviest capability (313MB model + ONNX) is a one-line HTTP call — the model lives
in Concord, never in songbird.

### The Q1 decision (note search) + reasoning
Concord exposes **no embed-arbitrary-text endpoint** — its complete `/v1` surface is books,
chapters, cross-references, random, search, semantic-search, translations, verses. So songbird
**cannot** semantically embed note text without growing its own ML stack (which the invariant
forbids). Decision: **Scripture = semantic (Concord); notes = keyword** (case-insensitive
substring over `note_markdown`, via a new `q` param on the browse list). **Semantic note search
is deferred**, explicitly gated on a future Concord embed endpoint — documented and labeled in
the UI ("keyword"), never faked. (Option (b) impossible; (c) violates no-ML.)

### Other resolutions
2. **One combined `/search` view**, two clearly-labeled sections (Scripture *semantic* + notes
   *keyword*); "Search" link in the reader header.
3. **Params:** `translation` for display (KJV first cut), `limit=20`, no `min_score`; empty query
   short-circuits to `[]` (Concord 422s on empty `q`).
4. **Result → reader:** reuse the `/?book=&chapter=&verse=` search-param jump (S3/S4).

### Gotchas
- **422 on empty/invalid query** — the client maps **400/404/422 → ConcordNotFoundError**; the
  endpoint also guards empty `q` → `[]` (no call), so the common case never hits Concord.
- **Scores are honest signal** — surfaced like cross-ref votes / geography status; results stay in
  Concord's rank order.
- **No ML entered songbird** — `requirements.txt` unchanged; the slice is a schema + a `try/except`.

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 67 passed (3 `concord` live deselected). New:
  `semantic_search_test.py`, `annotation_search_test.py` + extended `concord_client_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest 28 passed. New: `SearchView.test.tsx`.
- Live (semantic-capable Concord): "anxiety" → Proverbs 12:25 (0.895) etc. with scores; empty q
  → `[]` (no call); unknown translation → 404; note keyword search finds the matching note.

---

## Slice 6 — Geography

- **Date:** 2026-06-05
- **PR:** [#8 — Slice 6: Geography](https://github.com/kbennett2000/songbird/pull/8)
- **Branch:** `slice/6-geography`

### What it establishes
The places named in a passage, surfaced on demand with Concord's honesty model carried through:
identified places show coordinates; unknown/symbolic show as honestly unlocated (no fabricated
pin); disputed shown contested. Click a place → its verses → jump. Same thin shape as cross-refs.

### Open-question resolutions
1. **List-first, NO map.** A tile map would need an outbound third-party tile call (against
   songbird's offline-except-Concord posture) or a heavy bundled-tile stack. So this ships the
   honest list (status + coordinates); a map is a clean follow-up only if tiles can be sourced
   without an outbound call.
2. **Surface = side panel, on-demand** — the panel now triple-multiplexes note-editor ↔
   cross-refs ↔ geography.
3. **Per chapter** — `/v1/verses/{book chapter}/places`.
4. **Unknown-place visual:** name + status badge (identified=green, disputed=amber,
   unknown/symbolic/multiple=gray) + confidence, and either `lat, lon` (disputed adds
   "contested") or a muted *"Location unknown"* — never a fabricated coordinate.

### Gotchas / decisions
- **Honesty nulls carried through verbatim** — `latitude`/`longitude`/`confidence` stay null for
  unknown/symbolic; backend + frontend assert this (not defaulted to 0/""). The crux of the slice.
- **Place id is a string** (`a15257a`), used directly in the `/places/{id}/verses` path.
- **Endpoint refs need a NAME, not USFM, for `/v1/verses/{ref}/places`** — see below; songbird
  builds `"{book_usfm} {chapter}"`, which is what Concord's resolver expects (USFM book codes
  work via the alias resolver, same as elsewhere).
- The side panel now renders one of three modes; `navigate()` + each open-helper close the others.

### Live verification (done — 2026-06-06, against a rebuilt geo-capable Concord)
The slice originally shipped mocked-only because the running Concord image predated the
`/v1/places*` routes (every places route returned FastAPI's bare `{"detail":"Not Found"}`, not
Concord's `{"error":{…}}` envelope). A rebuilt geo-capable Concord (`place_count: 1340`;
`openapi.json` lists the place paths; bad place id → `{"error":{"code":"unknown_place",…}}`)
let it be walked end-to-end through songbird's proxy. Results — **the honesty model passes
through verbatim**:
- **GEN 2** → 8 places: **Eden** `status=unknown`, `latitude/longitude/confidence` all **null**
  (renders "Location unknown" — no fabricated pin), alongside **identified** places with real
  coords (Euphrates 31.0043, 47.442, confidence high; Tigris; Assyria; Cush; Gihon; Havilah;
  Pishon). So both the unknown and the located cases are proven, in one chapter.
- **GEN 4** → the **land of Nod**: `status=unknown`, null coords. Honestly unlocated.
- **Place → verses** (Euphrates) → 44 canonical verses (GEN 2:14 first) — the jump source works.
- **Errors:** unknown book (`XXX`) → **404 NOT_FOUND**; **Concord down → 502**. Note: an
  *out-of-range chapter* (e.g. GEN 999) returns **200 with an empty list** — songbird faithfully
  mirrors Concord, whose places endpoint treats a valid book + no places as empty, not 404 (the
  404 case is an *unknown book*, not an out-of-range chapter).

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 68 passed (3 `concord` live deselected). New:
  `geography_test.py` (honesty fields carried through; empty/404/502; place-verses) + extended
  `concord_client_test.py` (null coords preserved on parse).
- Frontend: ESLint + `tsc` clean; Vitest 27 passed — places render with status, an unknown place
  shows *"Location unknown"*, an identified place shows coords, and jump-to-place-verse navigates.
- Live: walked end-to-end against the rebuilt geo-capable Concord (results above).

---

## Slice 5 — Cross-references

- **Date:** 2026-06-05
- **PR:** [#7 — Slice 5: Cross-references](https://github.com/kbennett2000/songbird/pull/7)
- **Branch:** `slice/5-cross-references`

### What it establishes
Cross-references (Concord's TSK data) surfaced on demand in the reader, with click-to-jump. A
thin Concord-call slice — the inverse of S4: cross-refs are Scripture-domain, so Concord owns
them and songbird stores none.

### Open-question resolutions
1. **Surface = on-demand, side panel** — a subtle per-verse affordance (hover-revealed, so the
   reading column stays clean) opens the panel, which now multiplexes note-editor vs cross-refs.
2. **Fetch = lazily per verse** (Concord's endpoint is per-verse).
3. **Snippet = included** — `include_text=true` returns the target snippets in the *same* call.
4. **Votes = surfaced** (Concord orders by votes desc; shown subtly).

### Gotchas / decisions
- **`include_text=true` gives free snippets** — the target verse text comes back in the one
  cross-references call (no N+1); pass the reader's current `translation`.
- **400 AND 404 → one songbird 404** — same as `resolve` (S3). Concord returns 400 for an
  unparseable ref and 404 for unknown/out-of-range; both are "bad reference." Only connection/5xx
  → 502. A valid verse with no cross-refs is `200 []`.
- **Jump skips `resolve`** — cross-ref targets are already canonical USFM coords, so the click
  calls `navigate(book, chapter, verse_start)` directly (no re-parse). This is *why* the slice is
  thin: the foundation hands back coordinates the reader already speaks.
- **The side panel now multiplexes** — `editing` (note editor) XOR `xref` (cross-references);
  opening one closes the other, and `navigate()` closes both.
- **Concord's `from` key** is a Python keyword — not modelled (Pydantic ignores it); songbird
  only needs `to` + `votes` + `text`.

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 57 passed (3 `concord` live deselected). New:
  `cross_references_test.py` + extended `concord_client_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest 26 passed.
- Live: `JHN/3/16` → 20 refs votes-desc (Romans 5:8 @968) with snippets + ranges; bad verse →
  404; Concord-down → 502 (clean single-server check).

---

## Slice 4 — Tags + browse

- **Date:** 2026-06-05
- **PR:** [#6 — Slice 4: Tags + browse](https://github.com/kbennett2000/songbird/pull/6)
- **Branch:** `slice/4-tags-browse`

### What it establishes
Free-form tags on annotations + a browse view to find notes by tag. The first slice whose core
makes **no Concord call** — tags are an annotation concern, so they live entirely in songbird.

### Open-question resolutions
1. **Browse list = reference + note preview + tags, no per-item Concord call.** The backend
   browse path is Concord-free (returns the canonical anchor + note + tags). The frontend
   prettifies "JHN 3:16" → "John 3:16" via the **books list it already fetches once** (shared,
   not per-item; falls back to USFM).
2. **Multi-tag filter = AND** (narrowing). `match=any` exists in the API for later.
3. **Tag input = chips + type-ahead** (autocomplete from existing tags, add on Enter/comma,
   create-on-the-fly, remove via ×).
4. **Browse = `/browse`** route + a "Browse notes" header link; jump-to-verse via
   `?book=&chapter=&verse=` search params that `ReaderView` seeds its initial state from.

### Gotchas / decisions
- **The tag/browse core is Concord-free, and it's tested.** `concord_free_test.py` injects a
  fake `ConcordClient` that raises on any call; browse, tags-list, and creating an `all`-scope
  tagged note all still succeed → no Concord call possible. (Create only touches Concord for
  *scope* validation, and `all`-scope skips even that.) Verified live too: with Concord down,
  tags/browse/create-all-scope return 200/201 while read + current-scope-create return 502.
- **Tag normalization:** names are trimmed + lowercased + de-duplicated on the way in; unique by
  name; tags are **reused** across annotations (get-or-create), so `GET /api/v1/tags` has one row
  per distinct tag.
- **`AnnotationOut.tags` validator:** a `@field_validator("tags", mode="before")` maps ORM `Tag`
  objects → names (so `model_validate(annotation)` works), and passes plain strings through (so
  `ReadAnnotation(**dump)` round-trips). Same eager pattern as `translations` (selectin +
  `expire_on_commit=False`).
- **Browse ordering** is `(book_usfm, start_chapter, start_verse, id)` — deterministic and
  Concord-free, but *alphabetical by USFM*, not canonical book order (canonical sort would need
  Concord's `canonical_order`; a later nicety).
- **Router in tests:** `ReaderView` now uses `useSearchParams`/`Link`, so its Vitest renders are
  wrapped in `MemoryRouter`; the jump-to-verse test asserts navigation via a probe route.
- **Pyright:** association `Table` columns need an explicit type (`Column("…", Integer,
  ForeignKey(...))`) or strict mode flags `Column[Unknown]`.

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 49 passed (3 `concord` live deselected). New:
  `tags_crud_test.py`, `browse_test.py`, `concord_free_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest 25 passed. New: `TagInput.test.tsx`, `BrowseView.test.tsx`.
- Live: tag normalize/dedupe, sorted tags-list, browse AND-filter → [16], and the Concord-down
  proof above.

---

## Slice 3 — Navigation

- **Date:** 2026-06-05
- **PR:** [#5 — Slice 3: Navigation](https://github.com/kbennett2000/songbird/pull/5)
- **Branch:** `slice/3-navigation`

### What it establishes
Jump-to-reference bar, book/chapter picker, and next/previous chapter across book boundaries.
A thin slice: **Concord parses references and owns the canon; songbird wires the UI.** Overlay +
translation switching keep working through navigation.

### Open-question resolutions
1. **Dedicated resolve endpoint** `GET /api/v1/resolve?ref=` proxying Concord's `/v1/verses/{ref}`.
2. **Verse in a reference** → load the chapter + scroll-to/soft-highlight that verse (single-verse
   refs only; ranges just load the chapter).
3. **Boundary data** = `/v1/books` `chapter_count` + `canonical_order` (already proxied from S1);
   next/prev computed client-side in `lib/navigation.ts`.
4. **Picker** = book + chapter dropdowns (book change resets to chapter 1), joined by the jump bar
   + next/prev buttons.

### Gotchas / decisions
- **Concord returns BOTH 400 and 404 for a bad reference**, and both mean "couldn't find it":
  `400 unparseable_reference` (garbage, or a book with no chapter like "Romans") and
  `404 unknown_book / no_verses_found` ("Hesitations 3", "John 999"). `resolve_reference` maps
  **both → `ConcordNotFoundError` → songbird 404**; only connection/5xx → 502. This widens Slice
  1's `get_chapter` (which special-cased 404 only) — don't assume parse failures are 404.
- **Verse heuristic:** Concord's resolver returns the whole chapter for a chapter ref ("John 3" →
  36 verses) and exactly one verse for a verse ref ("Gen 1:1" → 1). So `verse = verses[0].verse
  if len(verses)==1 else None`. (No single-verse chapters exist in the canon, so this is safe.)
- **No canon in songbird:** next/prev derive entirely from `/v1/books` (`chapter_count` +
  `canonical_order`, GEN=1 … REV=66); `lib/navigation.ts` returns `null` at the ends (caller
  disables the button). Pure + unit-tested.
- **Reference encoding:** the raw string is `encodeURIComponent`-d on the way to songbird and
  `urllib.parse.quote`-d on the way to Concord — "1 Cor 13" (space + number) resolves fine.
- **scrollIntoView guard:** the highlight effect checks `typeof el.scrollIntoView === "function"`
  (happy-dom doesn't implement it) so the Vitest suite stays green.

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 39 passed (3 `concord` live deselected). New:
  `resolve_test.py` + extended `concord_client_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest 19 passed (incl. `navigation.test.ts` boundary/clamp).
- Live (real Concord): resolve "John 3"/"Gen 1:1"/"1 Cor 13" correct; "asdf"/"Romans"/"John 999"/
  "Hesitations 3" all → songbird 404 (none leak as 502).

---

## Slice 2 — Translation switching + scope

- **Date:** 2026-06-05
- **PR:** [#4 — Slice 2: Translation switching + scope](https://github.com/kbennett2000/songbird/pull/4)
- **Branch:** `slice/2-translation-scope`

### What it establishes
Translation switching in the reader + the three-tier scope (all / current / subset). Switching
KJV → WEB re-fetches the chapter from Concord and re-overlays annotations on the right verses —
the canonical-coordinate bridge (invariant 4) as a visible feature.

### Open-question resolutions
1. **`current` resolves at creation** to a concrete single-member subset (one row in
   `annotation_translations`), so the stored intent is explicit and decision-B's label has a
   real value.
2. **Out-of-scope visual = option 3** (per Kris): a **gray hollow `○` marker only — no tint, no
   inline label** in the reading column; the `written for {codes}` label shows in the
   **side-panel header** when opened. In-scope keeps amber tint + filled `●`. Rationale: don't
   hide it, but don't clutter the page you're reading.
3. **Selector:** header, **in-memory** (resets to KJV on reload); persistence deferred.
4. **Subset picker:** "choose translations…" disclosure with a checklist of Concord's codes.

### Scope modeling
- `annotation_translations` (`annotation_id` FK cascade, `translation_code`, unique pair) holds
  codes for `current`/`subset`; empty for `all`. `Annotation.translations` is a
  `lazy="selectin"` relationship; `Annotation.scope_translations` is a convenience property.
- **In-scope rule** (computed server-side in the read overlay): `all` → always; else the read
  translation ∈ codes (case-insensitive). Emitted per annotation as `in_scope` on
  `ReadAnnotation`.
- **Decision B is data-level:** out-of-scope annotations are returned with `in_scope:false`,
  never dropped — the frontend marks them.

### Gotchas / decisions
- **Scope validation needs Concord.** Create/update validate codes against
  `concord.list_translations()`; unknown → 422 `INVALID_TRANSLATION`, malformed → 422
  `INVALID_SCOPE`, Concord unreachable → 502. `all`-scope skips the Concord call entirely
  (no codes to validate), so plain notes still work without a round trip.
- **`expire_on_commit=False`** (both the app and the test sessionmaker) lets create/update set
  `annotation.translations` in-memory and return `AnnotationOut.model_validate(annotation)`
  right after commit without a lazy re-load (which would need a greenlet in async).
- **`_get_or_404` uses `select()`, not `db.get()`**, so the selectin-loaded `translations` are
  populated for the response.
- **Codes are normalized to upper-case** and de-duplicated on the way in (Concord ids are
  upper-case, e.g. `KJV`, `WEB`).

### How it was verified
- Backend: Ruff + Pyright-strict clean; `pytest` 30 passed (3 `concord` live deselected; live
  pass). New: `scope_crud_test.py`, `scope_overlay_test.py`, extended `bridge_test.py`.
- Frontend: ESLint + `tsc` clean; Vitest 9 passed; `vite build` OK.
- Live (uvicorn + real Concord): `current`→KJV note shows `in_scope:true` in KJV and
  `in_scope:false` (written for KJV) in WEB; `all` in-scope everywhere; `subset {KJV,WEB}`
  in-scope KJV/WEB, out ASV; invalid code → 422; bad chapter → 404.

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
