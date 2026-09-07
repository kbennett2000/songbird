# songbird — dev notes

A running log of per-slice decisions, gotchas, and how each slice was verified. Newest first.

---

## Incident — the deployment overrode Concord's address

- **Date:** 2026-09-07
- **Branch:** `fix/concord-base-url-config`

### The symptom

The translation dropdown on the LAN server listed 15 translations. It had listed 19. ESV, NET,
NKJV and NLT were gone. Every sign pointed at data loss — Concord's databases are baked into its
image with no volume, and the concord container had been recreated that afternoon. That reading
was wrong, and it is worth writing down *because* it was so plausible: a recreated container plus
missing data is a compelling story, and it sent the first ten minutes of diagnosis down the wrong
path, toward a volume that should not exist and was not the problem.

Nothing had been deleted. `docker ps -a` showed **two** Concords running side by side:

| Container | Image | Created |
|---|---|---|
| `concord-api-1` | `concord:latest` | 2026-08-28 — the operator's own build, all 19 translations, healthy |
| `songbird-concord-1` | `ghcr.io/kbennett2000/concord:v1.2.0` | that afternoon — stock, public-domain only |

songbird was reading the second one. The first had never been touched.

### Root cause

Slice 0's compose file got this right:

```yaml
CONCORD_BASE_URL: "${CONCORD_BASE_URL:-http://host.docker.internal:8000}"
```

Commit `f04debe` ("combined one-command docker compose") replaced it with:

```yaml
CONCORD_BASE_URL: "http://concord:8000"
```

The `${…}` indirection was deleted, so `CONCORD_BASE_URL` in `.env` stopped doing anything —
compose wrote the bundled engine's address into songbird's environment on every boot. The same
commit made that bundled engine unconditional. Together they mean the deployment silently
overrode invariant 2: the setting stayed correct in `config.py` and was simply handed the wrong
value.

The published GHCR image cannot hold the missing translations either. Concord gitignores
`data/private/`, because ESV/NET/NKJV/NLT are non-distributable — so the public build bakes the
committed public-domain corpus and nothing else, by design. Pointing at it was never going to
work, whatever the pin said.

The defect has been in the compose file since `f04debe` on **2026-06-06** — three months. Exactly
when this LAN server started reading the bundled engine isn't recoverable from the repo: the pin
bump (`02cf9ce`) landed on 2026-06-08, but the host applied it whenever it was next brought up,
and container creation timestamps only show the most recent recreate. What is certain is that any
`docker compose up` from `f04debe` onward pointed songbird at an engine that could not serve the
licensed translations, whatever `.env` said.

### Why it hid for so long

songbird already reported everything needed to spot it. `/healthz` returned `base_url` and
`translation_count`; `StatusView` rendered both. But `/status` had **no link in `TopNav`** and
was still captioned "Slice 0 — skeleton & boot". The page that would have said *"Concord at
http://concord:8000 — 15 translations"* existed, worked, and was unreachable from the UI.

The lesson isn't "add more diagnostics." It's that **a diagnostic nobody can navigate to is not
a diagnostic.** The signal was built in slice 0 and never wired to a reader.

### What landed

- **`docker-compose.yml`** — `${CONCORD_BASE_URL:-http://concord:8000}` restores the
  indirection; the `concord` service moves behind `profiles: ["bundled-concord"]` so it does not
  start unless asked for; `depends_on` gains `required: false` so songbird still boots when it
  isn't running. An operator-supplied address wins *and* suppresses the bundled engine.
- **`/healthz` reports `translation_ids`** — the corpus, not just its size. Reachability is
  decided by `/healthz` alone; the listing is a second, softer call, so a listing failure after a
  healthy probe leaves the ids unknown rather than declaring Concord down.
- **Boot logs the corpus** — `Concord corpus: 19 translations (AKJV, ASV, …)`, best-effort,
  mirroring the session sweep. Invariant 3 still holds: unreachable Concord raises for the
  requests that need it, but boot doesn't die on it.
- **Status is in the nav** — in the utility cluster with the theme toggle, not the content row,
  which already wraps on a phone at eight links. The page leads with address + corpus together.
- **`config_test.py`** — pins that the address comes from the environment, is taken verbatim for
  any host, and outranks a checked-out `.env`. The invariant now has a test, not just a prose
  guarantee in CLAUDE.md.

### Gotchas

- **`depends_on` + `profiles` need `required: false`.** Without it, compose refuses to start a
  service that depends on one no active profile enables. Needs Compose ≥ 2.20 (verified on
  v5.3.1); worth checking on an older deployment host.
- **`docker compose config` is the cheap proof.** `config --services` listing only `songbird`
  is the whole assertion that the default path no longer starts an engine of its own.
- **Compose reads `.env` regardless of the shell.** `env -u CONCORD_BASE_URL` does not test the
  fallback — the repo's own `.env` still wins. Use `--env-file /dev/null` for that.
- **The Makefile gate lints `songbird/` only**, not `tests/`, so `ruff check .` surfaces
  pre-existing findings in test files that CI never sees. Match the gate, don't widen it
  mid-fix.

### How it was verified

- Backend: `ruff check songbird`, `ruff format --check songbird`, `pyright` (strict, 0 errors),
  `pytest` — 483 passed.
- Frontend: `eslint`, `tsc --noEmit`, `vitest` — 291 passed across 39 files, `vite build` clean.
- Compose, all four paths: `.env` value honoured; shell value honoured; no `.env` + profile →
  falls back to `http://concord:8000` and starts both; no `.env`, no profile → `songbird` alone.

---

## Sermon sources slice 4b — place (the scan's second half)

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-4b-place`

### Why

4a taught songbird to fetch: it pages a church's catalogue, applies §6's filters, and leaves every
survivor at `pending`, doing nothing. 4b reads them. For each pending row it finds the strings in the
video's own text that are *shaped* like a reference, asks Concord what they mean, and creates
ordinary sermon notes when a rule hits. When none hits, the row becomes `needs_passage` with its
resolved references saved as suggestions, and slice 5 turns those into one-tap buttons.

This is the riskiest logic in the feature, and the risk is asymmetric: **a sermon pinned to the wrong
passage is worse than one left for a tap.** Every choice leans that way — the rules are ordered and
stop at the first hit, Concord is the only judge of what a string means, a channel's template verse
is excluded before anything is resolved, and anything short of a stated passage goes to review.

### What landed

- **`sermon_notes.source_video_id`** (migration `0013`) — the link from a note back to the row that
  made it, and the explicit null-out in the delete route.
- **`songbird/sermons/references.py`** — the pure candidate finder. No I/O, no opinions about book
  names, one exception for dates (below).
- **`songbird/sermons/anchor.py`** — `_resolve_anchor` and `_resolve_book_order_index` moved out of
  the API router so a scan-created note is built by the same code as a hand-made one, with the book
  map fetched once per run instead of once per note. **`songbird/sermons/dates.py`** — §7's date
  rule, which §11's re-date action now shares rather than duplicates.
- **`songbird/sermons/passages.py`** — the three rule texts and the boilerplate tally, both pure.
- **`songbird/sermons/place.py`** — the I/O edge: boilerplate over the whole ledger in chunks, the
  already-noted re-check, the rules per video, and one commit per video.
- **The ledger row now says why**: `placed_by` in the reader's words, the passages it noted, and
  read-only suggestion chips for rows waiting on a passage.

### Gotchas

- **SQLite cannot add a foreign key to an existing table.** `op.add_column` with an inline
  `sa.ForeignKey` emits a separate `ADD CONSTRAINT` that fails *after* the column has landed — a
  half-applied migration. `batch_alter_table` rebuilds the table instead, and refuses here because
  reflection finds an **unnamed** FK on `sermon_notes` (0006's link to `users`). So the migration
  adds a plain column and the model alone carries the FK; the two were diffed column-for-column and
  index-for-index to prove that is the only difference. It costs nothing, because SQLite does not
  enforce foreign keys anyway — which is why the delete route nulls the link by hand.
- **`resolve_tags` adds `Tag` rows without flushing.** Calling it once per note in one uncommitted
  session creates duplicate rows for the same new name and fails the unique constraint at flush.
  A source's tags are resolved **once** per evaluation and the objects reused.
- **`pkill -f <pattern>` matches its own shell** and killed the session — third time this has cost
  something, so: find the listener instead, `ss -lptnH "sport = :8099" | grep -oP 'pid=\K[0-9]+'`.
- **Mutation testing found five tautologies** the first time and three more after the date fix.
  One was `assert {n.source_video_id for n in notes} == {notes[0].source_video_id}`, which passes
  happily when every value is `None`. Another: a "nothing pending" early return that was pinned only
  on Concord calls, which the boilerplate pass never makes — it needed a query counter.

### How it was verified

`make check` 474 passed, Ruff and Pyright-strict clean; `make check-frontend` 288 passed, ESLint,
tsc and build clean. 10/10 mutants killed on the date guard, on top of 30/30 on the rest.
`alembic upgrade head → downgrade -1 → upgrade head` on a scratch database.

**Live acceptance** ran against the four real channels with a real key and a dockerised Concord:
2,671 videos, 1,082 notes, 114 quota units, about 25 seconds. Every logged URL read `key=REDACTED`
and no key-shaped string appears anywhere in the logs. The per-source table is in §12 of the spec.
Deleting a source removed its 371 ledger rows, left every note intact with `source_video_id` null,
and left zero dangling links.

**The by-eye audit tripped its gate, and that is the most useful thing in this entry.** Ten placed
notes per source, sampled with a fixed seed and the list written down *before* any was opened,
checked against their YouTube pages. Majestic View had two wrong anchors in its ten — the agreed
trip-wire was more than one in any single source — so the slice stopped and reported rather than
tuning anything.

The cause: Majestic View titles every service by date, and **`Mar.` is an abbreviation Concord
accepts for Mark.** `Livestream Sunday Worship Service - Mar. 15 2026 …` became a note on Mark 15.
Five notes in 1,087 were wrong that way (0.46%), all one source, all rule 2. Three of the five were
the *only* note on their video — those were not merely mis-anchored, they were confidently placed
when they should have gone to review. `Mar. 22` and `Mar. 29` escaped only because Mark has 16
chapters. Rule 3, audited separately because it is the loosest, made 22 placements corpus-wide with
zero wrong anchors.

The fix went into the finder, not the rules: a bare month with no verse part, or followed by a
four-digit year, is not offered. Before re-running, the old finder and the new one were diffed over
every stored title and description of the other three sources — 4,600 fields of real published text.
42 differed, all of them a month candidate; all 36 distinct dropped strings were then asked of live
Concord and **every one was a 404**, so those sources could not have changed. Celebration was
re-scanned anyway and reproduced its numbers exactly.

Majestic View re-ran end to end and hit every predicted number: 13 placed (down from 16), 351 needs
a passage (up from 348), 15 notes (down from 20), **zero anchored to Mark**. The three sole-note
videos went to review, one of them now suggesting the passage its description actually names.

**All 13 placed rows were then audited — the whole population, not a sample of ten.** One wrong
anchor: `MVC - Talking About Respect with Pastor John 06-25-2020` → **John 6-25**, sixteen chapters,
because `06-25-2020` is a numeric date sitting behind a pastor's name that is also a book. One wrong
note in 1,082 corpus-wide; the gate needs more than one in a source's ten, so it did not trip, and
the finding is recorded in §13 rather than fixed on my own judgement.

**Browser pass** (Playwright, live Concord, both themes, 1440px and 390px): the ledger's placed rows
with the rule and their passages, `needs_passage` rows with suggestion chips, the widest cases from
Celebration (three chips, three notes on one row), Browse, and the reader on Acts 1 — a chapter a
scan-created note spans whole, so **every verse in it carries a marker**. Looked at and judged
acceptable: it is the honest state of the data and identical to what a hand-made chapter note does,
but it is noisier than a chapter with three marked verses, and if it ever becomes a problem the fix
belongs to the reader, not to the scan. Contrast measured, not eyeballed: every text layer this
slice adds is 4.83:1 in light and 5.78:1 in dark, the suggestion chips 9.37:1 and 8.33:1.

Test data deleted afterwards, both containers removed.

---

## Sermon sources slice 4a — fetch (the scan's first half)

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-4a-fetch`

### Why

Slice 3 taught songbird where sermons come from. Nothing read those catalogues yet.

Spec §15's "slice 4 — the scan" is two jobs wearing one name: fetch every video and decide whether
it is a candidate, and read the passage out of its text and create the note. They fail for different
reasons (YouTube vs Concord), need different fixtures, and together make a diff nobody can review.
So it split, and the seam is a new ledger status, **`pending`**: 4a writes it, 4b consumes it. That
makes a scan resumable — fetching depends only on YouTube, evaluation only on Concord, and either
can fail without losing the other's work.

The second decision was **where a scan runs**. A full catalogue scan of a real church is 17-19
Google calls; that cannot sit inside a POST. So "Check now" — and adding a source — only write
`check_requested_at` down and answer 202, and one background task processes whatever is due. Slice
6's timer then needs no scan logic of its own: it sets the same column and this runner does the rest.

### What landed

- **`sermon_source_videos`** (migration `0012`) — spec §4's ledger, shipped whole including the
  columns 4b fills. Plus `check_requested_at` and `scan_complete` on `sermon_sources`.
- **`list_playlist_page`** on the YouTube client, and **`Video.is_livestream`**.
- **`songbird/sermons/scan.py`** — the §6 filters as pure functions, and the runner as the I/O edge.
- **`/check`, `/{id}/check`, `/videos`**, per-source counts, and `scan_running` on `/status`.
- **The Sources page**: Check all now, per-source Check now, a polling "checking…" indicator, the
  counts, last-checked and its failure reason, and a read-only ledger view in its own component
  (slice 5 attaches place/dismiss/restore to a row there).
- **WAL and a busy timeout on the engine**, because this slice gives songbird its first writer
  outside a request. Note for backups: WAL keeps `songbird.db-wal` and `-shm` beside the database,
  so a backup has to copy the directory rather than the one file.

### Gotchas

- **SQLite does not enforce foreign keys.** The pragma defaults to off and songbird never sets it,
  so `ondelete="CASCADE"` on the ledger is decorative — deleting a source would have orphaned every
  row. Slice 3's tag cascade works only because SQLAlchemy manages `secondary` join rows itself; a
  plain child table gets nothing. The DELETE route clears the ledger explicitly, and a test holds it.
- **The incremental stop rule needed a second column.** "Stop at the first page where everything is
  known" assumes every page above the stop is complete. A scan that committed page one and then
  failed on page two would leave page one entirely known — so every later check would stop there and
  the rest of the catalogue would be permanently unreachable, with no error anywhere. Hence
  `scan_complete`, written false as part of the first batch's commit (which also covers a kill -9).
  Deliberately **not** derived from `last_check_status`: that is a sentence shown to a person, and a
  copy edit must not change how a scan pages.
- **`Video` could not answer the question filter 3 asks.** §6 excludes a livestream by testing
  whether `liveStreamingDetails` is *present*; the model kept only `actualStartTime`. A completed
  stream with no start time would have slipped past a source with livestreams switched off.
- **SQLite returns naive datetimes** from `DateTime(timezone=True)`. Every comparison the runner
  makes happens in SQL for that reason; a test of mine compared an aware value to a stored one and
  failed exactly as production would have.
- **The `ASYNC` ruleset earns its keep.** Ruff rejected a `timeout` parameter on an async `aclose`;
  the shutdown budget is uvicorn's, not a caller's, so it became a constant.
- **Committing before mutating is not optional.** Twice in this slice a `git checkout --` after a
  mutation test threw away the real fix along with the mutation, because the source was not yet
  committed. It is the same lesson slice 2 recorded, and it cost time again.

### What the live calls showed

Two real churches, full back-catalogue scans, on the real key.

| | videos | pending | skipped | quota units | wall clock |
|---|---|---|---|---|---|
| MajesticViewChurchLive | 371 | 364 | 7 | 17 | ~1 s |
| Celebration Church | 445 | 325 | 120 | 19 | ~5 s |

- **The uploads playlist DOES include completed livestreams.** This was the question the slice was
  told to stop on if the answer was no: 199 of the first 200 Majestic View rows are `is_live` true
  and are its Sunday services. No `search.list`, no undocumented `UULV` trick, no design decision to
  escalate.
- **A finished stream reads `liveBroadcastContent: "none"` with a real duration** — 86 to 110 minutes
  for those services — so §6's first filter does not touch them.
- **Quota matches spec §2's estimate.** 17 units for 371 videos and 19 for 445 (one channel lookup,
  one unit per page of 50, one per detail batch of 50). §2 predicts "roughly 40" for a 1,000-video
  channel; this is that rate.
- **An incremental re-check of both channels cost 4 units** — the cheapest a check can be.
- **A broadcast that never aired is re-read on every check.** Majestic View has a service scheduled
  for 19 July 2026 that still reads `upcoming` and has a duration of 0. §6's first filter leaves it
  unledgered on purpose (it should be re-seen once it finishes) but it never will finish, so it looks
  unseen for ever and the stop rule cannot fire on the page holding it. Two extra quota units per
  check, permanently. Recorded in spec §13 rather than special-cased: ledgering a video that may yet
  air would be worse.
- **The key stayed out of the logs**: every outbound line reads `key=REDACTED`, and no key-shaped
  string appears anywhere in them.

### The browser pass — three defects, one of them mine, and two runs that looked at nothing

Every state at 1440px and 390px in both themes, against live Concord and two songbird instances (one
keyed, one not): populated, mid-scan, after a scan, the ledger in three filter states, add, edit,
delete-confirm, the re-date dialog, and no-key. 48 shots.

1. **The ledger dated every livestreamed service a day late.** Majestic View's rows read "Sep 7,
   2026" beside titles saying "Sep. 06 2026" — because a service streamed on the Sunday afternoon is
   published in the small hours of the Monday. That is precisely the disagreement spec §7's date rule
   exists to settle, and §7's own words are that the rule "makes songbird agree with what a reader
   sees on YouTube". The ledger disagreed with it, on 199 of 200 rows. The ledger now stores
   `actual_start_time` beside `published_at` and dates a row by the first of the two — which slice 4b
   needs anyway.
2. **Two `role="status"` elements, and a misdiagnosis.** The harness's `getByRole("status")` matched
   the indicator, then matched the banner after the scan ended, so its wait never resolved. I read
   that as two simultaneous live regions and moved the announcement to the banner — which put the
   same sentence on screen twice, caught by the next pass's phone shots. They were never
   simultaneous. The indicator keeps the role; the banner stays quiet for a queued check; the harness
   waits by text, which is unambiguous either way.
3. **The harness could not sign in to a fresh instance.** Its helper clicked "Sign in" whenever that
   button existed, which is always — so the no-key instance, whose database is always new, never got
   past the login page and the phone and no-key states were silently never looked at. It now falls
   back to registering.

### How it was verified

- `make check` — **405 passed** (342 on `main`), Ruff and format clean, Pyright strict 0 errors.
- `make check-frontend` — **285 passed** (269 on `main`), ESLint, tsc and build clean.
- `alembic upgrade head` → `downgrade -1` → `upgrade head` on a scratch database, and the migration's
  schema checked column-for-column against the models — tests build from the models, production
  builds from the migration, and nothing else compares them.
- **Mutation-tested**: 42 deliberate breaks — 7 on the client, 14 on the runner, 10 on the API, 11 on
  the page. **Seven survived**, and six of them were real gaps now covered: the ledger's author scope,
  the due query's `enabled` filter, the cross-page duplicate guard, the mid-scan `scan_complete`
  write, the polling lifecycle, and the poll's "stop asking when the server stops answering" guard.
  The seventh is recorded rather than fixed — swapping the commit and the runner call in `POST ""`
  leaves everything green, because the stand-in runner does no I/O and the real consequence is a race
  the fast suite cannot force deterministically. That ordering is held by the comment at the call
  site, not by a test.
- The live acceptance and browser pass above.

### Still open

- **The 429 quota path has still never been seen for real**, only faked. It needs an exhausted key.
- **`needs_passage` and `placed` are always zero**, and the ledger's `pending` rows do nothing yet.
  Slice 4b reads them.

---

## Sermon sources slice 3 — sources CRUD (and the browser pass slice 2 skipped)

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-3-sources`

### Why

Slices 1 and 2 built the YouTube client and used it to fix dates on notes that already existed.
This is the first half of what the feature is actually for: telling songbird **where sermons come
from**. A source is a channel or playlist you register once by pasting a link; songbird resolves it
through YouTube and stores the ids a later scan will read.

Nothing is scanned yet. Spec §5 has the first catalogue scan run on add, and that is slice 4 — the
seam is deliberate, so the CRUD reviews as one diff and the scan as another.

### What landed

- **`sermon_sources` + `sermon_source_tags`** (migration `0011`), spec §4 exactly. Tags are a third
  arm on the *same* vocabulary, so a tag put on a channel shows up in the type-ahead everywhere.
- **`parse_source_url`** in `youtube/urls.py` — handle, channel id, or playlist id, or None.
- **Three client lookups**: `resolve_channel_by_handle`, `get_channel`, `get_playlist`.
- **`/api/v1/sermon-sources`** with list / add / get / edit / delete, plus `/status`.
- **The Sermon sources page** (`/sermon-sources`), linked from the top nav and from Browse. The
  re-date button and its dialog moved here from Browse, which held them only until this page existed.
- **`scripts/screenshots/inspect-sources.mjs`** — a sibling of `capture.mjs` that walks the page
  through every state at two widths in both themes. Its output is throwaway; it exists so slices 4
  and 5 don't have to write it again.

### What the live calls showed

All five real sources resolved on the first try — the four churches and one curated playlist:

| pasted | kind | id | uploads | title |
|---|---|---|---|---|
| `@cornerstonechpl` | channel | `UCgS2kskDIvTyzKKJzkhivxw` | `UUgS2kskDIvTyzKKJzkhivxw` | Cornerstone Chapel - Leesburg, VA |
| `@CelebrationChurch_org` | channel | `UCjp6iEjx01RUfsFjLdooC2Q` | `UUjp6iEjx01RUfsFjLdooC2Q` | Celebration Church |
| `@2819Church` | channel | `UCrPGIKiPtgQ25TaW1fLdR0Q` | `UUrPGIKiPtgQ25TaW1fLdR0Q` | 2819 Church |
| `@majesticviewchurchlive407` | channel | `UCsVNa_Y5Gia4nG4RW5Xr5Kg` | `UUsVNa_Y5Gia4nG4RW5Xr5Kg` | MajesticViewChurchLive |
| `playlist?list=PLw5K9…` | playlist | `PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t` | — | Gary Hamrick - Cornerstone Chapel, Leesburg - 01. Genesis - Deuteronomy |

- **An unknown `@handle` is HTTP 200 with no `items`, not a 404.** Asked for
  `@nosuchchurchanywhere1234`; the logged response was `"HTTP/1.1 200 OK"`. So the client's
  empty-items → `YouTubeNotFoundError` rule is what produces the 404 a person sees, and a client
  that only mapped status codes would have stored a source that isn't there.
- **`forHandle` takes the `@`.** httpx percent-encodes it (`forHandle=%40cornerstonechpl`) and
  Google resolves it fine — same story as slice 2's `%2C`.
- **The uploads playlist is the channel id with `UC` → `UU`** in all four cases. songbird still
  *reads* it from `contentDetails.relatedPlaylists.uploads` rather than deriving it; the pattern is
  an observation, not a contract.
- **A `/c/…` link spends no quota.** It is rejected by the parser before any lookup — confirmed by
  there being no outbound request in the log for it.
- **The duplicate check is on the resolved id, not the pasted text.** Added Cornerstone by its
  `@handle`, then again by its `/channel/UC…` link, and got the 409.
- The key stayed out of the logs: 20 outbound request lines, all reading `key=REDACTED`.

### The browser pass — three real defects, all in slice 2's dialog

This is the check #122 taught us not to skip, and slice 2 skipped it. Every state of the page at
1440px and 390px in both themes: no key, empty, populated, add form, edit, delete confirm, and the
re-date preview with eight real rows. What it found, all in the dialog nobody had looked at:

1. **`opacity-60` on an unchanged preview row broke its own contrast.** The blanket opacity blended
   every layer, including the small grey reference and date lines — which *are* the content of an
   unchanged row. Measured: **2.33:1 in light mode, 3.02:1 in dark**, against the 4.5:1 a reader
   needs. Now muted by a dimmer colour instead, with every layer at 4.83:1 or better. Exactly the
   #122 mistake in a new place: a whole-element effect on text with no contrast to spare.
2. **Two groups, one phrase.** The counts line read "1 note isn't on YouTube" directly above a list
   of two headed "Couldn't be found on YouTube". They mean different things — a note whose link
   isn't YouTube at all, versus a video YouTube wouldn't return — and side by side in a browser you
   cannot tell that. The first now says "links somewhere else".
3. **The form's fields didn't match the app.** They carried their own `bg-white dark:bg-gray-900`,
   overriding the base rule in `index.css` that gives every dark input a surface. Removed.

Also fixed in the harness: dialog shots were `fullPage`, which stitches the page *behind* a fixed
modal in below the fold. Viewport shots now, as `capture.mjs` already does for the same reason.

None of the three would have been caught by a test. All three were obvious within seconds of
looking.

### Gotchas / things to know

- **`select(...).union(a).union(b)` does not work.** The first `.union()` returns a `CompoundSelect`,
  which has no `.union` of its own — `union(a, b)` in one call is the form. Pyright did not catch it;
  the existing tag tests did, immediately.
- **`/status` had to be declared before `/{source_id}`.** FastAPI matches in registration order, so
  the other way round "status" is parsed as an int id and 422s. There is a test that would fail if
  the two were ever swapped.
- **`/status` also needed a dependency that doesn't refuse.** Every other route demands a YouTube
  client and 409s without one — right for them, wrong for the one route whose *job* is to report
  that there is no key. So `get_youtube_client_optional` is now the seam and `get_youtube_client`
  derives from it. Tests override the seam and both move together.
- **`min_minutes` is the one field where null is a value.** Absent means "leave it", null means
  "follow `SERMON_MIN_MINUTES` again", so PATCH reads `body.model_fields_set` for that field alone.
  Two tests hold the pair apart; without both, the `is not None` idiom would look correct.
- **The add form shows the default as a placeholder, not a prefill.** A literal prefill would write
  today's default onto every source and make the nullable column dead on arrival. This is a
  deliberate departure from the slice brief's wording, agreed up front.
- **A mutation found a test that couldn't fail.** Deleting `url.strip()` left the URL suite green:
  `urlsplit` trims a URL itself, so the strip only ever mattered on the bare-handle path — which had
  no whitespace case. `"@handle\n"` is exactly what a paste produces, and now it is tested.
- **Delete asks in the row.** The app had no confirm pattern at all — no `window.confirm`, no confirm
  dialog. Keeping the question next to the source means you can still see which one you're removing.

### How it was verified

- `make check` (**342 passed**, up from 313; ruff + `ruff format --check` clean, pyright strict 0
  errors) and `make check-frontend` (**269 passed**, up from 258; eslint / tsc / build clean).
- **Migration round-trip**: `upgrade head` → `downgrade -1` → `upgrade head` on a scratch DB, plus a
  column-by-column comparison of what the migration created against what the models declare — they
  match, so the test suite's `create_all` and a real deployment cannot drift.
- **Mutation testing, 36 mutations across the four suites** — parser 8, client lookups 7, API 11,
  frontend 10. Thirty-five were caught first time; the one survivor exposed a real test gap (the
  whitespace case above) and was caught once that gap was closed. Source committed before each
  mutation (slice 2's `git checkout --` lesson).
- **Live, through the browser, against the real API**: all five real sources added, edited and
  deleted; the `/c/…` message read back as a first-time reader would; an unknown handle recorded.
- **The browser pass above.** Every source and note created for it was deleted afterwards; the
  scratch `DATA_DIR` is gone.

### Still open

- **The 429 quota path has never been seen for real**, only faked. It needs an exhausted key, which
  is not worth arranging.
- **`last_checked_at` is always null**, so the page always says "never checked". Slice 4 fills it in.
- The counts spec §10 wants on each source row wait on the scan that produces them.

---

## Sermon sources slice 2 — re-date (the first live YouTube calls)

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-2-redate`

### Why

Sermon notes made by hand carry whatever date was typed, which is usually the day the note was
written. Spec §7 sets one rule for every sermon date — the UTC calendar day of the livestream's
`actualStartTime` when there is one, else `publishedAt` — and §11 applies it backwards, once, to
the notes that already exist. It also back-fills `youtube_video_id`, which is what lets slice 4's
catalog scan recognise those videos as already noted.

Slice 1 built the YouTube client but never called it. This slice is the first real call, so
confirming the three assumptions slice 1 left open was part of the work.

### What landed

- **`POST /api/v1/sermon-notes/redate`** (`api/sermon_redate.py`, a sibling of `sermon_notes.py` —
  the only sermon-note route that talks to YouTube). `dry_run` defaults to true and writes nothing;
  applying collects every lookup first and writes in one commit.
- **The Browse view's third action**, "Re-date YouTube sermons", with a preview dialog.
- **`YOUTUBE_API_KEY` in `docker-compose.yml`**, pulled forward from slice 6.
- **`YOUTUBE_KEY_REJECTED`** (502), the fourth YouTube error code.

### What the live calls actually showed

All three of slice 1's open assumptions are now confirmed, against the real API:

- **(a) Unknown ids come back absent, with HTTP 200 — not a 404.** Asked `videos.list` for
  `o7GX1JhBhkc` and the made-up `aaaaaaaaaaa`; one came back, status 200. The client's "ids YouTube
  doesn't return are simply absent" contract holds.
- **(b) The error body has the reason in two places, and they disagree.** A deliberate junk-key
  call returns `errors: [{"reason": "badRequest"}]` and
  `details: [{"@type": ".../ErrorInfo", "reason": "API_KEY_INVALID"}, {"@type": ".../LocalizedMessage", ...}]`.
  The legacy `errors[]` token is useless; the specific one is in `details[]`. Note the second
  `details[]` entry has **no `reason` key at all**, so the reader has to tolerate that.
- **(c) Google accepts httpx's percent-encoded comma.** The logged request was
  `id=aaaaaaaaaaa%2ChWYK_8JQ7-E%2Co7GX1JhBhkc%2CuzZFLT6B_Tk` and all four ids were understood. No
  need to build the `id=` list literally.

And one thing nobody asked about, which turned out to matter most:

- **`actualStartTime` and `publishedAt` disagree constantly, and the difference crosses midnight.**
  Majestic View's 6 September 2026 service started at `14:55:12Z` and was published at `04:32:29Z`
  the **next day**. `publishedAt` would file a Sunday sermon under Monday. YouTube's own page says
  "Streamed live on Sep 6, 2026", so the §7 rule is what makes songbird agree with what a reader
  sees on YouTube. The same is true of Celebration's `o7GX1JhBhkc`, which the brief described as an
  upload but which is a completed livestream (12:46Z start, 16:26Z publish).

### Gotchas / things to know

- **Two mutation tests were mutating the wrong code, and both looked green.** The frontend one
  used `perl` without `/g` on `invalidateQueries({ queryKey: ["browse-sermon"] })` — of which there
  are **two**, and the first belongs to the import mutation. The backend ordering test seeded two
  notes in an order where `ORDER BY id DESC` reproduces the canonical sequence, so deleting the
  ordering changed nothing. Both are fixed; the ordering test now uses four notes arranged so
  id-ascending, id-descending and book-order-alone each give a different answer.
- **A React Query test that refetches on its own can't fail.** `BrowseView.test.tsx`'s shared
  harness builds a `QueryClient` with only `retry: false`, so `refetchOnWindowFocus` is left **on**
  — and `userEvent`'s focus events refetch the list. The "apply refreshes the list" assertion held
  with the invalidation deleted. That one test now renders with the app's real defaults
  (`staleTime: 30_000`, `refetchOnWindowFocus: false`), so only the invalidation can refresh it.
- **`git checkout --` during a mutation test destroys uncommitted work.** Cost the `_error_reasons`
  change once. Commit the source first, *then* mutate — the same trap slice 1 hit from the other
  direction.
- **Seeded sermon notes arrive already stamped.** Slice 1's `@validates` fires on the constructor,
  so a test fixture built with a YouTube URL already has `youtube_video_id` — which is not the row
  this cleanup exists for. The test helper nulls the column directly (the validator watches
  `sermon_url`, not the column) so the back-fill is genuinely under test.
- **Writes are guarded by inequality, not left to the ORM.** `if note.event_date != new_date` before
  assigning. That makes "a re-run is a no-op" true at the SQL level and keeps `updated_at` honest —
  verified live: a second apply left every `updated_at` byte-identical.
- **`Settings` reads the repo-root `.env` regardless of the process environment**
  (`env_file=REPO_ROOT / ".env"`), so `env -u YOUTUBE_API_KEY` does **not** produce a keyless run on
  a dev box that has one. The empty-string case (`YOUTUBE_API_KEY=""`, which is exactly what
  `${YOUTUBE_API_KEY:-}` yields in compose) is the same code path and is what was tested.
- **`.reason` reports the LAST reason, not the first.** See (b): reading legacy-then-modern means
  the last one is the specific one. The first draft reported the first, and the message an admin
  saw was "(YouTube said: badRequest)". Found by running the path through the real app, not a mock.

### How it was verified

- Backend: `ruff check`, `ruff format --check`, `pyright` strict (**0 errors**), `pytest`
  (**300 passed**, up from 280). Frontend: `eslint`, `tsc --noEmit`, `vitest` (**258 passed**, up
  from 253), `vite build`.
- **Every guard mutation-checked.** Backend: inverting the date rule, flipping the `dry_run`
  default, letting a dry run write, skipping the stamp on not-found notes, dropping author scoping,
  counting unchanged rows as applied, three wrong orderings, and mis-mapping a rejected key all
  turn tests red. Frontend: un-disabling Apply, hiding unchanged rows, dropping the not-found list,
  losing the no-key message, and removing either invalidation all turn tests red.
- **Live, against the real API and a scratch database** (Concord v1.2.0 in Docker, uvicorn on a
  throwaway `DATA_DIR`, five sermon notes created for the purpose and deleted after). Stamps nulled
  first so it was a genuine pre-v1.7 back-fill. Preview: correct dates, correct sources, the
  made-up id in `not_found`, the non-YouTube note in `skipped_non_youtube`, canonical order
  (John 43 → Acts 44 → Romans 45), and **the database byte-for-byte unchanged**. Apply: `applied: 3`,
  dates written, all four YouTube notes stamped including the not-found one, the non-YouTube note
  untouched. Second apply: `applied: 0`, nothing `changed`, `updated_at` unmoved.
- **Checked by eye against YouTube's own pages**: "Streamed live on Mar 8, 2026" → `2026-03-08`;
  "May 11, 2025" → `2025-05-11`; "Streamed live on Sep 6, 2026" → `2026-09-06`. All three agree.
- **Failure paths through the running app**: a wrong key → 502 `YOUTUBE_KEY_REJECTED` naming
  `YOUTUBE_API_KEY` and saying `API_KEY_INVALID`; an empty key → boot logs
  `sermon sources: off (no YOUTUBE_API_KEY)` and the endpoint 409s, while listing notes and the
  chapter overlay carry on unchanged.
- **The key stayed out of the logs.** Both keyed boots checked: absent, and httpx's own INFO request
  line reads `key=REDACTED` — slice 1's filter working in production, not just in a test.
- `docker compose config` with and without the key: the value flows through, and an unset one
  becomes `""`, which is falsy.

### Still open

- **No browser pass.** The preview dialog is covered by component tests (msw-driven), not by a human
  or a headless browser looking at it. #122 is the standing reminder that a UI verified only in
  tests can still look wrong; worth a glance on the Sources page in slice 3.
- **A truly absent `YOUTUBE_API_KEY` was not exercised on a machine that has a `.env`** — see the
  gotcha above. The empty-string path is the same branch and was.
- The quota path (429) has never been seen for real; a full day's quota is 10,000 units and this
  slice spent about a dozen. It stays fake-tested until a scan makes it reachable.

---

## Sermon sources slice 1 — foundation (the YouTube client)

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-1-foundation`

### Why

v1.7 sermon sources (`docs/v1.7/SERMON-SOURCES-SPEC.md`) needs a second outbound HTTP dependency —
YouTube's Data API v3 — held to the same rules as Concord. This slice lays that foundation and
nothing else: settings, the client, the URL helper, and the `sermon_notes.youtube_video_id`
column. Nothing user-visible changes, and with no key set nothing about the app changes at all.

### What landed

- **Three settings** (`YOUTUBE_API_KEY`, `SERMON_CHECK_INTERVAL_HOURS`, `SERMON_MIN_MINUTES`).
  Only the key is read so far; the other two land now so later slices don't reopen config.
- **`songbird/youtube/`** — `urls.py` (pure), `schemas.py` (wire models + the flattened `Video`),
  `client.py` (`YouTubeClient.get_videos`, batching 50 ids per call). Built in the lifespan only
  when a key is set; `get_youtube_client` 409s `YOUTUBE_NOT_CONFIGURED` when there isn't one.
- **Migration `0010`** — nullable, indexed `sermon_notes.youtube_video_id`, stamped from
  `sermon_url` by a `@validates` on the model.

### Gotchas / things to know

- **httpx prints the API key on every successful request, and nothing about exception handling
  fixes that.** httpx logs `HTTP Request: GET <full url> "200 OK"` at **INFO**, and `create_app()`
  calls `logging.basicConfig(level=INFO)` when no handler is configured — which is the production
  path, because uvicorn configures only its own loggers. The client installs a redacting
  `logging.Filter` on the `httpx` logger from its constructor. This was the single biggest finding
  of the slice, and it was invisible in every test that only looked at exceptions.
- **`raise ... from exc` leaks the key; `from None` does not.** `HTTPStatusError`'s message embeds
  the full URL. Measured: with `from exc` the key appears in
  `"".join(traceback.format_exception(e))`, with `from None` it does not. A bare `raise E(...)`
  inside an `except` block leaks it too, via the implicit `__context__`. So this one client
  overrides the `concord/client.py` idiom deliberately — the comment at the top of the file says
  so, because it otherwise reads like an oversight.
- **Nothing stores the httpx exception.** `ConcordUnreachableError` keeps `.cause`; the equivalent
  here would keep `exc.request.url` and the key with it. `YouTubeError` carries `status` and
  `reason` instead — safe scalars, and what a source's `last_check_status` will want anyway.
- **A secrecy test that can't fail is worse than no test.** All three were mutation-checked:
  reverting `from None`, removing the log filter, and un-redacting the transport-error message
  each turn the matching test red. The log test in particular must call
  `caplog.at_level(logging.DEBUG)` with **no `logger=` argument** — scoping it to `"songbird"`
  makes it permanently green, because the logger that leaks is `httpx`'s.
- **`@validates` does not fire when SQLAlchemy loads a row** (verified against 2.0.36). That is
  what makes it safe for the re-date back-fill: a value written straight to the column survives
  being read back. It *does* fire on constructor kwargs and on reassignment, including clearing
  the id when a URL stops being a YouTube one. A bulk `update()` **would** bypass it — nothing in
  songbird issues one today, and slice 2 should set both columns explicitly rather than rely on it.
- **The validator is the first in this codebase, and it earns it.** There are three places a
  `SermonNote` is constructed — `api/sermon_notes.py`, `api/import_export.py`, and
  `scripts/seed_sermon_notes.py` — plus the PATCH route's reassignment. A helper called from each
  is a helper one of them eventually forgets; the seed loader in particular gets this for free.
- **`duration_seconds is None` means unknown, not zero.** Slice 4's filter must be
  `if seconds is not None and seconds < minimum`, or a video of unknown length gets ledgered as
  `too_short` — a reason it hasn't earned.
- **`youtube/__init__.py` must stay a bare docstring.** `alembic/env.py` imports
  `songbird.db.models`, which now imports `songbird.youtube.urls`; re-exporting the client from
  the package `__init__` would drag httpx into every migration run.
- **The URL helper uses `urlsplit`, not a regex.** Only a real parser reads
  `https://www.youtube.com@evil.test/watch?v=ID` correctly — the host there is `evil.test`.
- **`_norm_sermon` in `import_export_test.py` whitelists the keys it compares**, so it cannot
  notice a *new* key appearing in the export. Pinning "the export is unchanged" needed an exact
  key-set assertion; that too was mutation-checked.

### How it was verified

- Backend: `ruff check`, `ruff format --check`, `pyright` strict (**0 errors**), `pytest`
  (**280 passed**, up from 241; 4 concord-deselected). *`pyright` needs the venv on
  `PATH`/`VIRTUAL_ENV` or it can't resolve `fastapi` and reports ~1459 phantom errors.*
- Frontend: `eslint`, `tsc --noEmit`, `vitest` (**253 passed**, 38 files — unchanged, as intended),
  `vite build`.
- Migration run for real on a scratch DB: `alembic upgrade head` → the column and
  `ix_sermon_notes_youtube_video_id` appear; `downgrade -1` → both disappear cleanly; upgrade
  again. Existing rows keep null.
- The stamping chain exercised end to end against a real session: create stamps, a non-YouTube URL
  clears, a YouTube URL re-stamps, and the model's index name matches the migration's.
- The three secrecy guards mutation-tested (above).

### Still open

- No test runs the lifespan itself, so "the client is built only when a key is set" is covered by
  reading, not by a test — consistent with the rest of the repo, where the lifespan is never run in
  the fast suite. Worth revisiting if the lifespan grows a third client.
- **No live YouTube call has been made yet.** Nothing calls the client this slice, so a handful of
  assumptions are still unconfirmed: that `videos.list` returns unknown ids as simply absent rather
  than 404, the exact error-body shape the `reason` reader depends on, and that Google accepts
  httpx's percent-encoded comma in `id=`. Slice 2 is the first real call and should treat
  confirming these as part of its acceptance.
  *(Resolved in slice 2 — see that entry's "What the live calls actually showed". Unknown ids come
  back absent with a 200, not a 404; the reason lives in `details[]` as well as `errors[]`, and the
  `details[]` one is the useful one; and Google accepts the percent-encoded comma.)*

---

## #122 follow-up — the dark highlight, done properly

- **Date:** 2026-09-06
- **Branch:** `slice/122b-dark-highlight`

### Why there is a second entry

The first attempt (below) shipped and made it worse. Kris: *"A shit colored brown stain highlight???
THIS MUCH MUCH WORSE!!!!"* Two mistakes, and the second caused the first.

**1. It optimised the wrong axis.** The entry below argues, in writing, that the fault was *loudness
rather than hue* — light at 1.07:1 against the page, dark at 1.96:1 — and so kept the amber family
and merely darkened it. The complaint was the colour both times: "a very yellowish-orange", then
"brown stain". `amber-950` is `#451a03`, 88% saturation, pure brown; on a cool navy page that is a
stain at *any* amplitude.

**2. It was verified against a case that does not occur.** The verification used a chapter with
**two** annotated verses, where a warm tint reads as a tidy accent band. Real chapters here often
carry a dozen annotated verses in a row. Each verse is its own `<p>` with `py-0.5`, and Tailwind's
preflight zeroes `p { margin: 0 }`, so consecutive marked verses stack with **zero gap** into one
unbroken field. **A tint that works as an accent becomes a stain when it is the majority state of
the page.** That case was never rendered, so the problem was never seen.

The general lesson, which is the useful part: *verify the state the feature is actually in most of
the time, not the state that is easiest to construct.*

### How it was decided

Not by reasoning about hex codes again. Five candidate treatments were rendered against the real
failing case — Philippians 2, notes **and** sermons on eleven consecutive verses, at phone width,
against live Concord — using Playwright with per-candidate CSS injected via `addStyleTag` (no
rebuild per candidate). Kris picked from screenshots.

### What landed — option D

`VERSE_HIGHLIGHT` in dark mode is now a **colourless lift plus an amber rule at the edge**:

```
bg-amber-100 dark:bg-white/5
dark:before:absolute dark:before:inset-y-0 dark:before:left-0 dark:before:w-[3px]
dark:before:bg-amber-500 dark:before:content-['']
```

The fill has no hue left to clash with the page (`white/5` → `#1b2130`, 1.10:1); the amber identity
moves to a 3px rule in the gutter. A run of twelve marked verses reads as one cleanly-edged block
instead of a slab. Light mode keeps the cream wash it has always had.

### Gotchas / things to know

- **The rule is a pseudo-element, not a `border-l`.** A real left border eats 3px of content box and
  shifts every glyph right. `relative` was already on the reader's verse `<p>` with no consumer, so
  `before:absolute … left-0` sits in the 12px the row already bleeds via `-mx-3`. Verified from the
  browser: `padding-left` stays `12px` in **both** themes.
- **CompareView needed `relative` added** — its cell had no positioning context, so the rule would
  have escaped to the nearest positioned ancestor.
- **Do not use a `ring` for a treatment here.** Every Tailwind ring utility writes the same
  `--tw-ring-shadow`, so it would silently fight the deep-link `ring-2 ring-blue-400` — one wins by
  stylesheet order, not class order. Borders and pseudo-elements compose; rings do not.
- **`gray-800` was rejected as the panel colour** even though it is the app's card surface: it is
  also `TopNav`'s colour, so marked rows would read as header-coloured cards floating in the text.
- **Tailwind emits `:before`, not `::before`** — worth knowing when grepping built CSS to confirm a
  pseudo-element rule shipped.
- **The rule test from #123 had a hole exactly where this landed.** Its `parse()` recognised only
  `bg-` and `text-`, so a border- or rule-based accent would have satisfied the "every light utility
  has a dark counterpart" invariant *vacuously*. `parse()` now covers `border-` too, with a
  regression test on the helper itself.

### How it was verified

- **The eleven-verse case at phone width is the primary check** — the thing the first attempt
  skipped. Rendered in both themes against live Concord.
- Computed styles read back from the browser rather than inferred from class strings: dark fill
  `rgba(255,255,255,0.05)`, rule `absolute` / `3px` / `rgb(245,158,11)` / `left:0`; light fill
  `rgb(254,243,199)` with the pseudo-element resolving to `content: none`, i.e. no rule at all.
- **Light mode unchanged, proved mechanically:** across the shipped diff (excluding tests) **no
  light-mode colour token is added or removed** — the only change is
  `dark:bg-amber-950/90` → `dark:bg-white/5` + `dark:before:bg-amber-500`.
- Built-CSS check: all six `dark:before:*` rules emitted; neither `amber-900` nor `amber-950`
  appears in the highlight any more (the remaining hits are the basemap banners, the journey callout
  and the Welcome pills, all unrelated).
- Backend `ruff` / `ruff format --check` / `pyright` strict (0 errors) / `pytest`; frontend `eslint`
  / `tsc --noEmit` / `vitest` (253 passed) / `vite build`.

### Still open

The three hover-reveal buttons `⇄ ※ ℵ` in the reader are `text-gray-300` with no `dark:` variant —
another one the #60 sweep missed, near-invisible on the dark page. Not bundled here; it is not what
#122 is about.

---

## #122 — dark-mode annotation highlight

- **Date:** 2026-09-06
- **Branch:** `slice/122-dark-highlight`

### Why

The annotated-verse wash was `bg-amber-100 dark:bg-amber-900` — and nobody chose the dark half.
The #60 sweep (below) was "a scripted single-pass regex"; it flipped the light tint to its
mechanical opposite on the amber scale. Measured against the real surfaces:

| | fill | vs page | brightness vs page |
|---|---|---|---|
| Light | `#fef3c7` on `#fafaf9` | **1.07:1** | 0.94× (a shade *darker* than the page) |
| Dark, before | `#78350f` on `#111827` | **1.96:1** | **7.2×** |

So the bug was not the hue, it was the **loudness**: dark asserted itself about twice as hard
against its page as light did against its own, which is why it read as a slab rather than a tint.
Picking a prettier brown at the same amplitude would not have fixed it.

### What landed

- **`frontend/src/lib/annotationStyles.ts`** — the accent in one home. Reader and Compare held
  byte-identical hand copies of the highlight, the ● and the count badge; the popovers held their
  own eyebrow colours. That duplication is what let the #60 sweep leave them inconsistent.
  Colour only — the highlight's layout genuinely differs per view (a reader row is already
  `rounded px-3`, a compare cell needs its own), so call sites keep their spacing.
- **The wash:** `dark:bg-amber-950/90` → `#401a07`, **1.16:1**, matching light's restraint. Chosen
  over a neutral tint to keep the warm "amber = your note" identity, and it is already the repo's
  idiom (`MapView.tsx`, `JourneyMap.tsx` basemap banners).
- **The markers, which the quieter wash promotes to the primary cue:** ● gets a dark base at last
  (`dark:text-amber-400`, 9.2:1 on the wash — it was amber-600 at 2.9:1, with only its *hover*
  state given a dark variant). Count badge, out-of-scope ○ badge, sermon ▶ and its badge likewise.
- **Adjacent gaps the same sweep missed** (no `dark:` at all): the search-match `<mark>`, the
  Welcome NOTE/SERMON pills, the SidePanel scope warning, the Compare "rotate to landscape" hint.
- **Popover eyebrows** now follow `NotePopover`'s violet treatment, the one done right:
  `text-amber-700 dark:text-amber-400` (8.8:1 on the card, was 2.9:1).

### Gotchas / things to know

- **Tailwind's preflight does not reset `<mark>`.** It keeps the UA `color: marktext` (black), so
  the search highlight's `dark:text-yellow-100` is **required**, not decoration — darkening only
  its background would have put black text on dark olive. Light keeps the UA black, unchanged.
- **Moving classes into a constants module is safe here**: `tailwind.config.ts` scans
  `./src/**/*.{ts,tsx}` as raw text, so complete class tokens in a `.ts` literal are found. Verified
  in the built CSS rather than assumed — `bg-amber-950/90` emits `background-color:#451a03e6`.
- **Search stays deliberately louder than annotation** (1.84:1 vs 1.16:1). Different jobs: a search
  hit points at what you just asked for, an annotation wash is passive. The olive also separates it
  from the ember — in light mode `yellow-200` and `amber-100` are one step apart and easy to confuse.
- **Still open (light mode, deliberately not touched):** the multi-note count badge is `bg-amber-100`
  sitting on the `bg-amber-100` wash — **1.00:1**, so the pill background does nothing and only its
  text colour separates it. Shipped in #114, unrelated to dark mode. `bg-amber-200` would fix it;
  left out because #122 is a dark-mode issue and light mode is what Kris likes.
- **Prettier is not gated** (absent from the Makefile and CI) and six of the touched files were
  already non-compliant on `main`. Left alone — `--write` would bury the diff in reformatting.

### How it was verified

- Backend: `ruff check`, `ruff format --check`, `pyright` strict (**0 errors**), `pytest`
  (241 passed, 4 concord-deselected). No backend files changed. *Note: `pyright` needs the venv on
  `PATH`/`VIRTUAL_ENV`; without it, it cannot resolve `fastapi` and reports ~1459 phantom errors.*
- Frontend: `eslint`, `tsc --noEmit`, `vitest` (**251 passed**, 38 files), `vite build`.
- **The rule test** (`annotationStyles.test.ts`) asserts every light utility in the accent set has a
  `dark:` counterpart at the same variant — the invariant the #60 regex broke, rather than a colour
  snapshot. Proved non-vacuous against the two real pre-#122 strings: it rejects the badge with no
  dark variant and the ● whose dark variant covered only `hover:`.
- Built-CSS check: every new dark rule is emitted (`bg-amber-950/90`, `bg-amber-400/20`,
  `bg-yellow-400/25`, the amber/emerald 400/300/100/200 text rules), and `bg-amber-900` no longer
  appears in the bundle at all.
- Live: `docker compose up --build` on :8077 — dark-mode pass over Reader, Compare, the popovers,
  Search and Welcome, then a light-mode pass to confirm no daylight regression.

---

## Release prep v1.6.0 — version reconciliation + CHANGELOG (Stop 1 of a two-stop release)

- **Date:** 2026-06-09
- **Branch:** `slice/release-1.6.0-prep`

### Why

The last release tag was `v1.1.0`, but the package versions never moved off the `0.1.0` scaffold
default, and everything since — sermon notes (v1.2), search expansion (v1.3), places (v1.4),
verse-of-the-day (v1.5), the whole v1.6 fan-out, plus the User's Guide — shipped untagged. This
re-aligns the release tag with the `docs/vX` feature line and reconciles the version drift.

### The version is single-sourced

`backend/songbird/__init__.py`'s `__version__` is the one source of truth for the *served* version:
`main.py` passes it to `FastAPI(version=__version__)` (so the OpenAPI `info.version` follows) and
`health.py` returns it on `/healthz`. So only four files declare a `0.1.0` literal, and bumping them
reconciles everything:

- `backend/pyproject.toml` → `1.6.0`
- `backend/songbird/__init__.py` (`__version__`) → `1.6.0`  *(drives FastAPI/OpenAPI + `/healthz`)*
- `frontend/package.json` → `1.6.0`
- `frontend/src/test/msw/handlers.ts` (the `/healthz` mock) → `1.6.0` *(fixture realism; no test
  asserts the literal — `health_test.py` only checks it's a `str`)*

### Version-looking values deliberately left alone

- `scripts/screenshots/package.json` `1.0.0` — a separate internal screenshot dev tool, its own
  versioning, not shipped (Kris's call: leave it).
- `frontend/src/schemas.ts` `version: z.string()`/`z.number()` and `backend/.../api/schemas.py`
  `version: int = 1` — the export-bundle **data-format** version, not the app version.
- `frontend/src/lib/map/style.ts` `version: 8` — MapLibre style-spec version.
- `backend/tests/concord_contract_test.py` asserts `info["version"] == "1.2.0"` — that's **Concord's**
  pinned OpenAPI version, not songbird's. Untouched.
- `Dockerfile` carries no version label; the app UI shows no version string. Nothing to change.

### No published artifact → the release is tag + GitHub Release only

CI runs gates only; the nightly workflow runs the live contract test; there is **no release/publish
workflow and no GHCR push of a songbird image**. `docker-compose.yml` *builds* songbird locally
(`build: .`) and only pulls Concord's image; the README installs by clone/ZIP + `docker compose up`.
So unlike Concord (which publishes a GHCR image), a songbird "release" is just the git tag + a GitHub
Release — no image-publish step.

### CHANGELOG.md (new)

Keep-a-Changelog style, newest-first, plain language for the same audience as the User's Guide.
Per-version backfill (1.0.0 → 1.6.0) sourced from this dev-notes log and the `docs/vX` specs, not
invented. A preamble explains the tag drift and that earlier versions are documented but not
retroactively tagged. Dates are git-sourced (tags for 1.0/1.1; design-notes first-commit for 1.2–1.5;
today for 1.6.0).

### Two-stop release

This PR is **files only** (versions + `CHANGELOG.md` + this entry) and leaves both gates green. The
**tag and GitHub Release are Stop 2** — presented for explicit authorization *after* this PR merges,
run from a freshly-pulled `main`. The tag is never pushed in the same breath as the PR.

### Verified

- `grep -rnE '0\.1\.0'` (deps/locks excluded) → no matches; the four bumped sites read `1.6.0`.
- `make check` → green (241 passed / 4 deselected). `make check-frontend` → green (221 passed, build
  clean). The version bump (incl. the healthz mock) broke no test.

---

## Docs Slice 5 — README trimmed to a landing page + spec index fixed (docs epic complete)

- **Date:** 2026-06-09
- **Branch:** `slice/docs-5-readme`

### Why
With the user's guide complete (Slices 2–4, PRs #109–#111), the README duplicated feature how-to in
"## Using songbird," carried eight "## See it" embeds, and listed design specs only through v1.5 —
silently omitting the whole v1.6 epic. This final docs slice makes the README a front-door landing
page (frame + install + link out) and fixes the spec index. README + dev-notes only — `make check` /
`make check-frontend` unaffected.

### What changed in README.md
- **Removed "## Using songbird"** (the bulleted feature how-to; it lives expanded + illustrated in
  the guide). Added a one-line **User's Guide pointer** right after the "Start reading 🎉" install
  step.
- **Trimmed "## See it" from 8 embeds to 4** — `reader`, `word-study`, `journey-detail`,
  `map-desktop` (read → study → explore → map; the two v1.6 flagships signal the feature set has
  grown past v1.5). The other six PNGs are **retained in `docs/screenshots/`** for the guide — only
  the README embeds were dropped.
- **Replaced the stale per-version spec list** (`v1`→`v1.5`, which stopped at v1.5) in "## How it
  works" with an **audience split**: users → the User's Guide; developers → `docs/v1/SPEC.md` + the
  per-feature specs under `docs/`. Can't go stale again. Kept the Concord-relationship sentence and
  the tutorial links.

### Verified
`grep "## Using songbird"` → gone; `grep -E "v1\.[1-5]/.*SPEC"` → gone; "## See it" has exactly 4
embeds, all existing files; the guide link (×2), `docs/v1/SPEC.md`, and `docs/` links all resolve.
Read-back-as-the-reader on the changed prose (pointer reads naturally after launch; "How it works"
still flows). `make check` (241 passed, 4 deselected) + `make check-frontend` (221 passed, build
clean) — unaffected (README + dev-notes only). **Docs epic complete: README + the five-part guide.**

---

## Docs Slice 4 — user guide: Exploring + Comparing + Your data (content complete)

- **Date:** 2026-06-09
- **Branch:** `slice/docs-4-user-guide`

### Why
Fills the last three stubs of `docs/USER-GUIDE.md` (Slices 2–3, PRs #109/#110) — **Exploring places
and journeys**, **Comparing translations**, **Your data** — completing the guide's content. After
this slice **no `(Coming soon.)` stub remains**. README trim is the final slice (Slice 5). Docs-only
— `make check` / `make check-frontend` unaffected.

### What shipped
- **Exploring** — Places gazetteer (`places-gazetteer.png`: search + Status/Type filters, 1,340
  locations) → place detail (`place-detail.png`: Rameses, modern name, verses, and the **"Journeys
  through here"** block bridging into Journeys) → Journeys list (`journeys-list.png`) → journey detail
  (`journey-detail.png`: route map + numbered stops + ordered Stops list). Honors the forward-link
  Slice 3's Study-tools section made to this section.
- **Comparing** — up to three translations in parallel columns, lined up verse for verse, per-column
  notes read-only (`compare.png`).
- **Your data** — short closer; recaps privacy / Export-Import / theme with back-links to Getting
  started, Finding things, Reading (no new screenshots), and a final wrap beat.

### Decisions / accuracy guards (verified against the components + PNGs)
- **Journeys honesty is the section's spine**, mirroring the in-app amber callout
  (`JourneyDetailView.tsx:66–71`): one scholarly **reconstruction**, not a GPS track; uncertain
  crossing/stations shown at low/medium confidence; competing routes & fine dating not modeled; and
  **unlocated stops listed in order but marked "Location unknown" and left off the map, not pinned**
  (`JourneyDetailView.tsx:84–123`). Same honest posture as the earlier conditional features.
- **Compare stated from source** — `MAX_COLUMNS = 3`, read-only annotation overlays scope-filtered
  per column (`CompareView.tsx:13–20`); per-column notes described as behavior, not claimed visible
  in the shot.
- **`## Your data` heading kept** (not renamed to the brief's "& settings") so the existing TOC
  anchor `#your-data` keeps resolving.

### Verified
`grep "Coming soon"` → 0; all 5 newly-referenced images resolve from `docs/`; every internal anchor
referenced (`#study-tools`, `#getting-started-in-the-app`, `#finding-things`, `#reading`) matches a
heading; TOC unchanged. Read-back-as-the-reader + accuracy pass on all three sections. `make check`
(241 passed, 4 deselected) + `make check-frontend` (221 passed, build clean) — unaffected (docs-only).

---

## Docs Slice 3 — user guide: Study tools + Finding things

- **Date:** 2026-06-09
- **Branch:** `slice/docs-3-user-guide`

### Why
Continues `docs/USER-GUIDE.md` (Slice 2, PR #109): fills two of the stubbed sections in place —
**Study tools** (the per-verse panels) and **Finding things** (search + browse + backup) — matching
the established voice and section shape. Exploring / Comparing / Your-data stay as `(Coming soon.)`
stubs (Slice 4); README trim is Slice 5. Docs-only — `make check` / `make check-frontend` unaffected.

### What shipped
- **Study tools** — framed once (hover a verse → a row of faint icons), then each panel shown then
  explained: cross-references (`cross-references.png`), topics + drill-in (`topics-verse.png`,
  `topics-drill.png`), original-language word study + concordance (`word-study.png`,
  `word-study-strongs.png`), and the chapter-top "Places in this chapter" button
  (`geography-panel.png`), which forward-links to the Exploring section.
- **Finding things** — search by meaning vs exact word, across all/chosen translations, plus the
  scope row that also covers your notes + (conditional) study notes (`search.png`,
  `search-keyword.png`); finding your own notes by word or by tag (`notes-search.png`, `browse.png`);
  and Export/Import backup (`browse.png`).

### Decisions / accuracy guards (verified against ReaderView.tsx + the PNGs)
- **Hover-trio glyphs named from the source, not guessed:** ⇄ Cross-references, ※ Topics, ℵ Original
  language (`ReaderView.tsx:793–816`, `opacity-0 group-hover:opacity-100`).
- **"Places in this chapter" is a chapter-level button** next to the chapter title (`openGeo`,
  `ReaderView.tsx:681–689`), *not* a per-verse hover icon — so it's presented separately and the map
  / standalone gazetteer are forward-linked to Exploring rather than duplicated here.
- **`notes-search.png` regrouped honestly:** it's a keyword *Scripture* search with the **Your notes**
  scope ticked (query "worry"), so it illustrates "search can include your own notes," paired with
  `browse.png` for tag-filtering — not presented as a notes-by-tag view.
- **Word study stated as original-language-only** (no implied tap-an-English-word alignment); **study
  notes stated as conditional** (same caveat as the translator's notes in Reading).

### Verified
All 8 newly-referenced images resolve from `docs/`; the forward `#exploring-places-and-journeys` and
back `#reading` anchors match headings; 3 `(Coming soon.)` stubs remain. Read-back-as-the-reader +
accuracy pass on both sections. `make check` (241 passed, 4 deselected) + `make check-frontend` (221
passed, build clean) — unaffected (docs-only).

---

## Docs Slice 2 — user guide: scaffold + Getting started / Reading / Annotating

- **Date:** 2026-06-09
- **Branch:** `slice/docs-2-user-guide`

### Why
With the screenshot set landed (Slice 1, PR #108), the actual guide can start. The README is a
landing page (greet → install → feature list); this slice begins `docs/USER-GUIDE.md`, a single
scrollable page with a table of contents that picks up *after* install and walks the new owner
through using songbird, illustrated with the committed screenshots. Docs-only — no app/test/README
change — so `make check` / `make check-frontend` are unaffected.

### What shipped
- New `docs/USER-GUIDE.md`: H1, a one-paragraph intro that assumes songbird is running + links back
  to the README's "Get it running", and a full table of contents.
- **Three sections written**, each opening with its screenshot then the explanation (show-the-win
  voice rule): **Getting started** (`welcome.png` — account/privacy model, verse of the day, "pick up
  where you left off", recent-notes); **Reading** (`reader.png`, `reader-dark.png`,
  `translator-notes.png` — navigation, switching translations + the anchored-note invariant, section
  headings, the conditional translator's notes, light/dark); **Annotating** (`note-editor.png`,
  `sermon.png`, `sermon-chooser.png` — rich-text notes, tags, sermons + the multi-sermon chooser).
- **Sections 4–8 are TOC stubs** (`## Heading` + *"(Coming soon.)"*) so the structure is whole and
  every TOC link resolves now; Slices 3–4 fill them, Slice 5 trims the README.

### Decisions / accuracy guards
- **Image links are guide-relative** (`screenshots/<file>.png`), not repo-root like the README's
  `docs/screenshots/…` — the guide sits in `docs/`.
- **`welcome.png` is the older reused shot**, so the prose describes only its *content* (cards,
  tally, recent notes), never its top-nav (it predates the Topics/Journeys nav items); navigation is
  introduced from `reader.png` instead.
- **Translator's notes are stated as conditional** — "the standard setup includes none, so most
  readers won't see them" — and met gently ("if you ever see these small numbers…"), never via a
  break-to-test "switch to NET to try it." Every claim was checked against the actual PNG.

### Verified
Image paths resolve from `docs/`, every TOC anchor matches a heading, prose re-checked against each
referenced screenshot, read-back-as-the-reader pass on the three sections. `make check` (241 passed,
4 deselected) + `make check-frontend` (221 passed, build clean) — unaffected (docs-only).

---

## Docs Slice 1 — screenshot capture expansion (the user-guide's dependency)

- **Date:** 2026-06-09
- **Branch:** `slice/docs-1-screenshots`

### Why
The forthcoming user's guide needs a screenshot of every v1.6 feature plus a refresh of two stale
ones. This slice extends the maintainer screenshot tool (`scripts/screenshots/capture.mjs`) to
produce them; the guide prose + README trim are later slices (no `USER-GUIDE.md`/`README.md`/app
change here). The capture script is a maintainer tool outside the gated suites, so `make check` /
`make check-frontend` are unaffected.

### Capture stack (documented in the script header)
The full set requires songbird pointed at a Concord with the **complete data** — every translation
**including NET** (its translator's footnotes drive `translator-notes.png`) and the curated topical
index / journeys / Strong's lexicon. That's the **LAN Concord at `http://192.168.1.62:8000`** (set
songbird's `CONCORD_BASE_URL` to it). Run against a **throwaway songbird** (clean `DATA_DIR`) so the
capture account holds only the script's seeded demo data — no real notes leak into a shot.

### What shipped (script only)
- Header rewritten: the full shot list, the LAN-Concord-with-NET requirement + how to point there,
  the throwaway-account note, and the per-shot data assumptions (named constants up top).
- Seeding extended (idempotent check-then-POST): a **rich-text note** (bold/italics/list, on JHN 1:1)
  for `note-editor.png`; **two sermons on Romans 8:28** so it shows "2 sermons" → the chooser for
  `sermon-chooser.png` (kept off Psalm 23 so the single-sermon `sermon.png` stays single).
- **17 new shots** + **2 refreshed**: `reader` (now WEB so section headings show), `place-detail`
  (now a place on a journey → the "Journeys through here" section); new: `note-editor`,
  `cross-references`, `topics-verse`, `topics-drill`, `topics-browse`, `topic-detail`, `word-study`
  (OT verse, Hebrew RTL asserted via the `dir="rtl"` strip), `word-study-strongs`, `geography-panel`,
  `journeys-list`, `journey-detail`, `compare`, `browse`, `notes-search`, `reader-dark`,
  `translator-notes` (NET), `sermon-chooser`.
- Selectors derived by reading the actual components (the reader's `aria-label` verse triggers, the
  SidePanel `<aside aria-label="Note panel">`, VerseText's `Translator's note N` markers, etc.) —
  not guessed.

### Gotchas / decisions
- **Reader translation is profile-driven, not URL-driven** — `reader.png` (WEB headings) and
  `translator-notes.png` (NET) select the translation via the in-reader dropdown, not a `?translation=`
  param. NET is guarded (skip-with-warning) so a non-LAN run still produces the rest.
- **Dynamic journey discovery** — rather than guess journey/place ids against data this environment
  can't see, the script queries `/api/v1/journeys`, finds one with ≥2 located stops + a note, and
  reuses its id (`journey-detail`) and a stop's `place_id` (`place-detail`). It runs **last** and
  throws on a data gap, so the gap surfaces loudly but every other shot is already saved.
- `reader-dark.png` toggles the theme then **restores light** (the choice persists to the profile, #60).
- `geography-panel.png` is the same in-reader Geography side-panel as the README's `places.png`,
  captured under the guide's filename (the names can be unified later if desired).

### Producing the images (done here, against the LAN Concord)
The LAN Concord (`192.168.1.62:8000`) **was** reachable from the dev environment after all (19
translations incl. NET, 5 journeys, 5319 topics, Hebrew OSHB tokens, 71 NET notes on John 3). So
the images were captured here, not deferred: build the SPA (`npm run build`), point a throwaway
songbird at the LAN Concord (`CONCORD_BASE_URL=http://192.168.1.62:8000`, `DATA_DIR=/tmp/...`,
`FRONTEND_DIST_DIR=…/frontend/dist`, `alembic upgrade head`, then uvicorn — the prod single-unit
serves the SPA + API), and run the capture against it. The throwaway DB + DATA_DIR were wiped
afterward; the LAN Concord was read-only.

The committed set is exactly the **17 new + 2 refreshed** PNGs; the reused-as-is shots
(search/keyword, the map shots, places, places-gazetteer, welcome, sermon) were `git restore`d so
they stay byte-identical to `main`.

### Fixes the live run surfaced (selectors are guesses until a real browser disagrees)
- `reader.png` frames the **chapter top** (WEB John 3's lone heading sits at v1) with the note
  drawer open, instead of scrolling to the noted v16.
- `exact: true` on the verse-number triggers — `"…for verse 1"` substring-matched verses 10–18.
- the sermon-chooser pair moved to **Romans 8:28** (Psalm 23 stays single-sermon for `sermon.png`).
- the in-reader Geography "Euphrates" click is **scoped to the panel** — "Euphrates" also appears in
  the verse text behind the open panel and was intercepting the click.
- discovery picked the **Exodus** journey (15 located stops + a note); `place-detail` landed on
  **Rameses**, one of its stops — so the "Journeys through here" section is populated.

### Verified
- The full batch ran clean end-to-end (no `⚠`); the load-bearing shots were eyeballed —
  `reader` (heading + note), `word-study` (Hebrew **RTL** strip), `journey-detail` (Exodus route +
  numbered markers + note callout), `translator-notes` (NET inline markers), `sermon-chooser`
  ("Sermons · 2"), `compare` (3 columns), `place-detail` ("Journeys through here").
- `make check` — 241 passed, 4 deselected; `make check-frontend` — 221 passed, build clean
  (both unaffected — the script + PNGs are in neither suite).

---

## Slice 2 (v1.6 Journeys) — "Journeys through here" on PlaceDetailView (frontend)

- **Date:** 2026-06-09
- **Branch:** `slice/journeys-2-place-hook`

### Why
The reverse lookup that closes the journeys loop: a **"Journeys through here"** section on
`PlaceDetailView` listing the journeys that pass through a place, each linking to its detail
(`/journeys/:id`). Backend shipped in Slice 1a (`get_place_journeys`); frontend only here.
**Completes the v1.6 fan-out epic** (headings, topical Bible, word study, journeys). Spec:
`docs/v1.6/JOURNEYS-SPEC.md` §4 Slice 2.

### What shipped
- `schemas.ts`: `journeySummariesSchema = z.array(journeySummarySchema)` (reuses 1c's
  `journeySummarySchema`). `lib/reader.ts`: `fetchPlaceJourneys(placeId) -> JourneySummary[]`
  (bare list, the 1a route shape).
- `routes/PlaceDetailView.tsx`: a `journeysQuery` (gated `enabled: placeQuery.isSuccess`, like
  `versesQuery`) and a "Journeys through here" section after the verses section — pending / inline
  error / **a clean "No journeys pass through here." line for the common empty case** / a list
  linking each journey to `/journeys/:id`. Mirrors the verses section exactly.

### Gotcha — the new query needs a default handler
`PlaceDetailView` now fires `/places/{id}/journeys` on every render, so a global MSW default
(`/places/:placeId/journeys` → `[]`) was added beside the place-verses default — otherwise the
*existing* PlaceDetailView tests would hit an unhandled request.

### Tests
- `PlaceDetailView.test.tsx` (extended): a place with journeys lists them + links to
  `/journeys/{id}`; a place with none shows the "none" line (not an error); the error state renders
  inline. Existing place/verses tests stay green.

### Verified
- `make check-frontend` — eslint, tsc, vitest **221 passed (36 files)**, build clean.
- `make check` — unchanged (no backend edits): 241 passed, 4 deselected.

---

## Slice 1c (v1.6 Journeys) — the Journeys list surface (frontend)

- **Date:** 2026-06-09
- **Branch:** `slice/journeys-1c-list`

### Why
The Journeys top-nav surface — a plain paginated list of journeys, each opening the 1b detail at
`/journeys/:id`. The simplest list surface in the epic: `/journeys` takes **no `q`/filter** (only
`limit`/`offset`), so — unlike `TopicsView`/`PlacesView` — there's **no search box and no filter
control**, just pagination. Frontend only; the `PlaceDetailView` hook is Slice 2. Spec:
`docs/v1.6/JOURNEYS-SPEC.md` §4 Slice 1c.

### What shipped
- `schemas.ts`: **added `journeySummarySchema`** (`{id, name, scripture, dating, stop_count}`) —
  1b had deferred it (it added only the stop/detail schemas), so this slice introduces it, not
  reuses it. Plus `journeysPageSchema` (`{journeys, total}` — no limit/offset in the body, matching
  1a). `lib/reader.ts`: `fetchJourneys(limit?, offset?)`.
- `routes/JourneysView.tsx` (new): `useInfiniteQuery` + "Load more" off `total` (mirrors
  `TopicsView`), **minus the search/filter** — rows show name, scripture, dating (when present),
  stop_count, each linking to `/journeys/:id`. Errors surface. `TopNav` gains a Journeys entry near
  Places; `App.tsx` registers `/journeys` → `JourneysView` (beside the existing `/journeys/:id`).
  MSW: a `/journeys` list default.

### Tests
- `JourneysView.test.tsx`: lists journeys (name/scripture/dating/stop_count); "Load more" pages off
  `total` and appends; rows link to `/journeys/{id}` (href asserted); the error state surfaces.

### Verified
- `make check-frontend` — eslint, tsc, vitest **218 passed (36 files)**, build clean.
- `make check` — unchanged (no backend edits): 241 passed, 4 deselected.

---

## Slice 1b (v1.6 Journeys) — the route map + journey detail (frontend)

- **Date:** 2026-06-09
- **Branch:** `slice/journeys-1b-map`

### Why
The journey detail at `/journeys/:id` on Slice 1a's proxy (PR #104) — and the **one genuinely new
capability in the v1.6 epic: drawing an ordered route on the map.** `MapView` clusters a chapter's
markers and draws no polyline, so this is a **new component on the shared base-map plumbing**, not
a MapView variant. Frontend only; the Journeys list + TopNav (1c) and the PlaceDetailView hook (2)
are later slices (`/journeys/:id` is reachable by URL; 1c adds the nav). Spec:
`docs/v1.6/JOURNEYS-SPEC.md` §4 Slice 1b, §7.

### The three honesty requirements (load-bearing — songbird's side of Concord's anti-tar-pit scoping)
1. **The `note` is a prominent callout** — a styled amber box near the map (`role="note"`), not a footnote.
2. **Unlocated stops are listed but never mapped** — the pure geometry filters them out; no guessed pins.
3. **confidence/status are shown** — reuse `PlaceHonesty`'s `StatusBadge` + a "Location unknown" affordance.

### What shipped
- `schemas.ts`: `journeyStopSchema` (coord/confidence/status/name/reference nullable — matches 1a)
  + `journeyDetailSchema`. `lib/reader.ts`: `fetchJourney` (the list/place-journeys fetchers are
  deferred to 1c/2 — only what 1b uses).
- **`lib/map/journey.ts`** (pure, the load-bearing logic; mirrors `places.ts`): `stopsToRoute(stops)`
  → `{ route: [lng,lat][], markers }` — filters unlocated stops from **both**, orders by `ordinal`.
  `lib/map/bounds.ts`: added `boundsForCoords` (the route companion to `boundsForPlaces`).
- **`components/JourneyMap.tsx`** (thin GL glue): reuses MapView's base-map setup (`ensurePmtiles`,
  `buildStyle`, config bounds, basemap-error notice, cleanup); adds a GL **line layer** from the
  route + numbered clickable DOM markers; **no clustering, no place fetch**. A marker → its stop's
  reference (when present) via `onJump`.
- **`routes/JourneyDetailView.tsx`** (clones the PlaceDetailView shape): metadata (dating shown when
  present) + the note callout + `JourneyMap` + the ordered stop list (located **and** unlocated,
  honesty via `StatusBadge`). `App.tsx`: `/journeys/:id` route.

### The jump (Kris's call: resolve-then-navigate)
A `JourneyStop` carries only a human `reference` string, and `/read` takes canonical coords. So the
jump mirrors ReaderView's `resolveMutation`: `resolveReference(reference)` → `navigate("/read?book=
&chapter=&verse=")`. `onJump: (reference: string) => void` is threaded into `JourneyMap` and the
stop list; a failed resolve shows an inline note. No ReaderView change.

### Tests
- `journey.test.ts` (the geometry — the real tests): unlocated filtered from route + markers;
  ordinal ordering (out-of-order input); `[lng,lat]` pairs; all-unlocated → empty.
- `JourneyMap.test.tsx` (FakeMap/FakeMarker harness, no WebGL): route source fed the filtered/ordered
  coords; one marker per located stop; a marker click with a reference → `onJump`.
- `JourneyDetailView.test.tsx`: metadata + **the note callout** + ordered stop list; a reference
  jumps (resolve → navigate, routed Probe); confidence/status render; unlocated stop listed;
  `dating=null`/null-reference tolerated; 404 + inline error.

### Verified
- `make check-frontend` — eslint, tsc, vitest **215 passed (35 files)**, build clean.
- `make check` — unchanged (no backend edits): 241 passed, 4 deselected.

---

## Slice 1a (v1.6 Journeys) — list + detail + place-reverse-lookup proxy (backend)

- **Date:** 2026-06-09
- **Branch:** `slice/journeys-1a-backend`

### Why
The backend data layer for journeys — Concord's curated Scripture routes (Paul's missionary
journeys, the Exodus): an ordered walk of stops, each tied to a passage, with a per-journey
honesty model (per-stop confidence/status, unlocated stops, a one-reconstruction `note`).
Three proxy routes passing Concord's journeys through verbatim (songbird owns none). Pure
songbird — no infra gate (v1.2.0 pin from epic Slice 0). The route map + detail (1b), the list
surface (1c), and the place-detail hook (2) are later slices; `get_place_journeys` lands now
(cheap) for Slice 2. Spec: `docs/v1.6/JOURNEYS-SPEC.md` (committed in this PR — the first
journeys slice carries the spec). Fourth and final feature of the v1.6 fan-out epic.

### Shape — the topics/places proxy, three response shapes
Mirrors `api/topics.py` / `list_topics` / `get_topic`. Routes: `GET /api/v1/journeys`,
`GET /api/v1/journeys/{id}`, `GET /api/v1/places/{id}/journeys`. Bad/unknown id → `404 NOT_FOUND`;
other HTTP → `502`.

### The three response shapes (the slice's conflation risk)
- **`/journeys` (list) → `JourneysPageOut` `{journeys, total}`** — mirrors PlacesPageOut/
  TopicsPageOut; no limit/offset echoed in the body.
- **`/places/{id}/journeys` → bare `list[JourneySummary]`** (reverse lookup, like `/verse-topics`).
- **`/journeys/{id}` (detail)** carries the full ordered `stops` + `source` + `note`.
- **Honesty model passes through verbatim:** `JourneyStop` coord/confidence/status/name/reference
  are nullable — an unlocated stop (null lat/lng) round-trips (it's listed, never mapped); `dating`
  may be null. Both tested.

### What shipped (backend only)
- `concord/client.py`: `list_journeys(limit, offset)` (no filters), `get_journey(id)`,
  `get_place_journeys(place_id)`.
- `concord/schemas.py`: `JourneySummary`, `JourneysResponse`, `JourneyStop`, `JourneyDetail`,
  `PlaceJourneysResponse` (field types verified against Concord's source).
- `api/journeys.py` (new): the three routes, mounted in `main.py`. `api/schemas.py`: API-layer
  `JourneySummary`, `JourneysPageOut`, `JourneyStop`, `JourneyDetail` — **both mirrors kept**.
  `/places/{id}/journeys` lives in the journeys router; `api/geography.py` untouched (the
  3-segment path doesn't shadow the existing `/places*` routes).

### Tests
- `journeys_test.py`: list passthrough + `{journeys, total}` key-set assertion + limit/offset
  passthrough; detail incl. stops/note/source, `dating=null` tolerated, unlocated stop round-trips
  (nulls pass through); reverse-lookup bare list; unknown id → 404; unreachable → 502.
  `FakeConcordClient` gains the three methods.
- Contract: added `/v1/journeys`, `/v1/journeys/{}`, `/v1/places/{}/journeys` (fixture already
  carries all three; version assert unchanged).

### Verified
- `make check` — ruff/format/pyright + pytest: **241 passed, 4 deselected**.
- `make check-frontend` — unchanged (no frontend edits): 203 passed, build clean.

---

## Slice 1b (v1.6 Word study) — Original-language reader panel (frontend)

- **Date:** 2026-06-09
- **Branch:** `slice/word-study-1b-frontend`

### Why
The reader UI on Slice 1a's proxy (PR #102): from any verse, a hover trigger opens an **Original
language** SidePanel — the interlinear strip (Hebrew **RTL**), each tagged word drilling in-panel
to its Strong's definition + concordance, each concordance verse jumping the reader. Frontend
only. Spec: `docs/v1.6/WORD-STUDY-SPEC.md` §4 Slice 1 (frontend), §7. Slice 2 (lexicon search)
deferred.

### Shape — the topics panel, as the fifth SidePanel mode
Mirrors `VerseTopics` (two-level drill-in, inline error) and the `topics` ReaderView mode. The
`ℵ` trigger joins `⇄` (xref) and `※` (topics) on the verse row.

### Three things this slice had to get right
1. **Three level-1 states, not conflated:** inline error (404/502); **"No original-language data
   for this verse."** for a valid-but-untagged 200 (`tokens: []`); the strip. The no-data message
   is NOT an error.
2. **RTL from the `strongs_id` "H" prefix** — `tokens.some(t => t.strongs_id?.startsWith("H"))` →
   `dir="rtl"`, else `dir="ltr"` (not hard-coded by `text_id`). Tested: a Hebrew verse renders
   `dir="rtl"`.
3. **Five-mode clear-everywhere** — `setWords(null)` added to all 9 switchers (`navigate`,
   `openNew`, `openExisting`, `openSermonEdit`, `openXref`, `openTopics`, `openGeo`, `openMap`,
   `closePanel`); `openWords` clears the other four. Count-audited: 9× `setWords(null)`, 9×
   `setTopics(null)`. A ReaderView test guards mutual exclusion (Original language ↔ topics ↔ xref).

### What shipped
- `schemas.ts`: `wordTokenSchema` (strongs_id/morph_code/lemma/transliteration/gloss nullable),
  `verseWordsSchema` (`{reference, text_id, tokens}`), `strongsDetailSchema`; `strongsVerseSchema =
  topicVerseSchema` (reused). `lib/reader.ts`: `fetchVerseWords` / `fetchStrongs` /
  `fetchStrongsVerses`.
- `components/VerseRefList.tsx` (new): the **presentational** verse-row list (`{verses, onJump}`,
  no fetching), now shared. `TopicVerseList` keeps its `{topicId, translation, onJump}` fetch +
  states and delegates its list branch to `VerseRefList` — so `VerseTopics` and `TopicDetailView`
  (2b) are **untouched** and their tests stay green; `WordStudy`'s concordance renders the same
  `VerseRefList`. (Deviation from the literal spec — which said move the fetch into VerseTopics —
  because TopicVerseList has a second 2b caller; keeping it as a thin fetching wrapper shares the
  markup without touching 2b.)
- `components/WordStudy.tsx` (new): the two-level panel (strip → token → Strong's detail +
  concordance), RTL, tagged-vs-untagged tokens.
- `routes/ReaderView.tsx`: the `words` mode — state, `openWords`, the clear-everywhere wiring, the
  `ℵ` trigger, and the three SidePanel touch-points (body passes `translation={translation}`).
  MSW: a `/verse-words` browse-open default.

### Verified
- `make check-frontend` — eslint, tsc, vitest **203 passed (32 files)**, build clean.
- `make check` — unchanged (no backend edits): 232 passed, 4 deselected.

---

## Slice 1a (v1.6 Word study) — verse-words + strongs detail + concordance proxy (backend)

- **Date:** 2026-06-09
- **Branch:** `slice/word-study-1a-backend`

### Why
The backend data layer for original-language word study: a verse's Hebrew/Greek tokens, a
Strong's lexicon entry, and the concordance (every verse a Strong's number occurs in). Three
proxy routes passing Concord's tagged text / lexicon / concordance through verbatim (songbird
owns none). Pure songbird — no infra gate (v1.2.0 pin landed in epic Slice 0). The reader panel
is Slice 1b; the lexicon search (Slice 2) is deferred. Spec: `docs/v1.6/WORD-STUDY-SPEC.md`
(committed in this PR — the first word-study slice carries the feature spec).

### Shape — the topics proxy, with one shape exception
Mirrors `api/topics.py` / `get_topic` / `get_topic_verses`. Routes:
`GET /api/v1/verse-words/{book}/{chapter}/{verse}`, `GET /api/v1/strongs/{id}`,
`GET /api/v1/strongs/{id}/verses`. Bad ref/id → `404 NOT_FOUND`; other HTTP → `502`.

### The shape distinctions (the slice's real risk)
- **`/verse-words` returns a wrapper `{reference, text_id, tokens}`, NOT a bare list** — the
  frontend needs `text_id` to pick text direction (RTL for Hebrew). (Topics returned bare lists;
  word-study can't.)
- **`/strongs/{id}/verses` IS a bare `list[StrongsVerse]`** — the concordance is LTR English, no
  `text_id`; don't over-correct and wrap it.
- **Empty token list = normal 200, NOT a 404.** A valid ref with no tagged original (e.g.
  deuterocanon) passes through as `tokens: []` (still carrying `text_id`); `get_verse_words` does
  not raise on empty. `get_verse_words` sends **no `text` param** — Concord auto-selects
  Hebrew/Greek by testament.

### What shipped (backend only)
- `concord/client.py`: `get_verse_words` / `get_strongs` / `get_strongs_verses`.
- `concord/schemas.py`: `WordTokenOut` (strongs_id/morph_code/lemma/transliteration/gloss all
  nullable), `VerseWordsResponse`, `StrongsDetail`, `StrongsVerse`, `StrongsVersesResponse`.
- `api/strongs.py` (new): the three routes, mounted in `main.py`. `api/schemas.py`: API-layer
  `WordTokenOut`, `VerseWordsOut`, `StrongsDetail`, `StrongsVerse` — **both mirrors kept**.
  `StrongsVerse` is defined separately from the topics `TopicVerse` (mirrors Concord's distinct
  model), not reused.

### Tests
- `strongs_test.py`: verse-words passthrough returns tokens **and `text_id`** (tagged + untagged-
  null tokens); empty-original → `200 tokens:[]` (not 404); bad ref → 404; unreachable → 502.
  strongs detail passthrough; unknown → 404; unreachable → 502. concordance passthrough (with/without
  `translation`); unknown → 404; unreachable → 502. `FakeConcordClient` gains the three methods.
- Contract: added `/v1/verses/{}/words`, `/v1/strongs/{}`, `/v1/strongs/{}/verses` (fixture already
  carries all three; version assert unchanged).

### Verified
- `make check` — ruff/format/pyright + pytest: **232 passed, 4 deselected**.
- `make check-frontend` — unchanged (no frontend edits): 196 passed, build clean.

---

## Slice 2b (v1.6 Topical Bible) — Topics browse surface (frontend)

- **Date:** 2026-06-08
- **Branch:** `slice/topics-2b-frontend`

### Why
The Topics top-nav surface on Slice 2a's data layer (PR #100): a gazetteer of Concord's curated
topical index — search + section filter + pagination → a topic → its verses → jump to read.
Frontend only. Spec: `docs/v1.6/TOPICS-SPEC.md` §4 Slice 2 (frontend), §7 Slice 2b.

### Shape — clone the Places gazetteer (two routes)
Mirrors the places browse pattern exactly: `TopicsView` (`/topics`, `useInfiniteQuery` +
"Load more" off `total`, rows link to the detail) and `TopicDetailView` (`/topics/:id`, header +
verses), wired in `App.tsx` beside the `/places` pair. **Decision (Kris):** the detail is a
**separate `/topics/:id` route** (mirrors `/places/:id`), not inline — so detail URLs are
bookmarkable and `see_also` is a plain `<Link>`.

### What shipped
- `schemas.ts`: `topicsPageSchema` (`{topics, total}`, mirrors `placesPageSchema` — no
  limit/offset in the body) + `topicDetailSchema` (`topicSummarySchema.extend({ verse_count })`).
  `lib/reader.ts`: `fetchTopics(filters)` (modeled on `browsePlaces`) + `fetchTopic(id)`.
- **`TopicVerseList` extracted** (`components/TopicVerseList.tsx`, props `{ topicId, translation,
  onJump }`): the verse query+rows, now shared by `VerseTopics`'s level-2 drill-in (reader panel)
  and `TopicDetailView` (browse). VerseTopics keeps the "← Topics" back button + name heading and
  delegates the list; its existing tests stayed green.
- `TopicsView`: debounced search (`q`) + a **free-text Section input** (Concord exposes no
  section vocabulary, so it's a text filter, not a derived select — the deliberate divergence from
  PlacesView's `type` select); list rows show name + section (no counts — detail-only). Errors
  **surface** (primary content), like PlacesView.
- `TopicDetailView`: header (name, section, verse_count) + `TopicVerseList`; `translation =
  user?.last_translation ?? "KJV"`; a verse jump routes to `/read?...`. **`see_also` is
  first-class:** a redirect topic renders "→ See {target}" linking to `/topics/{target}` instead of
  a verse list. 404 → "That topic doesn't exist."
- `TopNav`: Topics entry between Search and Places. MSW: a `/topics` browse default.

### Tests
- `TopicsView.test.tsx`: rows link to `/topics/{id}`; `q`/`section` reach the request; "Load more"
  pages off `total` and appends; error surfaces (502 → inline message).
- `TopicDetailView.test.tsx`: header + verses; a verse jumps to `/read?...` (location probe); a
  `see_also` topic renders the redirect link and no verse list; 404 → not-found.
- `VerseTopics.test.tsx` unchanged and green after the `TopicVerseList` extraction.

### Verified
- `make check-frontend` — eslint, tsc, vitest **196 passed (31 files)**, build clean.
- `make check` — unchanged (no backend edits): 220 passed, 4 deselected.

---

## Slice 2a (v1.6 Topical Bible) — topics browse data layer (backend)

- **Date:** 2026-06-08
- **Branch:** `slice/topics-2a-backend`

### Why
The data layer for the **Topics browse surface** (Slice 2) — a gazetteer of the curated topical
index (search + section filter + pagination → topic → verses). Two proxy routes on the existing
topics router; songbird owns no topic data. Frontend only — no, the browse UI (TopNav entry +
`TopicsView`) is Slice 2b. Spec: `docs/v1.6/TOPICS-SPEC.md` §4 Slice 2 (backend), §7 Slice 2a.

### Shape — the gazetteer browse (places), not the reverse-lookup sidecar
Mirrors `geography.py`'s `browse_places` / `list_places` / `get_place`: `GET /api/v1/topics`
(list, `TopicsPageOut`) and `GET /api/v1/topics/{topic_id}` (detail, `TopicDetail`). **Errors
SURFACE** (404 bad filter / 502 unreachable) because browse is a screen's primary content, not a
best-effort sidecar.

### Two corrections worth recording
- **`TopicsPageOut` is `{topics, total}`** — mirrors `PlacesPageOut` exactly (no `limit`/`offset`
  echoed), **not** the spec §4 parenthetical's looser `{total, limit, offset, topics}`. The
  frontend tracks limit/offset itself and paginates off `total`. (Reality corrects the spec.)
- **Route is bare `/topics`**, not `/topics/browse` — the `/browse` suffix was a places
  route-collision workaround topics doesn't need. The three `/topics*` routes (`/topics`,
  `/topics/{id}`, `/topics/{id}/verses`) differ in segment count, so none shadows another.

### What shipped (backend only)
- `concord/client.py`: `list_topics(q, section, limit, offset)` (mirrors `list_places`) and
  `get_topic(topic_id)` (mirrors `get_place`); same 400/404 → NotFound, else → Unreachable mapping.
- `concord/schemas.py`: `TopicsResponse` + `TopicDetail` (reuse the Slice 1a `TopicSummary`).
- `api/topics.py`: extended (not a new file) with the two routes. `api/schemas.py`: `TopicsPageOut`
  + an API-layer `TopicDetail(TopicSummary)` adding `verse_count` — **both schema mirrors kept**.

### Tests
- `topics_test.py` (extended): browse passthrough (q/section/limit/offset reach Concord via
  `last_list_topics`; `{topics, total}` shape asserted), empty defaults, bad filter → 404,
  unreachable → 502; detail passthrough (incl. `see_also` + `verse_count`), unknown → 404,
  unreachable → 502. `FakeConcordClient` gains `list_topics` + `get_topic`.
- Contract: added `("GET", "/v1/topics")` and `("GET", "/v1/topics/{}")` (fixture already carries
  both; version assert unchanged).

### Verified
- `make check` — ruff/format/pyright + pytest: **220 passed, 4 deselected**.
- `make check-frontend` — unchanged (no frontend edits), green.

---

## Slice 1b (v1.6 Topical Bible) — verse-topics reader panel (frontend)

- **Date:** 2026-06-08
- **Branch:** `slice/topics-1b-frontend`

### Why
The reader UI on top of Slice 1a's proxy (PR #98): from any verse, a hover trigger opens a
**Topics** SidePanel listing that verse's topics; each topic drills in-panel to its verses;
each verse jumps the reader and closes the panel. Frontend only — no backend/contract change.
Spec: `docs/v1.6/TOPICS-SPEC.md` §4 Slice 1 (frontend), §7 Slice 1b.

### Shape — the `xref` mode, with two deliberate inversions
The whole thing mirrors the cross-references panel: `crossReferenceSchema`/`fetchCrossReferences`
→ topic equivalents; `CrossReferences.tsx` → `VerseTopics.tsx`; the entire `xref` SidePanel mode
→ a `topics` mode. **Two inversions from the headings slice:**
1. **Error is INLINE, not silent.** This panel is user-invoked, so an outage renders the same
   "Couldn't load (is Concord reachable?)." message `CrossReferences` shows — the opposite of the
   passive headings overlay's silence.
2. **`setTopics(null)` in every mode-switcher.** A fourth SidePanel mode is only correct if every
   path that opens/closes another also clears it. Added beside the 7 existing `setXref(null)`
   sites (`navigate`, `openNew`, `openExisting`, `openSermonEdit`, `openGeo`, `openMap`,
   `closePanel`) **plus `openXref`** (which sets xref rather than clearing it) = **8 functions**;
   the new `openTopics` clears the other three modes. A missed one would leave two panels "open".

### What shipped
- `schemas.ts`: `topicSummarySchema` (`see_also` nullable) + `topicVerseSchema` (`text`
  nullable) — nullability matches Slice 1a's `api/schemas.py` so the parse never throws on a null.
  `lib/reader.ts`: `fetchVerseTopics`, `fetchTopicVerses`.
- `components/VerseTopics.tsx` (new): two levels in one panel — the verse's topics (name +
  quiet `section` line), then a chosen topic's verses (back button + jump-able rows). A
  `see_also` topic resolves to its target's verses (`fetchTopicVerses(topic.see_also ?? topic.id)`).
- `routes/ReaderView.tsx`: a `topics` mode mirroring `xref` — `TopicsView` interface + state,
  `openTopics`, the clear-everywhere wiring above, a hover-revealed `※` trigger beside the `⇄`
  button (deliberately not `#`, which reads as the tag system), and the three SidePanel
  touch-points (`open=`, title chain, body). The body passes `translation={translation}` — the
  same source `xref` uses.
- `test/msw/handlers.ts`: default empty handlers for `/verse-topics/...` and `/topics/:id/verses`.

### Tests
- `VerseTopics.test.tsx`: lists topics; drills into a topic's verses; a verse row calls `onJump`;
  "← Topics" returns to the list; `see_also` resolves to the target id; empty state; **the error
  state renders the inline message, not silence**.
- `ReaderView.test.tsx`: the **clear-everywhere guard** — opening Topics closes an open
  cross-references panel and vice-versa, and likewise mutually-exclusive with the places panel
  (asserted via the SidePanel `<h2>` titles).

### Verified
- `make check-frontend` — eslint, tsc, vitest **188 passed (29 files)**, build clean.
- `make check` — unchanged (no backend edits): 213 passed, 4 deselected.

---

## Slice 1a (v1.6 Topical Bible) — verse-topics + topic-verses proxy (backend)

- **Date:** 2026-06-08
- **Branch:** `slice/topics-1a-backend`

### Why
"What does Scripture say about *X*" is the study entry point songbird lacked. Concord v1.2.0
ships a ~5,300-topic curated index; this is the **backend half** of the reader-side reverse
lookup — two proxy routes that pass Concord's topic data through verbatim (songbird owns none).
Pure songbird, **no new infra gate**: the v1.2.0 pin already landed (epic Slice 0, PR #96). The
reader panel is Slice 1b. Spec: `docs/v1.6/TOPICS-SPEC.md` (committed in this PR — the first
topics slice carries the feature spec, as headings did).

### Shape — the cross-references proxy
Mirrors `get_cross_references` / the `read.py` cross-references route exactly. The **songbird
routes take path segments** (`/verse-topics/{book}/{chapter}/{verse}`, `/topics/{id}/verses`);
the **client** builds and quotes the Concord `"{book} {chapter}:{verse}"` ref. A bad/unknown
ref or topic id → `404 NOT_FOUND`; any other HTTP error → `502 CONCORD_UNREACHABLE`.

### What shipped (backend only)
- `concord/client.py`: `get_verse_topics(book, chapter, verse)` (no `include_text` — topics
  carry no text) and `get_topic_verses(topic_id, translation=None, limit=50, offset=0)`
  (`include_text=true` + `translation` when given, so the drill-in can show verse text).
- `concord/schemas.py`: `TopicSummary` (`id, name, section, see_also`), `VerseTopicsResponse`,
  `TopicVerse` (`book, chapter, verse, reference, text`), `TopicVersesResponse`. Field
  nullability matches Concord's source (`see_also`, `text`, `translation` all nullable).
- `api/topics.py` (new): `GET /verse-topics/{book}/{chapter}/{verse}` → `list[TopicSummary]`;
  `GET /topics/{topic_id}/verses?translation=&limit=&offset=` → `list[TopicVerse]`. Mounted in
  `main.py` beside the others. `api/schemas.py`: the API-layer `TopicSummary` + `TopicVerse`
  (the deliberate hand-mirror between the two schema modules is **kept**, not collapsed).

### Tests
- `topics_test.py`: verse-topics passthrough (incl. a `see_also` redirect row defensively);
  empty/default → `200 []`; unknown ref → `404`; unreachable → `502`. topic-verses passthrough
  (with and without `translation`); unknown topic → `404`; unreachable → `502`.
  `FakeConcordClient` gains `get_verse_topics` + `get_topic_verses`.
- Contract: added `("GET", "/v1/verses/{}/topics")` and `("GET", "/v1/topics/{}/verses")` to
  `_REQUIRED_ENDPOINTS` (the v1.2.0 fixture from Slice 0 already carries both paths; version
  assert unchanged).

### Verified
- `make check` — ruff/format/pyright + pytest: **213 passed, 4 deselected**.
- `make check-frontend` — unchanged (no frontend edits this slice), green.

---

## Slice 1 (v1.6) — Section headings in the reader

- **Date:** 2026-06-08
- **Branch:** `slice/1-section-headings` (combined backend+frontend PR)

### Why
Print/study Bibles break a chapter into titled passages ("The Creation", "The Beatitudes").
songbird's reader showed an unbroken run of verses, so passage boundaries were invisible. This
slice renders Concord's section headings inline — block `<h3>` above the verse each anchors —
so a chapter is scannable. Headings are Concord-owned editorial data (now reachable via the
v1.2.0 pin from **Slice 0**, the shared v1.6 epic prerequisite); songbird stores none. Spec:
`docs/v1.6/HEADINGS-SPEC.md` (committed in this PR — it is the feature this slice ships).

### Shape — the notes pass-through, with one deliberate divergence
The whole backend + the fetch layer are a verbatim mirror of translator's notes
(`api/notes.py` / `get_notes` / `fetchNotes`). The **one divergence**: headings show **NO
banner** on error or empty — a heading-less chapter is the normal state for most translations,
so a notice would be noise (notes *do* banner a genuine outage). On error or empty the reader
simply renders no headings.

### What shipped
- **Backend** — `concord/schemas.py`: `SectionHeading` + `HeadingsResponse`. `concord/client.py`:
  `get_headings` (mirrors `get_notes` error mapping: Concord 400/404 → `ConcordNotFoundError`,
  any other HTTP error → `ConcordUnreachableError`; empty-but-known is a normal 200).
  `api/schemas.py`: the API-layer `SectionHeading` (the deliberate hand-mirror between the two
  schema modules is kept, not collapsed). `api/headings.py` (new): `GET
  /headings/{translation}/{book}/{chapter}` → `list[SectionHeading]`, mounted in `main.py`
  beside `notes_router`.
- **Frontend** — `schemas.ts`: `sectionHeadingSchema` + `SectionHeading` type. `lib/reader.ts`:
  `fetchHeadings`. `ReaderView.tsx`: a `headingsQuery` (no `unreachable` flag), a
  `headingsByBeforeVerse` memo (`Map<before_verse, SectionHeading[]>`, each bucket sorted by
  `ordinal`), and the render — inside the verses `.map()`, the `<p>` is wrapped in a
  `<Fragment key={v.verse}>` and the chapter's matching headings render as `<h3>` *before* the
  verse row (above the blue verse-number button + text). A heading whose `before_verse` matches
  no verse is dropped (pure verse-number match, like notes).
- **Style** — `<h3>` is a third visual layer: `mt-6 mb-2 font-sans text-sm font-semibold
  uppercase tracking-wide text-gray-500` — quieter/smaller than the chapter `<h2>` title,
  distinct from the blue verse-number and violet note-marker superscripts.

### Tests
- Backend `headings_test.py` (cloned from `notes_test.py`): ordered pass-through; known-but-empty
  → `200 []`; default-unset → `200 []`; unknown → `404 NOT_FOUND`; unreachable → `502`.
  `FakeConcordClient` gains `get_headings`.
- Contract: added `("GET", "/v1/translations/{}/headings/{}/{}")` to `_REQUIRED_ENDPOINTS` (the
  v1.2.0 fixture from Slice 0 already carries the path; the version assert is unchanged).
- Frontend `ReaderView.test.tsx` + an MSW default handler: a heading renders as an `<h3>` before
  its `before_verse` verse; two before one verse render in `ordinal` order (supplied out of
  order → the memo sorts); a no-headings chapter renders unchanged with no `<h3>` and **no
  banner**; a headings fetch error (502) → verses render, no `<h3>`, **no banner**.

### Verified
- `make check` — ruff/format/pyright + pytest: **204 passed, 4 deselected**.
- `make check-frontend` — eslint, tsc, vitest **180 passed (28 files)**, build clean.

---

## Slice 0 (v1.6) — Concord pin → v1.2.0 (shared epic prerequisite)

- **Date:** 2026-06-08
- **Branch:** `slice/0-concord-pin-v1.2.0`

### Why
The v1.6 fan-out epic — **headings**, **topical Bible**, **word study**, **journeys** (see
`docs/v1.6/HEADINGS-SPEC.md` §2, "The boundary — a shared pin bump") — all consume Concord
v1.2.0 endpoints. Rather than each feature slice repeating the bump, this **Slice 0** does it
once, **infra only, no feature code**. The three feature slices reference this slice rather than
redo it.

### What changed (exactly three, the pattern from the v1.3 Slice 0 pin)
- **`docker-compose.yml`** — Concord image pin `v1.1.0` → **`v1.2.0`**.
- **`backend/tests/fixtures/concord-openapi.json`** — regenerated from Concord's committed
  `docs/openapi.json` at tag `v1.2.0`. The new spec is a **clean superset** of the old: all 15
  prior paths remain; it **adds 12** (`/v1/topics` ×3, `/v1/strongs` ×3, `/v1/journeys` ×3 incl.
  `/v1/places/{id}/journeys`, `/v1/translations/{t}/headings/{book}/{chapter}`,
  `/v1/verses/{ref}/words`, `/v1/verses/{ref}/topics`) plus their schemas. 15 → 27 paths. The
  large diff is expected.
- **`backend/tests/concord_contract_test.py`** — `test_fixture_is_the_pinned_concord_version`
  now asserts `"1.2.0"`. `_REQUIRED_ENDPOINTS` is **untouched** (songbird calls no v1.2.0-only
  endpoint yet; wiring the headings endpoint into the required set is Slice 1).
  `test_endpoints_songbird_calls_exist_in_concord_spec` stays green unchanged because the
  fixture is a superset.

### Deliberately not done
No new `ConcordClient` method, proxy route, schema, or frontend change. This slice is the
prerequisite, not a feature — it stays green on its own. Historical `v1.1.0` prose in this file
and the older `docs/v1.x` specs is left intact (CLAUDE.md: don't rewrite history; only operative
references move).

### Verify
- `make check` — both contract tests pass (version assert is 1.2.0; superset test unchanged).
- `make check-frontend` — green (no frontend change).
- No operative `1.1.0` remains in `docker-compose.yml` or `concord_contract_test.py`; fixture
  `info.version` == `1.2.0`.

---

## Place-name labels (#86) + docs audit pass

- **Date:** 2026-06-08
- **Branches:** `feat/86-place-name-labels` (#88, the feature), then `docs/audit-map-86` (this docs pass).

### Why
A reader had to click every pin to learn what it was (#86). And with the map having moved fast
(#83 filled seas, #86 labels), a full docs sweep was due to catch drift.

### What shipped
- **Feature (#88):** each *unclustered* pin now shows its **place name** beside it — a DOM marker
  (`buildPlaceLabel`, `data-testid="map-place-label"`) seated right of the pin (`anchor:"left",
  offset:[10,0]`), `pointer-events-none` so a tap still hits the GL circle. Synced to the GL points
  exactly like the cluster badges (rebuilt on `moveend`/`data`), so a pin that crowds into a cluster
  drops its name and regains it when the cluster expands — names show only when there's room. The
  single **"Aa"** control now toggles place names together with the curated context labels. No glyph
  font (offline invariant intact, ADR 0003; `style.test.ts` still green).
- **Docs audit (this pass):**
  - **MAP-SPEC** (`docs/v1.1/MAP-SPEC.md`): documented the place-name labels (§7) and the filled
    inland seas/`lakes-fill` (#83, §3), and named both in the Status header.
  - **SPEC §12** (`docs/v1/SPEC.md`): added the missing **light/dark theme** entry (#60, `users.theme`,
    migration `0009`) and added `theme` to the restated data-model line.
  - **ADRs:** marked **0001** and **0002** `Superseded by ADR 0003` (was `Accepted`) with a one-line
    note each — the cross-links existed, the Status field now agrees.
  - **Screenshot harness** (`scripts/screenshots/capture.mjs`): the card-shot path was dead since the
    MapLibre rewrite — `isolatedPin()` waited on `getByTestId("map-pin")`, which no longer exists, so
    the card sub-steps silently skipped. Rebuilt as `isolatedPinPoint()`, which locates a pin from its
    #86 place-name label box (pin center ≈ `box.x - 10, box.y + box.height/2`) and clicks/taps that
    point on the GL canvas. Both `map-*-card.png` shots regenerate again.
  - Regenerated the **map family** of screenshots (`map-desktop`, `map-mobile`, and the two `*-card`)
    so pins now show their names.

### Checked-and-clean (no change needed)
- README is accurate: port, env vars, endpoints, feature list, all embedded images verified; dark
  mode already mentioned; the `[Issues](../../issues)` link is the correct GitHub relative idiom.
- The other map PNGs (`map-globe-disabled`, `places`, etc.) are referenced only here in dev-notes.

### Verified
- Fast suite green (full frontend `vitest` 172 passed, incl. the new label tests + `style.test.ts`).
- Live (`docker compose up --build`, real Concord): harness ran with **no skip warnings**, all four
  map shots regenerated; desktop card selected "Italy", mobile card tapped "Pishon"; names sit beside
  pins, inland seas stay filled, clusters show counts only, pin click still opens the card.

---

## Map rewrite (#76) + docs audit

- **Date:** 2026-06-08
- **Branches:** `fix/76-map-pan-cluster` (#79), `feat/76-tile-assets` (#80), `feat/76-maplibre`
  (#81), then `docs/audit-map-rewrite` (this docs pass).

### Why
Issue #76 feedback: the map could be scrolled off-screen, a numbered (cluster) pin showed nothing
on click and left a stale card, and the map was "still very sparse when zoomed in." Offline is
non-negotiable, but data size was explicitly not a concern.

### What shipped (the map rewrite, three slices)
- **A — interaction fixes (#79):** drag-pan now clamps (was unclamped — the scroll-off bug); a
  cluster click clears any open card and **lists its member places** (each opens that place's card),
  while still zooming to expand.
- **B — offline tiles (#80):** a dev-only `scripts/tilegen/build.py` (rasterio + rio-pmtiles + pyshp;
  manylinux wheels, no system GDAL) builds two committed assets from Natural Earth public-domain
  data, clipped to the biblical-world bbox: `frontend/public/tiles/relief.pmtiles` (~6.7 MB,
  natural-color shaded relief, z0–8) + `bible-physical.geojson` (~760 KB, coast/rivers/lakes/etc.).
  The backend mounts `/tiles` (StaticFiles) so PMTiles is served over HTTP **Range** (`206`).
- **C — MapLibre engine (#81):** `MapView` rewritten on **MapLibre GL** over those local tiles, with
  natural-color relief under crisp vectors. **`maxBounds`** fixes scroll-off natively; **native
  GeoJSON clustering** fixes the cluster-click bug; per-chapter `fitBounds` (capped at z9 so tight
  chapters don't over-zoom into blur). New ADR 0003; removed `lib/{projection,mapTransform,cluster,
  mapBounds,mapLabels}`, the SVG asset, and `scripts/mapgen`.

### Gotchas
- **Offline glyph trap:** MapLibre's `symbol`/`text` layers fetch glyphs from a CDN by default. We
  draw **all text (cluster counts, labels) as DOM markers** and use no `symbol` layers, so there's
  no font dependency — the offline promise holds with no glyph bundling. A `style.test.ts` whitelist
  asserts no glyphs and no modern (road/city/POI/boundary) layers.
- **`.maplibregl-map { position: relative }`** overrides Tailwind `absolute`, collapsing an
  `inset-0` map container to height 0 → the container needs real height (`h-full`), not absolute fill.
- **WebGL doesn't run in happy-dom:** pure modules (`lib/map/*`) are unit-tested; the component test
  mocks `maplibre-gl`/`pmtiles`; **rendering is verified live** (Playwright + software-GL flags).

### The docs audit (this pass — docs only, no behavior change)
- **Screenshots** re-shot against the live MapLibre map: `map-desktop`, `map-desktop-card`,
  `map-mobile`, `map-mobile-card` (Acts 27 — Mediterranean relief, clustered pins, place card).
  `map-globe-disabled` left as-is (reader toolbar; unchanged).
- **`docs/v1.1/MAP-SPEC.md`** — added a "rendering evolved (ADR 0002/0003)" banner and corrected the
  now-false claims (equirectangular / static-image / no-pan-zoom) and dead file references
  (`bible-map.png`, `scripts/mapgen`, `mapBounds.ts`, `project()`); the honesty/affordance/mobile
  design sections were left intact.
- **`docs/SECURITY.md`** created — it was referenced 3× (Dockerfile, `config.py`, `.env.example`) but
  didn't exist; covers `COOKIE_SECURE`/TLS and an exposing-beyond-LAN checklist.
- **`docs/v1/SPEC.md`** — map cross-ref now cites ADR 0002/0003, not just 0001.
- **`README.md`** — added the **dark mode** feature and noted the map now pans/zooms over terrain.

### Verification
- Live: Acts 27 vs John 11 frame to different areas over natural-color relief; drag stays clamped;
  cluster expands + lists members; **zero network requests outside `/api` and `/tiles`** (offline gate).
- Suite green (168 frontend tests; backend Range test). Docs pass: a dead-reference grep
  (`scripts/mapgen | bible-map.(png|svg) | mapBounds.ts | projection.ts | "no pan/zoom"`) hits only
  the historical ADRs 0001/0002 (left as-is by design); `docs/SECURITY.md` now resolves its referrers.

---

## Docs reconcile #3 — surface v1.3–v1.5 features + refreshed screenshots

- **Date:** 2026-06-08
- **Branch:** `docs/reconcile-3`
- **Scope:** docs + screenshot tooling only — **no feature/behavior/Concord change.**

### Why
A third docs pass (after "Docs reconcile #2" below). Four user-visible capabilities had shipped to
`main` and were documented nowhere in the **public** docs (README / SPEC §12): **multi-translation
keyword search** (v1.3), the **study-notes search** section (v1.3), the **places gazetteer** (v1.4:
`/places` + `/places/{id}`), and the **verse of the day** on Welcome (v1.5). The per-slice detail
already lived in this file; the public docs hadn't caught up. (Slice 0 already moved the Concord pin
to `v1.1.0`; this pass only sweeps lingering *prose* version references.)

### What changed
- **`README.md`** — the "Using songbird" tour now makes the **three search types explicit**
  (Scripture / Your notes / Study notes), names the multi-translation keyword scope ("all
  translations or just the ones you pick"), and adds **Explore the places** and **verse of the day**
  bullets. The "See it" gallery gains four shots (below). "How it works (for the curious)" now links
  the v1.3 / v1.4 / v1.5 specs alongside v1 / v1.1 / v1.2.
- **`docs/v1/SPEC.md` §12** — four new entries (multi-translation keyword, study-notes search,
  places gazetteer, verse of the day), each naming the **newly-consumed Concord endpoint**
  (`/v1/search?translations=`, `/v1/notes/search`, `/v1/places` + `/v1/places/{id}`, `/v1/random`)
  and pointing at its spec; the "Specs for shipped features" index and the data-model paragraph
  extended to cover v1.3–v1.5 (still **no new tables** — all proxy Concord).
- **Stale-version prose sweep** — the §12 translator's-notes NET caveat was re-pinned from `v1.0.0`
  to the **stock `v1.1.0`** image (which likewise ships no NET / zero notes); the same stale
  `v1.0.0` comments in `capture.mjs` were corrected. The historical `v1.0.x` reality notes **inside**
  the v1.3/v1.4/v1.5 specs were left intact (deliberate Slice-0 record — CLAUDE.md "reality corrects
  the spec").
- **Screenshots** — re-captured against an **isolated, ephemeral compose project** (`-p sbshots`,
  throwaway volume, stock `concord:v1.1.0`) so seeded shot data never touched real data. New shots:
  `search-keyword.png` (one labeled snippet per translation), `places-gazetteer.png` (the `/places`
  list), `place-detail.png` (Jerusalem — status/type, location honesty, verse jump-links), and
  `welcome.png` (the verse-of-the-day card + recent feed). `capture.mjs` gained four capture
  functions and a header note about the honesty constraint below. **Also fixed in passing:** the
  existing reader/sermon/places/map captures navigated to `/?book=…`, but the reader moved to
  `/read` when the Welcome page landed (#43), so `/` now renders Welcome — those URLs were corrected
  to `/read?book=…` (and all existing shots refreshed against v1.1.0 as a result).

### Gotcha — the Study-notes section can't be screenshotted on the stock image (honesty constraint)
The **stock `concord:v1.1.0` image ships zero notes** (`/v1/notes/search` → `total: 0`), so the
"Study notes" search section is **correctly hidden** by default — it renders **only** when an
operator runs a Concord build that supplies study notes. We deliberately did **not** fake a
screenshot of it; instead the README + SPEC §12 + this note document that it lights up when notes
are present — the **same shape** as the translator's-notes / NET caveat (dormant without NET on the
default stack). Recorded here, not faked.

### Verify
`grep` confirmed the new feature names land in README + SPEC (`study notes`, `places`/`gazetteer`,
`verse of the day`, `all translations`, the three spec paths). `git diff --stat` confirmed the pass
is **docs/tooling-only** — only `README.md`, `docs/**`, and `scripts/screenshots/capture.mjs`; no
`backend/`, no `frontend/src`, no `docker-compose.yml`, **no behavior tests touched**. The four new
shots were eyeballed against their captions; the canonical-coordinate bridge (invariant 4) was not
touched.

---

## #60 — per-profile light/dark mode

- **Date:** 2026-06-08
- **Branch:** `feat/60-dark-mode`
- **Scope:** backend (a profile preference + migration) + frontend (a theme manager, a toggle, and
  a `dark:` sweep across the UI). The first of the recent fixes to touch the backend.

### Backend (mirrors the reading-position pattern exactly)
`User.theme` (`"light" | "dark" | "system"`, nullable) + migration **`0009_user_theme`** (revises
`0008`); `UserResponse.theme`; `UserUpdate.theme: Literal[...]` (so an unknown value → 422 for free);
`update_me` applies it via the existing `model_fields_set` partial-patch (saving theme never
clobbers the reading position). `saveTheme` on the frontend; `auth_test.py` covers persist / 422 /
no-clobber.

### Frontend
- **Theme manager** (`hooks/useTheme.ts`): the resolved appearance = `user.theme` when set, else
  **follow the OS** (`matchMedia('(prefers-color-scheme: dark)')`, re-applied when the OS flips while
  "system"). `useApplyTheme()` (mounted once in `App`) toggles `.dark` on `<html>`;
  `useThemeControl()` powers the toggle in `TopNav` and persists optimistically.
- **No flash:** an inline boot script in `index.html` reads the last choice from `localStorage`
  (kept in sync by the hook) and applies `.dark` before React mounts.
- **The sweep:** a scripted single-pass regex added `dark:` variants to ~315 colour utilities across
  ~27 route/component files (`bg-white`→`dark:bg-gray-800`, `text-gray-900`→`dark:text-gray-100`,
  borders, hovers, blue accents). `darkMode: "class"` was already set in `tailwind.config.ts`.

### Gotchas (caught by a live screenshot pass, then fixed)
The sweep only touches elements that *already* carry a colour class. Two categories didn't and
showed wrong on dark, fixed with **base-layer rules in `index.css`**:
1. **Untinted text** (page headings, stat numbers, plain `font-semibold` spans) inherited the
   default black → set `body { @apply … dark:bg-gray-900 dark:text-gray-100 }`.
2. **Form controls** (search box, the Places status/type selects) fell back to a white field → a
   `.dark input/select/textarea` rule gives them a dark surface (checkboxes/radios excluded).

### Verify
- Backend `pytest` 191 passed (3 new theme tests); Pyright-strict + Ruff clean.
- Frontend `vitest` 162 passed (`TopNav.test.tsx`: the toggle applies `.dark` + PATCHes the theme,
  and reflects a dark profile); `tsc` + lint + `vite build` clean.
- **End-to-end (`docker compose up`):** migration applied (`alembic current` → `0009_user_theme`,
  `theme` column present); PATCH `theme` persists, an invalid value → 422; the anti-flash script is
  in the served HTML. **Visual:** Playwright dark-mode screenshots of Welcome / Reader / Search /
  Places confirm readable headings, dark cards, and dark form controls; the choice **persisted
  across a rebuild + re-login** (it's on the profile).

---

## #62b — shared `TopNav` across pages (closes #62)

- **Date:** 2026-06-08
- **Branch:** `feat/62-shared-topnav`
- **Scope:** frontend — a new shared header, adopted by every content page. Second of two PRs for
  #62 (the search-scope checkboxes were the first); together they close it.

Every view inlined its own header and they'd drifted apart (Search had only Reader/Home; others each
differed; brand was sometimes a link, sometimes plain text). Extracted **`components/TopNav.tsx`** —
the `songbird` home link + the standard nav cluster (Reader / Browse notes / Search / Places /
Compare) + the signed-in user & Log out, with the current page's link emphasized. Props: `maxWidth`
(match the page body), `compareHref` (the reader seeds Compare with the current passage), `actions`
(right-aligned nav-row controls, e.g. Browse's Export/Import), and `children` (a second row — the
reader's and compare's book/chapter/translation + jump/column bars).

Adopted in `WelcomeView`, `SearchView`, `BrowseView`, `PlacesView`, `PlaceDetailView`, `ReaderView`,
`CompareView`. Page titles that lived in the old headers moved into the page body where they still
add context (Places, Browse); the active nav link now signals location elsewhere. `LoginPage`
(pre-auth) is untouched.

**Gotchas:** the nav links now overlap Welcome's quick-link cards and the page sections, so two
view tests had to scope their `getByRole("link", …)` to the relevant region (`"Go to"`, etc.) — the
duplicate link text is expected. Removed now-unused `Link`/`logout` imports from the refactored
context pages.

**Verify:** `vitest` 160 passed (new `TopNav.test.tsx`: brand + cluster + user/logout, active-link
emphasis, seeded `compareHref` + `actions`, signed-out chrome; all view tests green incl. the
restructured Reader/Compare control rows); `tsc` + lint + `vite build` clean.

---

## #62a — search-scope checkboxes

- **Date:** 2026-06-08
- **Branch:** `feat/62-search-scope`
- **Scope:** Search page only (`SearchView.tsx`) — frontend. First of two PRs for #62 (the nav
  standardization is the second).

The Search page ran Scripture + Your notes + Study notes on every query with no control — and on
the stock (notes-less) Concord image the Study-notes section never appears, so the
translator-notes search was undiscoverable ("How to search translator notes?"). Added a **scope
checkbox row** (Scripture / Your notes / Study notes), all on by default. Each query's `enabled`
now ANDs its checkbox; unchecking one stops that search and hides its section. The Scripture-only
controls (semantic/keyword toggle + translation picker) hide when Scripture is unchecked; all-off
shows a "Pick what to search above" hint. In-memory, not persisted (like the translation picker).

**Gotcha:** the Slice-2 test that asserted `queryByText("Study notes")` absent now matches the new
checkbox label — narrowed it to the precise `region "Study notes results"` assertion (the checkbox
text is expected).

**Verify:** `vitest` 156 passed (SearchView 17, +4: each checkbox excludes its search/section, and
all-off shows the hint — asserted via "request never fired" MSW flags); `tsc` + lint + `vite build`
clean.

---

## Fix #55 — disable "Places in this chapter" when a chapter names none

- **Date:** 2026-06-08
- **Branch:** `fix/55-places-disabled-when-empty`
- **Scope:** one-line reader fix — frontend only.

Opening the Places panel on a chapter with no places showed an empty panel. The reader already
disables the adjacent "🌐 Map" button on `!hasMappable` (no *located* places); this mirrors that
for the "Places in this chapter" button on a new `hasPlaces` (no places *at all*, located or not —
the two conditions are distinct: a chapter can name an unlocated place, which keeps the panel
worthwhile but the map disabled). `ReaderView.test.tsx` covers: disabled when the chapter names no
places; **enabled even when the only place is unlocated** (globe disabled, panel still available).

**Verify:** `vitest` 152 passed (ReaderView 33, +2); `tsc` + lint clean.

---

## Slice 4 (v1.5) — Verse of the day

- **Date:** 2026-06-07
- **Branch:** `slice/4-verse-of-the-day`
- **Scope:** a small "verse of the day" card on the Welcome page — one random verse from Concord
  (`/v1/random`), in the reading translation, openable, re-rollable. Over Concord's existing
  endpoint (live since v1.0.0). **No Concord change. Closes the v1.3–v1.5 roadmap** (Slice 0 pin +
  Slices 1–2 features + Slices 3–4 gaps).

### What changed
- **Client** (`concord/client.py`): `random_verse(translation?) → RandomVerse`. **Schemas**: the
  flat `RandomVerse` (`translation, book, chapter, verse, reference, text`) + private wire models —
  Concord's body is **nested** (`{translation, …, verse: {…}}`), so `RandomVerse.parse_concord`
  flattens it. API `RandomVerse` (`api/schemas.py`).
- **API** (`api/search.py`): `GET /api/v1/random-verse?translation=` — **honest** (unreachable →
  502, a Concord 404 → 404; **no swallow**, since a single object has no empty-list to return).
- **Frontend**: extracted Slice 1's reading-translation resolution into a shared
  `hooks/useReadingTranslation.ts` (`user?.last_translation ?? "KJV"`) and refactored `SearchView`
  to use it (no duplication). `fetchRandomVerse`; a "verse of the day" `<section>` on `WelcomeView`
  that **renders only when `randomVerse.data`** (hidden on error/loading — no banner), with "Open"
  (verse-only jump) and "Show another" (refetch). Contract test pins `/v1/random`.

### Clarifications (open-question answers)
1. **Error posture — hide, don't swallow in the backend.** Backend stays honest (502/404); the
   **frontend** absorbs it (card just doesn't render). On a Concord outage the rest of Welcome
   (recent notes, stats, quick links — songbird's own DB) renders fully. *(Reality note: Welcome
   already made one Concord call — `fetchBooks` for book names, which degrade to USFM codes on
   outage — so the card is its second Concord dependency, but the spirit holds.)*
2. **"Show another" + freshness:** `/v1/random` is `no-store`, so a fresh verse every call;
   "Show another" = a React Query refetch; fresh on each mount. **Not daily-pinned** (deferred).
3. **Translation source:** reuse — extracted the shared `useReadingTranslation()` hook rather than
   duplicate Slice 1's resolution.
4. **"Open" = verse-only jump** (`/read?book=&chapter=&verse=`), no translation switch.
5. **Distinct naming:** `random_verse` / `GET /api/v1/random-verse` / `fetchRandomVerse`, flat
   `RandomVerse` schema in all three layers.

### Verify
- Backend `pytest` 188 passed (new `random_verse_test.py` incl. the honest 502/404, a client-level
  test that flattens the nested body, contract pin); Pyright-strict + Ruff clean. Frontend `vitest`
  151 passed (WelcomeView card: renders in the reading translation, "Show another" re-rolls, hidden
  on error with the rest intact; SearchView green through the hook refactor); `tsc` + lint clean.
- **End-to-end (live v1.1.0 — ships real verses):** card path → `/api/v1/random-verse?translation=WEB`
  returns a flat verse in WEB; two calls → different verses (no-store); unknown translation → 404.
  **Hide-on-failure:** with `concord` stopped, `/random-verse` → 502 while `annotations`/`tags`/
  `sermon-notes` still 200 — Welcome renders without the card. Canonical bridge untouched.

---

## Slice 3 (v1.4) — Places gazetteer

- **Date:** 2026-06-07
- **Branch:** `slice/3-places-gazetteer`
- **Scope:** a standalone, browsable/filterable/paginated gazetteer of all ~1,340 places Concord
  knows, plus a deep-linkable detail route. Over Concord's existing `/v1/places` + `/v1/places/{id}`
  (live since v1.0.0). **No Concord change.** The per-chapter map is untouched.

### What changed
- **Client** (`concord/client.py`): `list_places(type?, status?, q?, limit, offset) → PlacesPage`,
  `get_place(id) → PlaceDetail`, `list_place_types() → list[str]`. `get_places`/`get_place_verses`
  untouched. **Schemas**: `PlaceDetail` (summary + url_slug/preceding_article/modern_name/
  verse_count), `PlacesPage` (places + total).
- **API** (`geography.py`): `GET /api/v1/places/browse`, `GET /api/v1/places/{id}`,
  `GET /api/v1/place-types`. Errors **surface** (unreachable → 502, bad filter / unknown id → 404)
  — NOT best-effort (the opposite of Slice 2's Study notes).
- **Frontend**: `browsePlaces`/`fetchPlace`/`fetchPlaceTypes`; new routes `/places` (list, filters,
  `useInfiniteQuery` "Load more") and `/places/:id` (detail + verses). Extracted the honesty
  presentation (`STATUS_BADGE` + the location renderer) from `Geography.tsx` into a shared
  `components/PlaceHonesty.tsx` (`StatusBadge`, `PlaceLocation`) — reused verbatim, never
  reinvented. WelcomeView quick-link + a "Places" nav entry. Contract test pins `/v1/places` and
  `/v1/places/{}`.

### Clarifications (open-question answers)
1. **No collision with the chapter map.** `fetchPlaces`/`get_places` left untouched; gazetteer adds
   distinctly-named `browsePlaces`/`fetchPlace` + `list_places`/`get_place`. **Route gotcha:**
   `GET /api/v1/places` is *already* the chapter-map endpoint (it takes `book`+`chapter`), so browse
   could **not** live there — it went to **`/api/v1/places/browse`** (declared before `/places/{id}`
   so "browse" isn't read as an id). Verified live that both coexist.
2. **`type` vocabulary never hardcoded.** `status` uses its fixed enum; `type` options come from
   Concord's unknown-type-error `available` list (`list_place_types` sends a sentinel type, reads
   `error.detail.available`). The live probe confirmed **36 types** returned cleanly, so the type
   dropdown ships. Graceful `[]` fallback hides the dropdown if Concord ever stops surfacing it.
3. **Detail is a real route** `/places/:id` (not a modal); "Open in reader" = verse-only jump (no
   translation switch, like Slice 2). "View on map" deferred.
4. **Errors surface** (primary content): visible "Couldn't load places" on outage, not-found on a
   detail 404, plain "No places match" empty state on zero results. Deliberately the opposite of
   Slice 2's best-effort swallow.
5. **Paginated** (`useInfiniteQuery`, 50/page, "Load more"); honesty model per row via the shared
   `PlaceHonesty` presentation.
6. **Discoverability**: WelcomeView quick-link + a Reader-header "Places" nav entry.

### Verify
- Backend `pytest` 182 passed (new `places_test.py` + client-level tests + contract additions);
  Pyright-strict + Ruff clean. Frontend `vitest` 148 passed (new PlacesView + PlaceDetailView);
  `tsc` + lint clean. Geography's 36 existing tests still green after the honesty extraction.
- **End-to-end (live v1.1.0 — ships real places, so the happy path IS verifiable):** browse
  `total: 1340`; `status=symbolic` → 3, `q=jerusalem` → Jerusalem; offset paging works;
  `place-types` → 36; detail (Jerusalem, modern name, `verse_count` 955) + 200 verses; unknown id →
  404; and the **chapter-map `/api/v1/places?book=&chapter=` still 200** (collision-free). Canonical
  bridge untouched.

---

## Slice 2 (v1.3) — Notes ("Study notes") keyword search

- **Date:** 2026-06-07
- **Branch:** `slice/2-study-notes-search`
- **Scope:** a third Search-page section, **"Study notes"**, keyword-searching Concord's
  translator's/study notes via `/v1/notes/search` (v1.1.0). Pure songbird; no Concord change.
  Distinct from "Scripture" (Concord verse text) and "Your notes" (the user's own annotations).

### What changed
- **Client** (`concord/client.py`): `search_notes(q, limit=20)` → `/v1/notes/search` (q-only;
  filters deferred), reusing `_SEARCH_TIMEOUT` and the same error mapping as keyword search.
- **Schemas**: Concord `NoteSearchHit`/`NoteSearchResponse`; API `StudyNoteResult`
  (book, chapter, verse, reference, translation, type, snippet); frontend `studyNoteResultSchema`.
- **API** (`api/search.py`): `GET /api/v1/study-notes-search?q=` — **best-effort**: swallows BOTH
  `ConcordNotFoundError` and `ConcordUnreachableError` to `[]` (deliberate divergence from the
  Scripture endpoints, which surface a 502 — the Scripture section stays the page's Concord-health
  signal, so a redundant error here would be noise).
- **Frontend**: `searchStudyNotes(q)`; a "Study notes" `<section>` after "Your notes" that
  **renders only on ≥1 hit** (its own query key `["study-notes-search", query]`, independent of the
  Scripture mode/picker); snippets via the existing `markSegments`. Extracted the reader's note
  type→label map to `lib/notes.ts` as `NOTE_TYPE_LABELS` (one home; `NotePopover` now imports it).

### Clarifications (open-question answers)
1. **Section header = "Study notes"** (not the reader's "Translator's notes" umbrella): matches
   spec §2 / the endpoint name, and avoids a redundant `tn`→"Translator's note" badge under a
   same-named header. Per-type badges reuse the reader's exact labels; **unknown/null type → a
   neutral "Note" badge** (never a raw code, never a crash).
2. **"Open in reader" jumps to the verse only** (book/chapter/verse) — no auto-switch to the note's
   translation (the snippet already shows the text; cross-translation marker deep-linking deferred).
3. **Independent section** — fires on any query like "Your notes", with its own query key (distinct
   from the annotations `["note-search", …]`); endpoint named `study-notes-search` to avoid
   colliding with the user's-own-notes search (`/annotations?q=`).
4. Labels as in (1).

### Verification reality (drove the test strategy)
The **stock v1.1.0 image ships zero notes** (`/v1/notes/search` → `total: 0`), so the hit-rendering
path **can't** be exercised end-to-end against it. So: the **happy path is verified by tests**
(`FakeConcordClient` hits + an MSW fixture — type badge, `<mark>` highlight, verse jump, the "Note"
fallback); the **live stack verifies only graceful absence** — the section is hidden, no error,
Scripture + Your notes unaffected. We do **not** chase real hits against a notes-less Concord.

### Verify
- Backend `pytest` 170 passed (new `notes_search_test.py` incl. both best-effort swallow cases, a
  client-level `search_notes` test, and the contract test now pinning `/v1/notes/search`);
  Pyright-strict + Ruff clean. Frontend `vitest` 138 passed (4 new SearchView cases:
  hidden-on-empty, shown-with-hits, "Note" fallback, best-effort-on-error); `tsc` + lint clean.
- End-to-end (`docker compose up`, v1.1.0 stock): `GET /api/v1/study-notes-search?q=love` → `200
  []` → section absent; `keyword-search` + `annotations?q=` still 200. Canonical bridge untouched.

---

## Slice 1 (v1.3) — Multi-translation keyword search

- **Date:** 2026-06-07
- **Branch:** `slice/1-multi-translation-search`
- **Scope:** keyword Scripture search now searches **all loaded translations** by default,
  narrowable to a subset, rendering each verse's matching translations as labeled, highlighted
  snippets. Builds on the Concord **v1.1.0** pin (Slice 0). No Concord change.

### What changed
- **Client** (`concord/client.py`): `keyword_search(q, translations: list[str] | None, …)` —
  `None` → `translations=*` (all), a list → CSV. Dropped the singular `translation` param.
- **Schemas**: Concord `KeywordResult.matches: dict[str,str] | None` + `KeywordSearchResponse
  .translations`; the API `KeywordResult` gains `matches` (pass-through). Frontend
  `keywordResultSchema.matches` (`z.record(z.string()).nullable().optional()`).
- **API** (`api/search.py`): `/keyword-search?translations=` CSV (absent → all); returns `matches`.
- **Frontend** (`SearchView.tsx`): removed the hardcoded `SEARCH_TRANSLATION = "KJV"`; added an
  in-memory translation **scope picker** (keyword mode only); multi-match hits render one labeled,
  `<mark>`-highlighted snippet per matched translation via `markSegments`.
- **Contract** (`concord_contract_test.py`): new assertion that `/v1/search` exposes the
  `translations` param.

### Kris's three clarifications (the binding decisions)
1. The picker **defaults to All and does not persist** — in-memory React state, resets on reload.
2. **Semantic search's display translation moved hardcoded-KJV → the profile's reading
   translation** (`user.last_translation`, fallback `KJV`). An **intended behavior change**, tested.
3. A multi-match hit renders **all matched translations, reading-translation first** (else
   Concord's order, which leads with the top-ranked); the rest compact; **no collapse this cut**.
   A single match (or single-translation narrowing) renders just the snippet, as before.

### Live shape (verified against v1.1.0 before building)
`/v1/search?translations=*` returns each hit with a flat top-ranked `snippet`, a `matches` map
(id → snippet) containing **only** the translations that matched, **rank-ordered** (flat `snippet`
== `matches[firstKey]` for every hit), plus a `translations` echo. So the render rule is simply:
keep `matches` order, hoist the reading translation.

### Gotcha — single-translation narrowing was 502ing (Concord latency, not a songbird bug)
End-to-end, narrowing to a **single** common translation (`translations=KJV`/`WEB`) returned
**502**, while `*` and `KJV,WEB` were fine. Cause: Concord's single-translation keyword search is
**slow cold** — measured `KJV` ~6.5s, `WEB` ~8.2s, `ASV` ~2.2s (`*` and multi-CSV were ~4ms,
cached). songbird's `ConcordClient` 5s timeout turned the slow read into an `httpx.ReadTimeout`
(empty message) → misreported as `ConcordUnreachableError` → 502. **Fix:** keyword search now uses
`httpx.Timeout(30.0, connect=5.0)` — a generous **read** budget so a *slow* search isn't a false
*outage*, with **connect** kept tight so a genuinely-down Concord still fails fast (invariant 3).
**Flag for Concord:** single-translation `/v1/search` taking 6–8s is worth optimizing upstream;
songbird now tolerates it but the UX waits.

### Verify
- Backend `pytest` 164 passed (new client/endpoint/contract tests incl. the read-timeout guard);
  Pyright-strict + Ruff clean. Frontend `vitest` 134 passed (4 new SearchView tests); `tsc` strict
  + lint clean. Canonical bridge untouched.
- End-to-end (`docker compose up`, v1.1.0): keyword "living water" with no narrowing → hits with
  multiple labeled snippets; single-translation narrowing → 200 (KJV 6.5s, WEB 8.2s) not 502;
  semantic search displays in the profile's reading translation.

---

## Slice 0 (v1.3) — Concord pin → v1.1.0 (the v5 prerequisite)

- **Date:** 2026-06-07
- **Branch:** `slice/0-concord-pin`
- **Scope:** the version-bump prerequisite for the v1.3–v1.5 catch-up. Config + fixture + a small
  reader-notice correction. **No songbird feature/endpoint added** (those are Slices 1–4).

### Why
The runtime was pinned to `concord:v1.0.0`, which predates the endpoints the catch-up needs
(`/v1/search?translations=`, `/v1/notes/search`) and the v4 notes-passage read. This slice moves
the pin to the published v5 image so the later slices can build on it.

### The gate caught a real mismatch (and changed the target version)
The spec called this a bump to **v1.0.2**. The mandatory first step — pull the image and curl the
three endpoints — found the **published `v1.0.2` predated v5**: `/v1/notes/search` → `404`, and
`/v1/search` **ignored** `?translations=` (echoed single-translation KJV, no `matches`). I stopped
and surfaced it; Kris cut and published v5 as a **new release, `v1.1.0`**. Re-running the gate
against `v1.1.0` (`sha256:d10ed68a…`) passed:
- `/v1/search?q=love&translations=*` → `200`, response carries `translations: [13 ids]`, each hit
  has `matches: {translation_id: "<mark>…"}`.
- `/v1/notes/search?q=love` → `200` empty `hits` (the stock image ships zero notes — success).
- `/v1/translations/KJV/notes/JHN/3` → `200` empty.

A second correction the gate forced: the **committed `concord-openapi.json` fixture was also
pre-v5** (no `/v1/notes/search`, `/v1/search` had only the singular `translation` param), despite
its `1.0.2` version string. So "no fixture change needed" was wrong — the fixture was regenerated.

### What changed
- `docker-compose.yml`: `concord` image `v1.0.0` → **`v1.1.0`**.
- `backend/tests/fixtures/concord-openapi.json`: **regenerated** from the v1.1.0 image's
  `/openapi.json` (now 15 paths incl. `/v1/notes/search`; `/v1/search` gains the `translations`
  param). Serialized to match the existing style (`json.dumps(obj, indent=2, sort_keys=True)`).
- `backend/tests/concord_contract_test.py`: `assert version == "1.0.2"` → `"1.1.0"`.
- `.github/workflows/nightly-concord.yml`: pinned image `v1.0.2` → `v1.1.0`.
- **Reader notes notice** (`ReaderView.tsx`): the "Translator's notes unavailable (is Concord
  reachable?)" notice now fires **only on a genuine outage** (`CONCORD_UNREACHABLE` / network),
  not on a `404`. A `404` now means genuinely-not-found (markers simply absent). Pre-v1.1.0 the
  notes route `404`'d on every translation, so this notice fired on every chapter — the bump makes
  a `404` honest, and this guard keeps the message correct. New `ReaderView.test.tsx` cases cover
  502 → notice, 404 → no notice, empty-200 → no notice. **This resolves the "Gotcha carried
  forward" from the Docs reconcile #2 entry below** (the dormant-translator's-notes misleading
  notice).
- Docs: corrected the `v1.0.2` → `v1.1.0` references across the v1.3/v1.4/v1.5 specs and added a
  reality note in SEARCH-EXPANSION §Slice 0 (per CLAUDE.md "reality corrects the spec").

### Verify
- Image gate above (curls recorded). Backend `pytest` + Pyright-strict + Ruff clean; the contract
  test now pins `1.1.0` against the regenerated fixture. Frontend `vitest` (new reader-notice
  cases) + `tsc` strict + lint clean. `docker compose up` → both services healthy, `GET /healthz`
  reports Concord reachable (13 translations). In the reader against v1.1.0, the translator's-notes
  path no longer `404`s and shows no misleading notice on the stock no-notes image.

---

## Docs reconcile #2 — newest features + SPEC §12 / CLAUDE.md / housekeeping

- **Date:** 2026-06-07
- **Branch:** `slice/docs-reconcile-features`
- **Scope:** docs only — **no feature/behavior/Concord change.**

### Why
A second docs-audit pass (the first overlapped with the `docs/audit-...` work below and was
reconciled against it on merge). Two gaps remained after that work landed:
1. The founding spec (`docs/v1/SPEC.md`) had never been reconciled — it still read as pre-auth,
   pre-sermon-notes, with §9/§11 unresolved.
2. A run of features shipped to `main` *after* the first audit and were documented nowhere:
   **last reading position** (#38), **side-by-side compare** (#40), **export/import** (#41),
   **welcome/home page** (#43), and **keyword Scripture search** (#46, #49, #51).

### What changed
- **`docs/v1/SPEC.md`** — added a status banner; marked §9 roadmap complete; resolved §11's five
  open questions with the answers reality chose; added **§12 "Implemented since v1"** — now
  covering auth, reading position (`last_book`/`last_chapter`, migration 0008), sermon notes,
  translator's notes, **keyword search**, **compare**, **export/import**, the **welcome page**,
  the contract test, the spec pointers, and a restated data model (eight migrations, no new tables
  for the latest features). Inline auth-as-future language in §2/§5 corrected.
- **`README.md`** — "Using songbird" now also covers the keyword/semantic search toggle,
  side-by-side **Compare**, **export/import** ("back up your notes"), and reopening to the last
  reading position; the onboarding step notes the new home page. (Kept the `docs/audit-...`
  Concord-prominence + sermon content from `main`.)
- **`CLAUDE.md`** — "Out of scope: Mobile" reworded to "a native mobile app" (responsive web is in
  scope, matching the mobile fix #29 + the mobile-first map modal); committed the documentation
  charter; trimmed stray blank lines.
- **`.gitignore`** — ignore `seed-trimmed.json` / `seed-*.json` (local sermon-seed input).

### Gotcha carried forward (not fixed here)
Translator's notes are **dormant without NET** in Concord v1.0.0 — the endpoint 404s on all 13
shipped translations and the reader shows a misleading "unavailable (is Concord reachable?)"
notice. Recorded in SPEC §12 as a known caveat / open work, same finding as the `docs/audit-...`
entry below. Softening the notice is a code change, deferred.

### Verify
`grep` confirmed the new feature names land in README + SPEC; `git diff --stat` confirmed the pass
is docs-only; no tests touched.

---

## Documentation audit — Concord prominence, sermon-notes docs, refreshed screenshots

- **Date:** 2026-06-07
- **Branch:** `docs/audit-concord-screenshots-sermon-notes`
- **Scope:** docs + screenshot tooling only — **no feature/behavior/Concord change.**

### Why
A doc audit found the public docs had fallen behind the code: the README screenshots predated the
sermon-notes / translator's-notes work, sermon notes were undocumented for users and had no spec,
and the "built on Concord" relationship + repo link were buried at the bottom of the README.

### What changed
- **Concord, surfaced:** the README intro now states songbird is built on
  **[Concord](https://github.com/kbennett2000/concord)** with the repo link up top (kept the
  "How it works" explanation too); the link was also added to `docs/v1/SPEC.md` and
  `docs/v1.1/MAP-SPEC.md` openings.
- **Sermon notes, documented:** new **`docs/v1.2/SERMON-NOTES-SPEC.md`** (mirrors the map spec),
  a sermon entry in the README "See it" gallery + "Using songbird" tour.
- **Screenshots refreshed:** re-captured against a live stack; `capture.mjs` now seeds a sermon
  note (Psalm 23) and captures a new **`sermon.png`** (the ▶ marker + popover). Capture ran against
  an **isolated, ephemeral compose project** (`-p sbshots`, throwaway volume) so the seeded shot
  data never touched real data.

### Gotcha — translator's notes are dormant in the default stack (finding)
Translator's notes come from **NET**, but Concord **v1.0.0 ships 13 public-domain translations and
no NET**. So `/api/v1/notes/{translation}/...` 404s for every available translation, and the reader
shows a red **"Translator's notes unavailable (is Concord reachable?)"** on every chapter — copy
that wrongly implies a connectivity problem. The sermon screenshot is framed (NET unavailable, so
the notice is clipped out) to avoid showcasing it. **Not fixed here** (code/Concord change): either
ship NET in Concord, or soften the notice so "this translation has no notes" ≠ "Concord is down".

---

## Slices 11–15 + fixes #19/#20/#24 — catch-up log (landed after v1.1.0, logged late)

These shipped to `main` between v1.1.0 and this audit but weren't logged at the time; recorded here
for the record (each was its own reviewed PR with tests).

- **Slice 11 — translator's notes (PR #17):** proxy Concord's NET tn/sn/tc/map footnotes
  (`84dc83f`) and render them as inline violet superscript markers with a popover (`6ccd2b3`).
  Followed by **fix #18** — keep the note popover open while scrolling its own content (`e42476b`).
  (See the gotcha above: dormant without NET in Concord.)
- **Slice 12 — sermon notes (PR #21):** the model, migration, and chapter overlay (`a667691`) +
  the reader ▶ marker and popover (`a037b51`). Canonical anchor, always shown in every translation.
- **Slice 13 — sermon count (PR #22):** count badge + stacked, newest-first popover when a verse
  carries multiple sermons (`09f0dd6`).
- **Slice 14 — seed sermon notes (PR #23):** a pure, copyright-free import transform + one-time
  loader from a soap-journal backup (`4d57551`); multi-sermon popover sorted newest-first (`7f13a0b`).
- **Slice 15 — sermon-note CRUD (PR #26):** full create/update/delete over the API (`290cb3a`) and
  from the reader (`cd69ec3`); the anchor is immutable on edit.
- **Fix #24 — browse sermon notes (PR #27):** tag-filter the sermon-note list endpoint (`3607b1e`)
  and surface sermon notes in the Browse view (`3cf5721`), sharing the annotation tag vocabulary.
- **Fix #20 — default translation (PR #28):** per-profile `last_translation` + `PATCH /auth/me`
  (`d11bea3`); the reader opens to the profile's last-read translation (`d69d238`).
- **Fix #19 — mobile horizontal scroll (PR #29):** stop the reader scrolling sideways on mobile
  (`d4971de`).

Sermon notes are specified in **`docs/v1.2/SERMON-NOTES-SPEC.md`**.

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
