# songbird — dev notes

A running log of per-slice decisions, gotchas, and how each slice was verified. Newest first.

---

## Release prep v1.8.0 — versions, CHANGELOG, README and guide, and a clean-checkout gate

- **Date:** 2026-10-02
- **Branch:** `slice/release-1.8.0-prep`

### Why

v1.8 (study Bibles) is complete: slices A–E, follow-ups 1–6 and the fixes, with the Concord pin at
v1.3.0 since slice E. The versions still read `1.7.0` and everything since sat under
`[Unreleased]`. This is Stop 1 of the two-stop release, done as 1.7.0's was. The tag and the GitHub
release are Stop 2, after this merges and only on Kris's say.

### The version: seven sites now, not four

- **The four known:** `backend/pyproject.toml`, `backend/songbird/__init__.py` (served on
  `/healthz`, OpenAPI and the Status page), `frontend/package.json`, and the `/healthz` mock in
  `frontend/src/test/msw/handlers.ts`.
- **`frontend/src/routes/StatusView.test.tsx:23`:** a second `/healthz` mock, added in `2888ff6`
  before the 1.7.0 bump. It already said 1.7.0 then, so that release's `grep 1.6.0` couldn't see
  it. No test asserts it.
- **`frontend/package-lock.json` lines 3 and 9:** songbird's own root entry. It stayed at 0.1.0
  through 1.6.0 and 1.7.0 until slice A1's `npm install` synced it, so skipping it now would bring
  the drift back. Edited by hand; nothing else in the lock moved.

Afterwards `git grep 1.7.0` outside CHANGELOG and dev-notes finds only two dependencies in the lock
(`es-module-lexer`, `esquery`).

### What changed for readers

- **CHANGELOG:**
  - `[Unreleased]` became `[1.8.0] — 2026-10-02`, with a fresh empty `[Unreleased]` and a link
    reference.
  - It opens by saying the study-Bible features need a study Bible in your own Concord (1.3.0 or
    later), that the one included has none, and that songbird keeps no copy of any of it (said
    once, not in every entry).
  - **Fixes to things no 1.7.0 user saw** were folded into their features or cut. Headings and
    wrapped poetry joined the notes entry. Multiplying markers, brackets alone on a line and
    Escape on the About page came and went within v1.8.
  - The Status crash stayed: its Reader → Status direction is older than v1.8. So did the gap
    between markers (NET's ran together too) and the note box's placement (every popover).
  - The letter row joined the Verse Finder's entry.
- **README:**
  - It never mentioned study Bibles. A paragraph in "How it works" now says what one you own adds,
    that the included engine has none, and points to Concord's "Your own study Bible".
  - Its three mentions of **Status** say it's on **Settings** now.
  - "See it" stays as it is: its screenshots couldn't show a study Bible's pages, which are book
    text.
- **User's Guide:**
  - It now says plainly where its study-Bible paragraphs begin: the standard setup has no study
    Bible, so they don't apply until you load one.
  - The reading plan's paragraphs sit together, ahead of the letter row.
  - Every topic names its index. With Concord 1.3.0 even the standard setup sends `source`, so a
    topic's page and the ※ panel name *Nave's Topical Bible* (seen in the gate).

### The release gate: a clean checkout, as a new user would

Run on this machine, not on Kris's server.
1. **A fresh clone of this branch, with no `.env`,** in `/home/kb/songbird-release-gate/songbird-gate`.
   The folder name keeps its compose project (`songbird-gate`) off this machine's own
   `songbird_songbird-data`.
2. **The README's own command,** `docker compose --profile bundled-concord up`. No songbird
   variable was set in the shell. `/healthz` reported version 1.8.0, with the bundled Concord
   (`concord:v1.3.0`, healthy) reachable at `http://concord:8000` and its 15 translations.
3. **Headless Chromium at 1280×800 and 390×844.** A new visitor lands on sign-in. The first account
   was created as the README says, then the run signed in on the second width. On both:
   - **The reader (KJV John 3):** the text is there, with no note marker, no **Notes ▾**, no
     **Introduction** or **About** button, and no "notes unavailable" notice. The ※ panel on
     verse 16 names Nave's.
   - **Settings:** "None of the Bibles in this Concord has notes.", and no *About these Bibles*.
     **Status** shows "version 1.8.0".
   - **Topics:** no **From:** row, and the rows are unlabelled. A topic's page names Nave's.
   - **Search:** "shepherd" finds verses. In Keyword mode, with Study notes ticked, the only
     sections are Scripture and Your notes.
   - **Every page:** no "EMB", "Every Man", "Verse Finder" or "Tyndale" anywhere in its text, no
     sideways scroll, and no page errors.
   - **songbird's own log:** no request for a translation's documents or assets. The only
     `/assets/` requests are its own page files.
4. **Removed:** `docker compose --profile bundled-concord down -v` in the clone (its containers,
   network and volume), `docker rmi songbird-gate-songbird`, and the clone folder.

### Gotchas

- **Docker here is a snap,** with its own private `/tmp`. A clone under the session's `/tmp`
  scratch folder gave "no configuration file provided: not found". It has to sit in an ordinary,
  non-hidden folder in the home directory.
- **The Search page opens in Semantic mode,** where study notes never show. A check that they stay
  quiet must switch to Keyword first.
- **`grep /assets` on songbird's log matches its own page files.** Match
  `translations/<code>/assets` instead.

### The slice before this, on the server

Nothing to deploy: slice E (PR #156) changed only pins, tests and docs. PR #155 (the letter row) is
live on Kris's server (`c3ec2cb`, `index-CZ7W7FE6.js`; see slice E's entry). After slice E merged,
the nightly workflow was run once by hand on `main`. It pulled `concord:v1.3.0` and passed all 7
live tests.

### Verified

- `make check` and `make check-frontend` green (counts in the PR).
- The `[1.8.0]` block, the README paragraph and the guide's changes were each read top to bottom as
  their audience.

---

## v1.8 slice E — Concord pin → v1.3.0

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-concord-v1.3.0`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §1, §2 (the slice E row), §4–§7 ("An older Concord"),
  §8 (the pin rule) and §9 (slice E's acceptance, new); `docs/v1/SPEC.md` §12, translator's notes.

### Why

Concord v1.3.0, its v8 release, is published: tag `v1.3.0` and
`ghcr.io/kbennett2000/concord:v1.3.0`. Every v1.8 slice was built against Kris's own Concord, with
the pin left at v1.2.0 and the new fields covered only by songbird's own tests (§8's rule). This
moves every pin and lets the contract test check what v1.8 reads. The template is "Slice 0 (v1.6)
— Concord pin → v1.2.0", plus the pin that slice missed.

### What changed

- **`docker-compose.yml`:** the bundled engine `v1.2.0` → **`v1.3.0`**.
- **`.github/workflows/nightly-concord.yml`:** `v1.1.0` → **`v1.3.0`**. It was never moved to
  v1.2.0: the v1.6 Slice 0 entry lists exactly three changes and this wasn't one. The comment
  promising that "Slice 2 unifies this" (it never did) now says the contract test checks it.
- **`backend/tests/fixtures/concord-openapi.json`:** byte for byte Concord's `docs/openapi.json` at
  tag `v1.3.0` (sha256 `fc57707a…`, the same from the local checkout and from GitHub). A clean
  superset of v1.2.0's:
  - 27 → 30 paths (assets, documents, one document) and 4 → 23 schemas;
  - `source` added to `/v1/topics`;
  - nothing removed, and `HealthResponse` unchanged.
- **`backend/tests/concord_contract_test.py`:**
  - the version is `1.3.0`;
  - `_REQUIRED_ENDPOINTS` gains the three new paths, and the "Not yet…" comment goes;
  - **every field songbird reads:** each of 16 models in `concord/schemas.py` (translations,
    notes, note search, documents, topics) must find all its fields in Concord's schema of the same
    name; Concord calls `TopicSourceCount` `TopicSourceTotal`;
  - the v8 fields spelled out too, so a model edit can't quietly shrink the check;
  - `/documents` takes `kind` and `book`, and assets serve `image/jpeg` and `image/png`;
  - **new guard, `test_every_pin_names_the_fixture_version`:** the compose file and the nightly
    must both name `concord:v<fixture version>`. It would have caught the nightly's drift.
- **`backend/tests/live_concord_test.py`** (nightly, `-m concord`), with three new checks:
  - every translation's `note_count` and `document_count` are integers;
  - topics carry `source`, `?source=` keeps to one index, and an unknown index is a not-found;
  - a translation's documents parse, and an unknown document or picture is a not-found.
- **No model change.** Every v8 field keeps its `None` / `[]` default although v1.3.0 marks them
  required, so v1.2.0 and older still work; their tests are unchanged.
- **Docs:**
  - §1's topic order: Concord v1.3.0 orders by name ignoring case. Both the published image and
    Kris's Concord do, so the Verse Finder and Nave's interleave in one alphabet.
  - "The pinned v1.2.0" became "v1.2.0 and before" throughout.
  - SPEC §12's NET caveat named a `v1.1.0` pin and an "unavailable" notice that had gone long
    since.
  - The screenshot script's comments say "the stock image".
  - **The README names no Concord version anywhere,** so it needed nothing.

### Gotchas

- **Concord's OpenAPI doesn't list the assets endpoint's 304,** though Concord sends one on
  `If-None-Match`. The contract test checks only the 200's media types; `chart_images_test.py`
  covers the 304.
- **`/v1/topics` takes at most 100 a page** (a 422 above), worth knowing when surveying.
- **The new live checks need a v8 Concord.** Against v1.2.0 the counts are missing, so they
  would fail; the nightly runs the pin.

### The slice before this, on the server

PR #155 (follow-up 6, the letter row) is live on Kris's server: `main` at `c3ec2cb`, and the live
`index.html` names the image's `assets/index-CZ7W7FE6.js`. It shipped with no migration.

It was walked through on the server's own build: a `--rm` throwaway of the new image against Kris's
Concord, with a temporary folder, reached through an SSH tunnel. Headless Chromium, 390×844 and
1280×800, light and dark:
- **The row:** the same results as the local pass. 22 letters, two rows on a phone (32.5 × 36 px),
  one on a desktop (25.6 × 36 px), as wide as the header, no sideways scroll.
- **Every letter:** 21 put their first heading 8 px below the row; Y scrolls the body to its end.
- **Elsewhere:** the other six documents and Genesis's introduction show no row, and the plan
  shows Month. On KJV with EMB ticked, and from Settings, the same row, and a reference jumps the
  reader. No page errors.
- **Timing:** on a phone with the CPU slowed 4×, a second throwaway of the image it replaced gave
  the same times within noise. Opening the Verse Finder took 566–614 ms the first time against
  603–618 before, and 360–409 ms after that against 328–386. These include the SSH tunnel, so they
  sit above follow-up 5's figures.

Both throwaways, their folders and the old image's tag were removed afterwards.

### How it was verified

- **The gate:** `make check` and `make check-frontend` green (counts in the PR). The contract test
  has 10 tests (was 4).
- **Live, against the published image:** `docker run --rm -p 127.0.0.1:18100:8000
  ghcr.io/kbennett2000/concord:v1.3.0`, then `CONCORD_BASE_URL=http://127.0.0.1:18100 pytest -m
  concord`: 7 passed, 4 from before (one of them the canonical-coordinate bridge's) and 3 new. The
  image has 15 translations whose counts are all 0, Nave's as its only source, an empty documents
  list, and 404s for an unknown document or picture. The same 7 pass against Kris's Concord, which
  has EMB.
- **Nothing on the server was touched** for this slice, and its leftover `songbird-concord-1` was
  left alone.

---

## v1.8 follow-up 6 — a row of letters on a long alphabetical document

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-letter-row`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §6 (a new bullet), §7's "Not in this slice" and §9's
  slice C2 acceptance; `docs/v1/SPEC.md` §12, "A study Bible's About page".

### Why

EMB's Verse Finder (`front-matter-6`) is 183 `##` headings, 106 screens on a phone, read through
the About page with no way to get around it. Kris asked for a row of letters under its title, like
the reading plan's Month row, offering only the letters it has.

Surveyed on Kris's Concord without keeping any text (heading counts, first letters and order
only):
- **Of EMB's 74 documents** only the Verse Finder has more than 12 `##` headings in letter order.
  Its 183 are in order under every rule tried (case-sensitive, case-folded, word by word, letter by
  letter) and start with 22 letters (no N, V, X or Z). No heading carries emphasis.
- **The rest:** book introductions have at most 12 headings, front matter at most 10, the about 2.
  The reading plan's 365 dates aren't in letter order, and the plan is recognised first anyway.

### What landed

- **`lib/letterIndex.ts`:** `parseLetterIndex` walks the markdown-it tokens as `parseReadingPlan`
  does. A document is an index when it has at least 20 `##` headings, each starting with a letter
  A–Z (past opening punctuation, accents and case folded), whose first letters never go back,
  across at least 5 letters. It returns each letter with the place of its first `##` heading.
- **`LetterRow`:** a `<nav>` ("Jump to a letter") of equal grid cells in `DocumentDialog`'s `bar`,
  where the plan's row sits. On a phone, even rows of at most 13; from 640 px, one row. The column
  counts come from two CSS variables, and `minmax(0, 1fr)` lets the cells shrink rather than push
  the page sideways.
- **`BibleAbout`:** checks for an index only when a document isn't a plan. A letter scrolls the
  body to the Nth `[data-md-heading="2"]`, which `NoteMarkdown` already marks in token order, so it
  needed no change. The plan's scroll arithmetic moved into `topIn`, shared by both.
- **No new dependency, no API or database change, no screenshot in the repo.**

### Decisions

- **The shape, not the name.** Nothing looks at the slug, title, kind or Bible. "First letters never
  go back" is the order the jump needs, and it holds for an index sorted word by word or letter by
  letter. The thresholds are 20 headings (the longest other document has 12) and 5 letters, so a
  "Chapter 1 … 20, Epilogue, Notes" run isn't one.
- **Only the letters it has.** No greyed N, V, X, Z.
- **8 px above the heading.** Flush against the header's line the heading looked cramped on a
  phone. The 8 px fall inside the gap before it, so none of the entry before shows.
- **A tap isn't a move.** It scrolls the body directly: `BibleAbout`'s layout effect runs only on
  a move or a plan change, so nothing snaps the page back. Nothing is remembered: reopening comes
  back to the Verse Finder at its top. Focus stays on the letter, as it does on the plan's Day.
- **Link-blue letters with no borders.** 22 boxed letters would be noise. The browser's own focus
  ring is kept, as on the plan's controls.

### Gotchas

- **`react-hooks/rules-of-hooks` flags MSW's `useDocuments` helper** when another helper calls it.
  Each index test calls it itself.
- **Playwright's `check()` fails on a Settings notes box:** the box follows the saved preference,
  so it changes only after the save returns. Click it, then wait for it to be checked.

### The slice before this, on the server

PR #154 (slice D, topics by source) is live on Kris's server: `main` at `85dcf46`, and the live
`index.html` names `assets/index-DNmOqmB2.js`. It shipped with no migration.

### How it was verified

- **Frontend:**
  - `letterIndex.test.ts` (8): only the letters present, each at its first heading; case, accents,
    an opening quote and emphasis; a preface, a `#` title and `###` headings ignored; 19 headings,
    a letter going back, a digit, or fewer than 5 letters aren't an index, nor are a plan or a short
    document.
  - `BibleAbout.test.tsx` (+4): the row and only its letters, in the header outside the scrolling
    body; a letter scrolls to its first heading less 8 px, keeps focus and isn't remembered; Escape
    still steps back; no row on an ordinary document or a reading plan. All made-up headings
    ("Aozzwick 1" …), never a real index's topics.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database,
  in headless Chromium, at 390×844 and 1280×800, light and dark (4 runs). The expected letters came
  from songbird's own API answer, worked out by the script independently of the app.
  - **The row:** the 22 letters, two rows of 11 on a phone (cells 32.5 × 36 px) and one row on a
    desktop (25.6 × 36 px), exactly as wide as the header (390 and 595 px). No sideways scroll, and
    it's outside the scrolling body.
  - **Every letter:** 21 bring their first heading to 8 px below the row, with none of the entry
    before showing; Y, the last, scrolls the body to its end. The heading is that letter's first,
    the row doesn't move, and focus stays on the letter.
  - **Elsewhere:** the other six documents and Genesis's introduction show no row, and the plan
    still shows Month. Escape steps back to the list.
  - **On KJV with EMB ticked, and from Settings:** the same row; a reference still closes the page
    and jumps the reader.
  - **No page errors** in any run.

---

## v1.8 slice D — topics by source

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-topics-by-source`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §7 (new), §1, §2 and §9 (Rules and Acceptance are now
  §8 and §9); `docs/v1/SPEC.md` §12, "Topics by source".

### Why

Concord's ADR-0013 (V8-S6) loads a second topical index beside Nave's: EMB's Tyndale Verse Finder,
183 topics with ids `vf-1` to `vf-183`, 8 of them "see" redirects. Every topic now carries
`source`, and `/v1/topics` lists every index with its count (`sources`) and takes `?source=`.
songbird dropped all of it, since its routes rebuild each topic field by field.

Surveyed without keeping any text:
- **Of 594 "see" redirects** (586 Nave's, 8 Verse Finder), **143 of Nave's point to a topic
  Concord lacks** (ADR-0013 says so too). A Nave's id is a lower-case slug, so "See nebo" was
  the id, not a name.
- **The pinned v1.2.0** sends `see_also` but no `source` or `sources`, and has no `?source=`.
- **Concord's order is by name, binary,** so a page or a verse's topics mix the indexes. The order
  of Exodus 21:22's four topics changed while this slice was being built (the Verse Finder's moved
  from third to second); songbird shows whatever Concord sends.

### What landed

- **API:**
  - `source` on every topic (verse topics, browse, detail).
  - `sources` on the browse page.
  - `?source=` forwarded only when given (`ConcordClient.list_topics`).
  - An unknown source's 400 is a 404, as any bad topics filter already was.
  - A topic's verses route is unchanged: Concord's page-level `source` there isn't modelled, since
    the page gets it from the detail.
- **Topics page:**
  - With more than one source, a **From:** row of pills (All, then each source with its count, in
    Concord's order), modelled on the study-note search's, and each row's quiet line names its
    source.
  - The last sources reported are kept in state, so the pills stay while a new choice loads (no
    other screen uses `placeholderData`).
  - With a source chosen, the empty message names it.
- **A topic's page:**
  - The source beside the section.
  - A "see" link fetches its target (`["topic", id]`, the target page's own cache entry) and shows
    its name: "See …" while it loads, and the id when Concord lacks the target or fails.
- **The Reader's ※ panel:** each topic's quiet line, and the drilled-in heading's, name the source.
- **No new dependency, no database change, no screenshot in the repo.**

### Decisions

- **The "see" fix applies on any Concord** (Kris's call). Against v1.2.0 it is the one visible
  change: a Nave's "see" shows its target's name in capitals.
- **Row labels and pills only with more than one source; a topic's page and the reader name the
  source whenever Concord sends one.** On a list of 5,000 rows a lone index's name is noise; on one
  topic it says where it's from.
- **All has no count.** The line above the list already says "50 of 5502".
- **The filter isn't in the address,** as the search and section aren't.

### Gotchas

- **`ruff format` on `tests/conftest.py`** reflowed two unrelated lines (the gate formats only
  `songbird/`). The file was restored and only the new parameter kept. `lib/reader.ts` and
  `TopicsView.test.tsx` weren't Prettier-clean before and were left so.
- **A test that a filter "stays while loading" passed without the fix,** because MSW answered
  before the assertion. It now holds the chosen source's answer until it has looked.
- **Playwright can't `check()` a pill's radio:** it's `sr-only` under its label. Click the label,
  as a person does.

### The slice before this, on the server

PR #153 (follow-up 5: brackets and Escape) is live: `main` at `946eb93`, and the live
`index.html` names the image's `assets/index-CnpCusPf.js`. No migration. On a throwaway container of
that image, no Verse Finder reference has a bracket alone at 390 or 1280 px, and Escape steps back
through four documents in a row.

### How it was verified

- **Backend:** `topic_sources_test.py` (10): the source on verse topics, browse and detail;
  `sources` in Concord's order; `?source=` forwarded; an unknown source a 404; the client sending
  `source` only when asked, parsing it and its absence, and mapping a 400 and a 500. The
  `topics_test.py` exact-match checks now include `source: null` and `sources: []`.
- **Frontend:**
  - `TopicsView.test.tsx` (+4): the pills and counts with two sources, Concord's order kept, a
    choice sent and shown; the pills staying while a choice loads (held response); the named empty
    message; none and no labels with one source or an older Concord, with no `source` ever asked.
  - `TopicDetailView.test.tsx` (+3, 1 changed): "See" + the target's name; the id when the target
    is a 404; the source line, and the section alone from an older Concord.
  - `VerseTopics.test.tsx` (+2): the source on each topic and in the drilled-in heading; the
    section alone from an older Concord.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database,
  in headless Chromium, at 1280×800 and 390×844, light and dark (4 runs, a script comparing the page
  with songbird's own API answers):
  - **Topics:** the first 50 rows in Concord's order; pills "All", "Nave's Topical Bible (5,319)",
    "Tyndale Verse Finder (183)"; every row labelled.
  - **Choosing the Verse Finder:** its rows in Concord's order, "50 of 183", and **Load more** stays
    in it. A search for "pray" gives counts 4 and 1, matching Concord.
  - **`vf-1`:** "A · Tyndale Verse Finder" and its 12 verses.
  - **`vf-122`:** "See" + `vf-56`'s name, which opens it. `abarim` reads "See NEBO", and
    `admonition` (a target Concord lacks) "See wicked-warned", each with "A · Nave's Topical Bible".
  - **Exodus 21:22's ※ panel:** its four topics name their sources in Concord's order; the Verse
    Finder's opens on its 12 verses with its source under the heading.
  - **Overall:** no sideways scroll and no page errors. On a phone the pills take two rows.

---

## v1.8 follow-up 5 — two fixes found looking at the Verse Finder

- **Date:** 2026-10-02
- **Branch:** `fix/v1.8-reference-brackets`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §3 (the note view) and §6 (Getting back), each a dated
  line.

### Why

Concord now serves the Tyndale Verse Finder as printed (`front-matter-6`, ADR-0013): 183 `##`
topics and 1,286 list items, each "statement (reference)". Before slice D, the live build was
checked against it in headless Chromium: EMB and KJV with EMB ticked, 1280×800 and 390×844, light
and dark. It opened, its headings and "see" lines read well, and a reference jumped the reader. The
Exodus 24:3 and Genesis 39:23 Perspectives boxes had their passage and saying in italics, the
reference and attribution upright, and no stray `*` or `\`. Two things were wrong:

- **Brackets alone on a line.** At 390 px, 577 entries (45%) had "(" end a line with the reference
  starting the next, or ")" alone after it; 69 at 1280 px. A `ref:` link is a `<button>`, and a
  button is an inline block, so the line may break on either side of it, even after "(".
- **The third Escape closed the About page.** From a document, Escape stepped back to the list
  twice; the third time, from any document, the whole page closed. The same happened on the live
  build. Chrome 148 fires the dialog's `cancel` as not cancelable on the third close request, even
  right after a click, by its rule against pages that trap Back. On a bare `<dialog>`, refusing
  `cancel` worked 2 times out of 6; refusing Escape's `keydown` worked 6 times out of 6.

### What landed

- **`NoteMarkdown`:** a `ref:` button with an opening bracket or quote right before it, or closing
  punctuation right after it, sits with them in a `whitespace-nowrap` span; the button itself is
  `whitespace-normal`, so a long link's words still wrap. The text is unchanged.
- **`DocumentDialog`:** Escape's `keydown` calls `onCancel` first and is prevented when it stepped
  back, so the browser never makes it a close. A key press inside a dialog within it (a picture's
  large view) is left to that dialog. Android's Back still arrives only as `cancel`, handled as
  before.

### Not changed: Android's Back

Back has no key press to catch, so on a phone the third Back in a row is expected still to close
the page. Not tried on a real phone. Working around it would mean fighting the browser's own rule
(reopening the page after it closes, say); left alone.

### The slice before this, on the server

PR #152 (slice C2, the About page) is live on Kris's server: `main` at `23c207d`, and the live
`index.html` names `assets/index-DXRuiKQq.js`. It shipped with no migration.

### How it was verified

- **Tests:** `NoteMarkdown.test.tsx` (+1: brackets, a full stop, a link between spaces, the words
  unchanged); `BibleAbout.test.tsx` (+1: Escape's key press steps back three times, and is left
  alone on the list). The new Escape test fails without the fix.
- **The gate:** `make check-frontend` green (566 tests).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database.
  - The Verse Finder: 0 brackets alone at 390 and 1280 px. The 8 runs above again, with no
    differences and no page errors.
  - Genesis, Isaiah and Philemon's introductions, the reading plan, the other five front-matter
    pieces and the about: no bracket alone and no sideways scroll at either width.
  - Escape stepped back 8 times in a row across all 7 documents, focus on the row each time; it
    closes only a picture's large view first, then the introduction; from the list it closes the
    page.
  - On a phone with the CPU slowed 4×, the Verse Finder opens in 0.47–0.50 s the first time and
    0.32–0.35 s after (0.43–0.45 and 0.28–0.36 s before). Flinging it with a finger, about 29,000
    px in six flings, gave no frame over 17 ms, before and after. It is 106 screens long on a
    phone and 78 on a desktop.

---

## v1.8 slice C2 — a study Bible's About page

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-about`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §6 (new), §1, §2 and §8 (Rules and Acceptance
  renumbered); `docs/v1/SPEC.md` §12, "A study Bible's About page" and "Settings page".

### Why

Concord V8-S5c loaded the rest of EMB's documents: 5 front matter, a reading plan and an about,
beside the 66 introductions from C1. None of them belongs to a chapter, so they get a page of their
own, reached from the reader and from Settings.

Their shape, surveyed without keeping any text:
- **Front matter:** two prose pieces with 9 and 10 `##` headings (722 and 4,138 words); a copyright
  page of paragraphs and one list; the contributors as 9 italic-role-over-names paragraphs (hard
  breaks); the translation team as 8 `##` divisions, each a senior translator over a school, then
  italic book labels over bulleted lists of people.
- **About:** two `##` sections: author notes opening with a bold name, then bold titles over their
  author, each followed by a credit.
- **The reading plan:** 365 `##` dates (a month's first day in capitals), each over 4 readings as
  `ref:` links, about 61 KB. A reading that crosses into the next book is two links in one item.
- **No pictures** in any of the seven.

### What landed

- **No API change.** C1's passthrough serves every kind; the page reads the unfiltered list and one
  document at a time.
- **Shared with C1, pulled out of `BookIntroduction`:**
  - `DocumentDialog`: the full-window modal, its header (eyebrow, title, an optional leading
    button, an optional bar that never scrolls) and its own scrolling body. `onCancel` lets a page
    step back instead of closing.
  - `DocumentText`: the reading column's classes and `useDocumentPictures`, the picture figure and
    its large view (kept outside the scrolling body, as before).
  - `BookIntroduction` now uses both, unchanged in behaviour; its 7 tests pass as they were.
- **`lib/documents.ts`:** `documentSources` (C1's `introductionSources`, renamed and moved),
  `documentListOptions` (the whole list, once a session), the document query, and `aboutGroups`.
- **`lib/readingPlan.ts`:** `parseReadingPlan` splits a plan into days by its `##` headings' source
  lines (markdown-it's `map`), or returns null for one not laid out by date. Also `monthsIn`,
  `daysIn`, `dayName`, `planDayId` and `todayIn`.
- **`BibleAbout`:** the list grouped by kind, a document in full, a reading plan a month at a time,
  states, the back step, and its place reported to whoever opened it.
- **`ReadingPlan`:** the Month / Day / Today bar and the month's days.
- **The reader:** **About EMB** after each source's introduction button. The place each Bible's page
  was left at is kept in a ref, in memory only.
- **Settings:** *About these Bibles*, opening the same page over Settings; a link navigates to
  `/read?book=&chapter=&verse=`.
- **No new dependency, no database change, no screenshot in the repo.**

### Decisions

- **One view for the reader and Settings, not a route.** The reader keeps its exact line under the
  view, as with an introduction; Settings gets the same page rather than a second shell.
- **A month at a time.** The plan's whole year would be ~3,700 elements; a month is ~470 with the
  view's own. Month, Day and Today in a bar that never scrolls away make any date two taps.
- **Opens on today, remembers where a reading was tapped.** A reading jumps the reader and closes
  the view; **About EMB** then reopens on that day. Both come from the device's date and the
  reader's memory; nothing about what's been read is stored.
- **Escape and Back step back a level.** From a document they return to the list, with focus on its
  row; from the list they close.
- **One column for every document.** A two-column team list on a desktop would need a guess about
  which documents are lists of names. The plan is the one exception, and only when every `##`
  heading is a date.
- **The plan bar's text size sits on its controls.** `max-w-prose` is 65 `ch`; on a `text-sm` row
  it was 37 px narrower than the header above it (found in the browser pass).

### Gotchas

- **Scroll the plan's body by hand.** `scrollTop` from the day's and the body's rectangles, never
  `scrollIntoView`, which may also scroll the page under the view.
- **Only the dialog's own `cancel` counts,** as with `close`: React passes a nested dialog's up.
- **Playwright's `click()` scrolls its target into view.** The title row is at the chapter's top,
  so a check that scrolled the reader down and then clicked **About EMB** saw the reader "jump to
  the top". With `dispatchEvent("click")` the reader stays at y = 400 through open, Close and
  Escape, for the introduction and the About page alike.
- **Prettier on a glob reformats files that weren't Prettier-clean.** Only the new files and those
  clean before were formatted; the rest were restored.

### The slice before this, on the server

PR #151 (book introductions) is live on Kris's server: `main` at `0ef2253`, and the live
`index.html` names `assets/index-CoEM_AjN.js`. It shipped with no migration.

### How it was verified

- **Frontend:**
  - `readingPlan.test.ts` (7): dates in any case, a crossing reading in its day, the preface and
    Windows line ends, emphasis and a smaller heading, null for plans not by date, 29 February,
    `todayIn`.
  - `documents.test.ts` (6): `documentSources` (moved), `aboutGroups` and its labels.
  - `BibleAbout.test.tsx` (13): the list, none, failure and Try again; a document, ‹ with focus on
    its row, Escape stepping back (`cancel` prevented) and not on the list, a link and both ways
    back, a document's loading and failure; the plan on today and scrolled there, Month / Day /
    Today and the month links, both halves of a crossing reading, reopening at a day, the fallback.
  - `ReaderView.test.tsx` (+6): after the introduction on EMB and on KJV with EMB ticked; hidden for
    introductions only; Close with focus back without scrolling; a reading jumps and the view
    reopens on the plan; shown on failure; it and the introduction close each other. C1's request
    checks now include the one whole-list request.
  - `SettingsView.test.tsx` (+4): the section and its rows, none from an older Concord (nothing
    asked), a reading opens the reader, Close gives the row focus.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database, in
  headless Chromium. EMB and KJV with EMB ticked, at 1280×800 and 390×844, light and dark (8 runs),
  then Settings in light and dark.
  - **The title row:** **About EMB** right after **Introduction** / **EMB introduction**; no
    sideways scroll (two rows, 62 px, on a phone).
  - **The list:** three groups, seven rows, 44 px each.
  - **Each document:** 16 / 28 px text in a 595 px column (390 on a phone), `##` at 17 px / 600
    with a rule, no sideways scroll. The NLT introduction is the longest: 16 screens on a desktop,
    24 on a phone. The team list is 8 and 10.
  - **The plan:** opens on today's month with today at the top, tagged, its bar blue-600 in light
    and blue-400 in dark. January's first day is "January 1"; June 15 and December 31 come up
    through Month and Day; both halves of the January reading that crosses books jump to their own
    starts, and **About EMB** reopens on that day.
  - **Settings:** one row, "About EMB ›", with the Bible's name and its three groups; a reading
    opens the reader in the Bible last read, and Back returns to Settings.
  - **On a phone with the CPU slowed 4×:** the plan opens in 264 ms the first time and 122 ms after;
    a month change takes 62–120 ms.
  - **No page errors** in any run.

---

## v1.8 slice C1 — a book's introduction in the reader

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-introductions`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §5 (new), §1, §2 and §7; `docs/v1/SPEC.md` §12,
  "Book introductions".

### Why

Concord now serves a translation's documents (its ADR-0012, V8-S5). On Kris's Concord, EMB has 66
book introductions and every other Bible none. Front matter, the reading plan and the author notes
aren't loaded yet, so slice C splits: C1 (this) is the introductions, and C2, the About page, waits
for them.

Their shape, surveyed across all 66 without keeping any text:
- `##` headings only (10 or 11 each) and flat lists. 64 have block quotes.
- 42 use backslash hard breaks: poetry inside quotes, and the timelines (36 have one).
- **Exactly one picture each,** a wide banner about 1024×160–198 (the book's reading time).
- No tables, no HTML, and no links but `ref:`.

### What landed

- **API:**
  - `document_count` on translations.
  - `GET /api/v1/translations/{translation}/documents?kind=&book=` and `.../documents/{slug}`
    pass Concord through (`ConcordClient.list_documents`, `get_document`).
  - A 400 or 404 is a 404, an outage a 502, and `.` / `..` are refused before any call.
  - No caching headers: the browser keeps them in React Query's memory for the session
    (`staleTime: Infinity`; Concord's documents are immutable).
- **`lib/introductions.ts`:**
  - `introductionSources`: the Bible read, then the ticked ones, each with documents.
  - The list and document query options.
  - `introductionFor`: the open book's entry in a list.
- **The reader:** after **Notes ▾**, an **Introduction** or **EMB introduction** button per source.
  It is hidden only when its list loaded without this book.
- **`BookIntroduction`:** a native modal `<dialog>` filling the window, as the chart viewer is.
  - Header, a 65-character column, `NoteMarkdown` with `headingBase={3}`, the picture, and
    **← Back to …** at the end.
  - Loading, failure (with Try again), and none.
  - A `ref:` link unmounts it and navigates.
  - Close, Escape and Back close it, and focus returns to the button with `preventScroll`.
- **`NoteMarkdown`:** two optional props, so the note box is unchanged.
  - `headingBase`: real heading elements.
  - `renderImage`: a paragraph that is only an `asset:` picture becomes a block of its own.
- **`ChartPicture`:** gains `size="figure"` (a frame of the picture's shape) and `noun="picture"`.
  **`ChartViewer`** gains `noun`.
- **No new dependency, and no database change.**
- **No screenshot in the repo:** every introduction is EMB's.

### Decisions

- **A view over the reader, not a page of its own.** The reader stays mounted, so closing returns
  to the exact line; a separate route would remount it and lose the scroll. Android's Back still
  closes it (a modal dialog's cancel).
- **The button shows while its list loads, or if it failed.** EMB has all 66, so it appears at once
  with nothing shifting, and a failure is shown in the view rather than hidden (invariant 3).
- **The picture's "⤢ Open larger" sits in its caption, not on it.** At phone width the banner is
  358×65, and the overlay used for charts covered part of it. The caption's copy is a
  pointer-and-finger shortcut (`aria-hidden`, no tab stop); the picture itself is the keyboard's
  button.

### Gotchas

- **React passes a dialog's `close` event up the React tree,** though the browser's doesn't bubble.
  The picture's viewer is a dialog inside the introduction's, so closing it also fired the
  introduction's `onClose`. The handler checks `e.target === e.currentTarget`.
- **Focusing the button on close scrolled the page up to it.** The first browser pass found this:
  the reader, scrolled 400 px down, was back at 0 after closing. The fix is
  `focus({ preventScroll: true })`; a test spies on it.
- **A jump must not focus the button** (that would scroll away from the verse). So a link unmounts
  the open dialog, which takes it out of the top layer without a close or a focus restore.
- **Prettier on `ReaderView.test.tsx`** (not Prettier-clean before) reformatted unrelated lines. It
  was restored and only the new block kept.

### The slice before this, on the server

PR #150 (the five reading fixes) was deployed to Kris's server on 2026-10-02 with no migration.
- The live `index.html` names the image's `assets/index-J4HVr8Za.js`.
- Before deploying, a throwaway container of the old image (empty database, over an SSH tunnel)
  gave the "before", and one of the new image the "after", measured with the same script. Numbers
  only; the before and after screenshots went to Kris, not the repo.

| | Before | After |
|---|---|---|
| EMB Genesis 35:21's article, marker 633 px down a 390×844 screen | below, 165 px tall (11.5 boxfuls) | above, 619 px tall (3.1) |
| NET Psalm 23:6's two markers | 0 px apart | 3.8 px |
| EMB Job 4:1: title / `##` / `###` / bold lead-in | 14/600, 14/600, 14/600, 14/700 | 16/700, 15/600 + rule, 11.9/600 capitals, 14/700 |
| EMB Genesis 1:18's topic at 390 px: a wrapped line's second part | flush left (0 px) | 21 px in |
| KJV Genesis 1, Jump to "John 3:16", then reload | address stays `?book=GEN&chapter=1`, reload opens Genesis 1 | `?book=JHN&chapter=3&verse=16`, reload opens John 3 |

- **Light and dark** gave the same numbers, and there were no page errors.

### How it was verified

- **Backend:** `documents_test.py` (20):
  - The routes: the list and a document pass through, with filters forwarded; 404, outage 502,
    dot segments, signed out.
  - `document_count` passes through, and is null from an older Concord.
  - The client: URL, params, encoding, 400/404 → NotFound, 500 and a dropped connection →
    Unreachable.
- **Frontend:**
  - `introductions.test.ts` (4).
  - `BookIntroduction.test.tsx` (7): loading, then loaded; from another Bible; a jump and the way
    back; the picture, its viewer and focus back; the caption's shortcut; a failure and Try again;
    none.
  - `NoteMarkdown.test.tsx`: `headingBase`, placed pictures, alt text without a placer.
  - `ChartPicture` / `ChartViewer`: the figure and the picture wording.
  - `ReaderView.test.tsx` (7):
    - the button on EMB, named by its Bible on KJV
    - open, then Close with focus back without scrolling
    - the next chapter asks for no new list
    - Escape
    - a `ref:` jump and the address
    - a failure, then Try again
    - none for a book without one, for a Bible without documents, or from an older Concord
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database,
  in headless Chromium. Genesis, Isaiah and Philemon, on EMB and on KJV with EMB ticked, at
  1280×800 and 390×844, light and dark: 24 cases.
  - **The button:** "Introduction" on EMB, "EMB introduction" on KJV. None on KJV with NET ticked.
  - **The view:**
    - "Loading the introduction…" first.
    - `##` headings as h3, at 17 px / 600 with a rule; text at 16 / 28 px.
    - The column is 595 px on a desktop and 390 on a phone.
    - Genesis has 9 timeline entries and Isaiah 12, with 26 poetry lines in Isaiah's quotes.
  - **The picture:** loaded, 563×100–103 on a desktop and 358×64–65 on a phone. Its viewer opens
    fitted (100%, or 38% on a phone). Escape closes only the viewer, with focus back on the picture.
  - **Closing:** Escape, Close and Back each leave the reader at the same scroll position, with
    focus on the button.
  - **A link:** closes the view, and the address follows.
  - **Overall:** no sideways scroll and no page errors. The phone's title row wraps
    **EMB introduction** beside **Notes ▾**, with no overflow.

---

## v1.8 follow-up 4 — five reading fixes

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-reading-fixes`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §3 (a dated line under *The note view*).

### Why

Two earlier looks at EMB's articles, topics and boxes (the "first look" and "topics and
Perspectives boxes" entries below) found five things wrong with songbird's reading. Kris approved
fixing all five, with the box's width and the markers' looks left as they are:
1. A long note opened below its marker whenever 160 px were free there, even with far more room
   above, so an article tapped low on the screen got a box about 200 px tall.
2. Two markers side by side read as one number ("12").
3. A note's title, its `##` and `###` headings and its bold opening words all looked the same.
4. A long line of poetry wrapped flush left, so it read as two lines of the poem.
5. After a jump, the address bar kept the old chapter, so a reload went back.

### What landed

- **`Popover`:** below if the whole box fits there, otherwise the side with more room. A short note
  low on the screen still opens below, exactly as before. The rule is shared by every popover:
  - a Bible's note
  - one or several of your notes on a verse
  - one or several sermon notes
  - the **Notes ▾** menu

  Each changes only when it is taller than the room below.
- **`VerseText`:** a marker that directly follows another gets `ml-[0.3em]` (about 4 px). The first
  of a run, and a marker after words, sit where they always did, and the looks are untouched.
- **`NoteMarkdown`, headings:** each level has its own look, sized in `em` so it scales with the
  text around it. The headings stay `<p>` inside the note box.
  - `#` and `##`: 1.07em semibold with a hairline rule under them.
  - `###` and below: 0.85em semibold small capitals, muted.
  - The note's title (`NotePopover`): 16 px bold.
  - Bold opening words: unchanged.
- **`NoteMarkdown`, poetry:** a paragraph whose hard breaks make two or more lines of words is
  poetry. A last line that is only its `ref:` reference, in brackets or not, isn't counted. Each line
  becomes a block with a hanging indent (`pl-[1.5em] -indent-[1.5em]`).
  - A topic's one-line prose quotation and its reference isn't poetry, so it keeps its plain break.
  - Ref buttons inside an indented line aren't shifted: browsers give buttons `text-indent: 0`.
- **`ReaderView`:** one effect writes `?book=&chapter=` (plus `&verse=` after a jump to a verse) with
  `replace`, whenever the reader's place differs from the address.
  - The verse stays after its highlight fades, so a reload goes back to it.
  - Back still leaves the reader.
  - Every way of moving goes through `navigate()`, so all of them now update the address: the
    dropdowns, Prev and Next, the Jump box, cross-references, topics, word study, places, the map
    and `ref:` links.
- **No API or database change.**

### Gotchas

- **Nothing tested the popover's placement before.** happy-dom lays nothing out, so `Popover.test.tsx`
  gives the window's size, the marker's rect and the box's `offsetHeight` (a getter spied on the
  prototype). The "tall box, 170 px below, 500 above" case fails on the old rule.
- **Prettier reformats whole files,** and `VerseText.test.tsx`, `NotePopover.test.tsx` and
  `ReaderView.tsx` weren't Prettier-clean before. Only files that were already clean were run through
  it.
- **The reader's test books are Luke, John and Acts,** so a test that presses Next after a jump has to
  jump within them.

### How it was verified

- **Tests:**
  - `Popover.test.tsx` (4).
  - `VerseText.test.tsx`: the gap only between markers.
  - `NoteMarkdown.test.tsx`: each heading level's look; poetry, poetry in a quote, a timeline entry,
    a one-line quotation, prose.
  - `NotePopover.test.tsx`: the title's look.
  - `ReaderView.test.tsx`: the address after the Jump box, after Next, and after a note's `ref:`
    link.
  - The placement test and both address tests fail on the old code.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database, in
  headless Chromium. Numbers only; nothing is quoted here.
  1. **The box:** EMB, Genesis 35:21's "Someone You Should Know" at 390×844, with the marker 633 px
     down. It opens above, 619 px tall (the article is 3.1 boxfuls).
  2. **The gap:** NET, Psalm 23:6's two markers. The gap is 3.8 px.
  3. **The headings:** EMB, Job 4:1's article, at 1280 and 390, light and dark.
     - Title: 16 px / 700.
     - `##`: 15 px / 600 with a 1 px rule.
     - `###`: 11.9 px / 600 in capitals, grey.
     - Bold opening words: 14 px / 700.
  4. **The poetry:** EMB, Genesis 1:18's topic at 390. A wrapped line's second part starts 21 px in.
  5. **The address:** KJV, Genesis 1, then the Jump box with "John 3:16":
     `?book=JHN&chapter=3&verse=16`. A reload opens John 3, with verse 16 in view.
  6. **Overall:** no page errors.

---

## v1.8 slice B follow-up — the chart viewer's first frame

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-charts-fit`
- **Spec:** unchanged (`docs/v1.8/STUDY-BIBLE-SPEC.md` §4 already says the view opens fitted).

### Why

On the server's build, a check read the Search page's large view on a phone as "Zoom 100%" just
after the picture loaded, and "Zoom 38%" (fitted) a moment later. It looked like the picture
showing at full size for a frame. A frame-by-frame recording showed it isn't:
- for one frame the picture is still hidden (1 px, `sr-only`) and only the readout says 100%;
- from the next frame on it is fitted, at 38% and 390 px.

The same holds for the old build. Two smaller things were real:
- **The readout claims a zoom it doesn't know.** Until React's `onLoad` records the picture's size,
  "fit" falls back to 1, so the readout, a live region, said "Zoom 100%" before the right value.
- **The viewer measured its picture area before opening the dialog.** One layout effect measured
  and a later passive effect called `showModal()`. A closed dialog has no size, so that measurement
  was 0×0, and only the `ResizeObserver` put it right. In Chromium that happens within the frame;
  in happy-dom it never happens.

### What landed

- **One layout effect opens the dialog and then measures.** A test gives the picture area a size
  only while its dialog is open; on the old code it read "Zoom 100%" where "Zoom 50%" was due.
- **The readout shows "…" (hidden from screen readers) until the picture's size is known.** The
  live region then announces the fitted zoom once.
- **Recorded again on the local build:** "… hidden" for one frame, then "Zoom 38%" shown at 390 px.

### Slice B on the server

PR #148 was deployed to Kris's server on 2026-10-02 with no migration.
- The live `index.html` names the image's `assets/index-C5IziDeg.js`.
- `/api/v1/translations/EMB/assets/chart-01.jpg` is a 401 when not signed in.

Checked in headless Chromium against a throwaway container of that image, with its own empty
database, over an SSH tunnel:
- **The 24 cases:** Genesis 13, Jeremiah 1 and Psalm 9, on EMB and on KJV with EMB ticked, at
  1280×800 and 390×844 (touch), light and dark, all as in slice B's local check.
  - The markers are at verses 4, 3 and 1, and the pictures come from EMB.
  - The frame is 262×192, and the popover stays on screen.
  - Fitted at 100%, 98% and 100% on desktop; on the phone, 38%, then 86% after + +, and 190% after a
    pinch, with the page zoom still 1.
  - Closing brings the note back with focus on the picture.
  - Every picture was 200 `image/jpeg`, `private, max-age=31536000, immutable`.
  - No page errors, no overflow.
- **Search,** "Pss" (a chart's indexed text is its short reference): EMB's Psalm 9 chart shows as a
  "Chart" hit with a 112×80 thumbnail. It opens the large view titled with the chart's name, and
  focus returns to the thumbnail. That is where the 100%-then-38% above was seen.
- **Against the leftover Concord v1.2.0** (a second throwaway container on its network): 15
  Bibles and no `note_count`.
  - `/notes/KJV/GEN/13` is `[]` and the study-notes search is `{results: [], total: 0}`.
  - The picture route is a 404 that nothing calls.
  - The reader shows Genesis 13 with no chart markers, no frames and no Notes menu.
  - Keyword search finds "Abram" (324 highlights) with no study-notes section.
  - No page errors at either width.

---

## v1.8 slice B — charts

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-charts`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §4 (new), §1 and §6; `docs/v1/SPEC.md` §12, "Charts".

### Why

Concord now stores and serves a translation's pictures (its ADR-0012, V8-S4). EMB has 44 charts:
notes of type `chart` with a title, passages (on 40), text that is only the chart's reference as a
`ref:` link, and `image`, a name such as `chart-01.jpg`. Songbird dropped `image` at both layers
(and zod stripped it), so a chart showed as a title and a link. Its words are inside its picture,
so the picture has to be readable on a phone.

### What landed

- **API:**
  - `image` on notes and on study-notes hits, plus `title` on hits.
  - `GET /api/v1/translations/{translation}/assets/{name}` passes the picture through
    (`ConcordClient.get_asset`). Concord's ETag, Vary and Cache-Control are kept, with `public` made
    `private` (Kris's call: songbird serves it only behind its login). It adds `nosniff`, forwards
    `If-None-Match` and passes the 304 back.
  - Only JPEG and PNG are relayed; anything else is a 502.
  - A 404 is a 404, and `.` / `..` are refused before any call.
  - An outage is a 502 with nothing to cache.
- **Note view** (`ChartPicture`): the picture comes from the note's own Bible, in a fixed
  full-width × 12rem frame: loading, loaded or failed, the same size.
- **Large view** (`ChartViewer`): a native `<dialog>` via `showModal()`, filling the window. It
  opens fitted and zooms to 3× with − / + / Fit, a pinch, a double-tap or double-click, Ctrl +
  wheel, and + − 0.
  - The zoom maths is pure, in `lib/chartZoom.ts`.
  - Opening it closes the note; closing it reopens the note with focus on the picture
    (`ReaderView`'s `openChart`).
- **Search:** a hit with an `image` shows its title and a lazy thumbnail that opens the same view.
- **`NOTE_TYPE_LABELS`** gains `chart: "Chart"`.
- **No new dependency, no database change.**
- **No screenshot in the repo:** every chart is EMB's.

### Decisions

- **The popover closes while the viewer is open,** instead of staying under it. `Popover` closes on
  any outside mousedown, any outside scroll and any resize, and turning a phone sideways to read a
  wide chart is a resize. Reopening it afterwards also re-measures it for the new orientation.
- **Native `<dialog>`, not the app's `Modal`.** `showModal()` gives the top layer (above the
  popover's z-40), an inert page and focus held inside, plus Escape and Android's Back as `cancel`.
  `Modal` has no focus trap.
- **Zoom by resizing the picture inside a scroll box,** not with a CSS transform. Panning, momentum
  and the arrow keys are then the browser's own. Only the pinch and Ctrl + wheel need listeners, and
  they are non-passive so the page itself never zooms (`touch-pan-x touch-pan-y` on the box).

### Gotchas

- **`raise_for_status()` raises on a 304** ("Redirect response '304 Not Modified'"), so `get_asset`
  checks for a 304 first.
- **StrictMode runs effects twice in dev.** Calling `close()` in the viewer's unmount cleanup would
  fire `onClose` and shut it the moment it opened. Removing an open dialog from the page already
  takes it out of the top layer, so there is no close on unmount.
- **The popover first renders `visibility: hidden` while it measures itself,** and an element inside
  a hidden one can't take focus. The picture's focus after the viewer closes therefore waits a
  frame. Only the real browser showed this: happy-dom doesn't compute visibility.
- **Prettier reformats whole files.** `ReaderView.tsx` and `SearchView.tsx` weren't
  Prettier-clean before this branch, so only new files were run through it.

### The fix before this, on the server

PR #147 (the brief Concord failures) was deployed to Kris's server on 2026-10-02 with no migration.
- **Through a throwaway container of the new image:** 36 of 36 requests at the gaps that had given a
  502 on the old one succeeded.
- **The branch's client inside that image, with the idle time forced back to 5 s:** 84 of 84 at 4.90
  to 4.995 s succeeded, and 3 were retried (2 `RemoteProtocolError`, 1 `ReadError`).
- **The live container then took the new image:** healthy, Concord reachable, 20 Bibles.

### How it was verified

- **Backend:**
  - `chart_images_test.py` (13 tests): the route's 200 and its headers, 304, 404, the outage,
    non-images refused, dot segments, signed out; the client's URL, 304 and errors.
  - `v8_note_fields_test.py`: `image` and `title` through `/notes` and the search, and null from an
    older Concord.
- **Frontend:**
  - `chartZoom.test.ts` (9).
  - `ChartPicture.test.tsx` (4).
  - `ChartViewer.test.tsx` (8): modal, focus, fit, buttons to the 3× limit, keys, double-click,
    Close, Escape, a failure.
  - `NotePopover.test.tsx`: the order, the source for a borrowed chart, no frame without an image.
  - `ReaderView.test.tsx`: open, then close back to the note with focus on the picture.
  - `SearchView.test.tsx`: title, thumbnail, viewer, focus back.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser, before the PR:** a local build against Kris's Concord, with a scratch database,
  in headless Chromium.
  - **Coverage:** Genesis 13, Jeremiah 1 and Psalm 9 on EMB, and on KJV with EMB ticked, at
    1280×800 and 390×844 (touch), light and dark: 24 cases.
  - **Placement:** each chart's marker sits at the end of verse 4, 3 and 1 respectively, and
    borrowed onto KJV it still loads from EMB.
  - **The note view:** the frame is 262×192, and the popover stays on screen.
  - **The large view:** fitted at 100%, 98% and 100% on desktop, and 38% on the phone, where two
    presses of + give 86% (readable) and a CDP pinch 190% with the page's own zoom still 1.
  - **Closing:** brings the note back.
  - **Pictures:** every one was 200 `image/jpeg` with `private, max-age=31536000, immutable`.
  - **Overall:** no page errors, no sideways overflow.
  - **Found there:** the focus bug above.

---

## v1.8 fix — the brief Concord failures (a connection closed under a request)

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-stale-connection`
- **Spec:** none changed (a client-behaviour fix; invariant 3 holds as before).

### Why

Now and then a request for the Bible list came back 502 though Concord was up, and the page recovered
on TanStack Query's one automatic retry (`retry: 1` in `lib/queryClient.ts`). The request never
reached Concord. The last session reproduced the cause with a tiny uvicorn server: songbird's
`httpx.AsyncClient` kept an idle connection for 5 s (`keepalive_expiry`), and Concord's uvicorn
(started without `--timeout-keep-alive`, so 5 s) closes an idle connection at 5 s. httpcore only
drops a pooled connection when its timer has run out or the socket already reads as closed. A request
sent in the few milliseconds when Concord has closed but the close hasn't arrived goes out on a dead
connection. httpx raises `RemoteProtocolError` or `ReadError`, and httpx retries only connect errors.

### Confirming it was this

All against Kris's Concord, before any code changed (scripts kept out of the repo):
- **httpx's defaults straight at Concord, from the dev machine over the LAN:** 12 requests per
  idle gap, one client per gap.
  - 22 of 96 failed between 4.90 and 4.995 s, and 1 of 12 at 4.5 s.
  - None failed among 336 requests at 1 to 4.5 s, nor at 5.0 s or more (there httpx drops the
    connection itself).
  - Every failure was `RemoteProtocolError: Server disconnected without sending a response`.
  - The window is wider over the LAN than on one machine because a close takes longer to arrive.
- **Through songbird `main` run locally:**
  - 9 of 36 requests to `/api/v1/translations` were 502 `CONCORD_UNREACHABLE` "… Server
    disconnected without sending a response."
  - Concord's access log had a line for each of the 27 that worked and **none** at the 9 failure
    times.
- **On the server's own path** (the probe run inside the songbird image, reaching Concord through
  `host.docker.internal` as songbird does): the window is about 4 ms wide.
  - 4 of 24 failed at 4.996 and 4.998 s, with the same two errors.
  - Nothing failed at 4.994 s or below, nor at 5.0 s.
  - Through a throwaway container of the server's then-current songbird image, 1 of 36 requests at
    4.984 to 4.996 s was the same 502, and Concord's log has no line at that moment.
  - So on the server it is rare, "now and then", exactly as seen.

### What landed

`backend/songbird/concord/client.py` only.
- **`_RetryStaleConnection`** wraps the client's transport. It sends a GET once more when it fails
  with `RemoteProtocolError`, `ReadError` or `WriteError`, and logs one INFO line saying so.
  - The dead connection has already left the pool, so the retry goes out on a live or new one.
  - Timeouts and `ConnectError` aren't retried: a slow or down Concord is asked once, and is still
    an error (invariant 3).
  - One retry, never a loop.
  - All of the client's methods share it, and a test's injected transport is wrapped the same way.
- **The idle time drops to 2 s** (`_KEEPALIVE_EXPIRY`): a wide margin under Concord's 5 s, given
  that the LAN window opened as early as 4.5 s. That stops the race at its source against a stock
  Concord. The retry covers a Concord behind anything that closes sooner. On the LAN a new
  connection costs about a millisecond, and the requests within one page load still share
  connections.

### The other clients

- **`YouTubeClient`** has the same httpx defaults, but the race needs the server to drop idle
  connections no later than songbird does. `www.googleapis.com` kept an idle connection open for
  more than 90 s (measured), so httpx's 5 s timer always closes first. No change.
- **The browser talking to songbird** (songbird's own uvicorn, also 5 s) isn't songbird's code.
  Browsers resend a request that fails on a reused connection before any reply. No change. A
  probe script hit this once, which is why the sweeps open a fresh connection to songbird each
  time.
- **Nothing else in the backend makes HTTP calls.** I searched for `urllib`, `requests`, `aiohttp`
  and `http.client` and found none.

### Gotchas

- **A request that never reached Concord leaves no trace there,** and songbird logged nothing
  either (the 502 is an `HTTPException`). The retry's INFO line is now the trace.
- **A probe is only fair if it opens a fresh connection to songbird for every request.** One that
  reuses its own connection races songbird's uvicorn in exactly the same way.

### How it was verified

- **`tests/concord_stale_connection_test.py`** (fast suite, no live Concord, no timing): a raw
  asyncio server answers a connection's first request and hangs up on a reused one, once with a
  clean close and once with a reset.
  - **On `main` both cases fail** with `ConcordUnreachableError`, caused by `RemoteProtocolError`
    and `ReadError` respectively.
  - With the fix, both calls succeed, and the server sees 3 requests over 2 connections.
  - A server that hangs up on every request is still `ConcordUnreachableError` after exactly 2
    attempts.
  - A `ConnectError` or a `ReadTimeout` is attempted once.
- **The branch's client against Kris's Concord, with the idle time forced back to 5 s so the race
  happens:** 84 of 84 requests at 4.90 to 4.995 s succeeded. 23 were retried (21
  `RemoteProtocolError`, 2 `ReadError`).
- **Local songbird on the branch:** the same sweep through `/api/v1/translations` returned 36 of
  36 OK. On `main` it was 27 of 36.
- **The gate:** `make check` green (counts in the PR).

---

## v1.8 follow-up 3 — study-note search: pages and a per-Bible filter

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-study-notes-paging`
- **Spec:** `docs/v1/SPEC.md` §12, "Study-notes search"; a dated note in
  `docs/v1.3/SEARCH-EXPANSION-SPEC.md`, "What's deferred".

### Why

The Search page showed at most 20 study-note results, and NET has about eight times as many notes
as EMB, so EMB's rarely appeared. Kris asked for pages and a filter for which Bible's notes to
search. Concord's `/v1/notes/search` already took `translation`, `limit` (≤ 100) and `offset` and
returned `total`, in the pinned v1.2.0 too (checked on the server's bundled `songbird-concord-1`:
`total` is there, and a Bible it doesn't hold is a 404). Songbird passed only `q` and returned a
bare list.

### Do the Scripture results have the same cap?

Yes, and nothing changed there. Both modes stop at 20 with no way to see more:
- **Keyword:** the page always sends `limit=20`, and `/api/v1/keyword-search` has no `offset`.
  Concord's `/v1/search` could page (it takes `offset` and returns `total`, which songbird's parse
  model drops).
- **Meaning:** also 20, and Concord's `/v1/semantic-search` has no `offset` at all, so paging it
  needs a Concord change first.
- **Your notes** has no cap.

### What landed

- **API:** `GET /api/v1/study-notes-search?q=&translation=&limit=20&offset=0` returns
  `StudyNotesPageOut {results, total}`, shaped like `PlacesPageOut`.
  - `limit` 1–100 and `offset` ≥ 0 are validated (422).
  - `translation` must look like a Bible code, and is upper-cased.
  - A Concord without `total` makes this page the last.
- **Errors:**
  - A query Concord can't run (FTS5 punctuation) or a Bible it doesn't hold is an empty page.
  - **An unreachable Concord is now a 502**, like keyword search. It used to be swallowed to `[]`
    so the section never showed. Now the section has an empty state, and a swallowed outage would
    read as "nothing matches" (invariant 3).
- **Page** (`SearchView.tsx`):
  - `useInfiniteQuery`, 20 a page, "20 of 242" and **Load more**, the Places/Topics pattern.
  - With two or more notes Bibles, a **From:** row of pill radios (All, then each Bible with its
    `NoteLookSwatch`). On a 390 px phone the three pills fit on one line.
  - Each hit's Bible code wears its look chip.
  - Empty: "No study notes match “q”." / "No EMB notes match “q”.", with the filter still there.
  - Error: "Couldn’t search the study notes (is Concord reachable?)." in the section only.
  - A Concord with no notes at all still hides the section, as before.
- **No screenshot:** study-note results are NET and EMB text.
- **No database change.**

### Gotchas

- **Going back to a filter shows what was loaded there.** TanStack Query keeps each filter's pages,
  so All → EMB → All shows the 40 already loaded under All (refetched in place), not just the
  first 20. Each new query or new filter starts at the first page.
- **Testing Library's `getByText` matches an element's own text nodes,** so a From pill ("EMB",
  beside its swatch) and a hit's Bible chip both matched "EMB". The test now looks inside the
  results list.

### The slice before this, on the server

PR #145 (each Bible's look) was deployed to Kris's server on 2026-10-02: no migration, the live
`index.html` served the new build, and alembic head stayed `0015`. Checked in headless Chromium
against a throwaway container built from the server's image, with its own empty database:
- KJV Malachi 2:16 with EMB and NET ticked: NET's plain violet and EMB's rose squares, at 390 px and
  1280 px, light and dark; an EMB note's chip; the Notes menu and Settings keys.
- Ticking NET on and off five times keeps exactly 3 EMB markers (before the fix: 3 → 10).
- Verse heights match today's violet marker in 4 chapters at both widths, as measured locally.
- No sideways overflow and no page errors.

### How it was verified

- **Backend** (`notes_search_test.py`, 14 tests):
  - the page shape and total;
  - the default request;
  - `translation`, `limit` and `offset` passed through and upper-cased;
  - no total meaning the last page;
  - a blank query makes no call;
  - a 400 is an empty page and an outage a 502;
  - six bad parameters each get a 422.
- **Client** (`concord_client_test.py`): the params sent, `total` parsed, and a 404 as not-found.
- **Frontend** (`SearchView.test.tsx`):
  - 20 at a time through 45 to the end;
  - From EMB asks for EMB from offset 0, and All comes back;
  - both empty messages;
  - an outage is the section's error while Scripture renders;
  - no filter with one notes Bible;
  - a new query keeps the Bible and starts again.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser,** a local build against the LAN Concord with a scratch database:
  - Songbird's totals match Concord's for "grace": 242 for all, 118 for EMB, 124 for NET.
  - Pages don't overlap, and offset 240 returns the last 2.
  - At 390 px and 1280 px, light and dark: Load more (20 → 40 of 242), From EMB (20 of 118, every
    hit EMB), and "No EMB notes match “LXX”." No overflow and no page errors.
  - Pointed at a Concord that isn't there, the API is a 502 and the section shows its error beside
    Scripture's.

---

## v1.8 follow-up 2 — each Bible's notes their own look (and a look at EMB's topics and boxes)

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-note-looks`
- **Spec:** `docs/v1/SPEC.md` §12, "Each notes Bible's look"; a dated note in
  `docs/v1.8/STUDY-BIBLE-SPEC.md` §3.

### Why

With NET's and EMB's notes both showing, every marker was the same small violet number, so there
was no telling whose note was whose. Kris asked for each Bible's notes to have their own look,
working in light and dark and not relying on colour alone, with a key beside each Bible's name.

### A look at EMB's topics and Perspectives boxes (Concord V8-S3b)

Concord gained 50 "What the Bible Says About" topics and 26 "Perspectives" boxes on EMB
(`type: article`). Before any code changed, five were opened on the server's build (PR #144) in a
throwaway container, at 1280 px and 390 px, reading EMB and reading KJV with EMB ticked. Nothing is
quoted here.

**These render as intended:**
- A topic's references each sit on their own line under their quotation (a hard break before the
  link), with the "(" kept beside the reference. All 8 in Genesis 1:18's topic.
- Tapping a reference jumps: within the chapter it highlights the verse, and across books it opens
  the chapter with the verse highlighted.
- Poetic lines start one per line, and stanzas are separate paragraphs.
- A box with no title opens straight onto its passage, with no empty heading row.
- At Malachi 2:16 the markers keep Concord's order. On EMB the textual note is mid-verse (Concord
  anchors it at character 111 of 204), and the topic and the "Men, Women, and God"
  article share the end. On KJV all three gather at the end.
- No page errors and no sideways scroll.

**Songbird's rendering:**
1. **A bug (fixed here): markers multiplied.** On KJV with EMB ticked, each tick or untick of NET at
   Malachi 2:16 left one more copy of EMB's textual-note marker (3 → 6 → 5 → 8 → 7 → 10) until a
   reload. EMB numbers ordinals per kind of note, so the textual note and the topic are both
   ordinal 1; borrowed onto KJV both land at the end of the verse, and their markers shared a React
   key. The key now names the note's type, and any key that still repeats gets a count.
2. **A topic's title and its subheads look alike:** all are bold lines at body size (the known `##`
   and `###` problem).
3. **Long poetic lines wrap in the 288 px box,** and the wrapped part starts flush left, so it reads
   like an extra line of poetry.
4. **Adjacent markers run together** (2 Corinthians 9:9 reads as "¹²"). EMB's squares now separate
   EMB's own; two plain NET markers side by side still run together.
5. After a reference jump the address bar keeps the old chapter, so a reload goes back. This was
   already the reader's behaviour.

Items 2–4 are input for the later slice on the reading surface, with the five from the first look.

**Concord's text:**
- A box's reference is in capitals with no parentheses, where topics write "(Genesis 1:14)".
- A box's passage, saying and attribution are three plain paragraphs. Nothing marks the last as an
  attribution, and its capitals (stored as capitals) read loud.
- 2 Corinthians 9:9's two-line saying is stored as two paragraphs (a blank line between), where the
  topics use line breaks for poetry. So it renders as two paragraphs.
- 2 Corinthians 9:9's box carries `passages` ("Covers …") and Exodus 24:3's doesn't.

### What landed

- **`lib/noteLooks.ts`:** each look is a colour and a shape. NET and EMB are pinned; any other
  notes source takes the next spare look in Concord's order, so a new Bible needs no code.

  | Bible | Light | Dark | Shape | Contrast, light / dark |
  |---|---|---|---|---|
  | NET | violet-600 | violet-400 | plain number (unchanged) | 5.1–5.7 / 5.4–6.5 |
  | EMB | rose-700 | rose-400 | square outline | 5.6–6.3 / 5.5–6.6 |
  | 3rd source | teal-700 | teal-300 | round outline | 4.9–5.5 / 9.9–12.0 |
  | 4th source | fuchsia-700 | fuchsia-300 | tinted fill | 5.4 on its fill / 5.9–7.2 |

  Contrast is measured against the page (stone-50 / gray-900), the cream verse highlight
  (amber-100 / the dark lift) and the popover (white / gray-800). Amber (your notes), emerald
  (sermons) and blue (verse numbers, links) were ruled out.
- **Where it shows:** the marker; the note view, where the Bible's code is a chip in the pinned row
  and the kind line takes the Bible's colour; and a sample marker (`NoteLookSwatch`) beside each
  Bible in the Notes menu and on Settings. The look follows the Bible: reading EMB, its own notes
  are rose squares.
- **Unchanged:** NET's markers, the marker's size and tap target, the article/footnote treatment
  (still identical), the note box and the headings.
- **`capture.mjs`:** no change; `settings.png` was retaken and shows the key (codes and names only).
- **No database change.**

### Gotchas

- **A `border` on a superscript marker made its line 1–2 px taller.** Removing the border and
  keeping the padding measured identical to a plain marker, so the outline is a `ring` (an inset
  box-shadow), which takes no room.
- **The ring first hugged the whole line,** a tall thin box, because a `<button>` is an inline-block
  with the verse's 32 px line height. `leading-none` fixed the box but shrank the tap target to
  about 13 px. The shape now sits on a span inside the button, and the button keeps today's
  classes exactly.
- **Measured against today's violet marker** on KJV Genesis 1, Malachi 2, Proverbs 10 and
  2 Corinthians 9 (EMB and NET ticked), at both widths: no verse is taller. In 3 of 248 verse
  renders the square's 0.4 em of padding moved a line break by a word, which moves where the
  existing superscript bump falls (5 px); removing the padding alone reproduces exactly those 3.
- **Testing Library's `getByLabelText` reads `aria-hidden` text,** so the swatch's "1" broke
  "Show EMB notes". The Notes menu's checkboxes now carry an explicit `aria-label`; the Settings
  test helper drops `aria-hidden` nodes.

### How it was verified

- **New `lib/noteLooks.test.ts`:** the pinned looks, the 3rd and 4th, stability when a source sorts
  earlier, the repeat, the fallback, a distinct colour and shape per look, rings not borders, and a
  dark partner for every light colour.
- **`VerseText.test.tsx`:** an own and a borrowed marker carry different looks on the same button
  classes; two same-ordinal notes at one spot stay one marker each through eight re-renders (it
  showed 10 markers before the fix). **`verseSegments.test.ts`:** distinct keys for that shape and
  for a full repeat.
- **`NotePopover.test.tsx`:** the chip for an own note and a borrowed one.
- **`ReaderView.test.tsx`:** reading KJV (a third source in the fixture) with EMB and NET ticked,
  the markers are teal, rose and violet, and the opened EMB note's chip is rose; the Notes menu's
  key. **`SettingsView.test.tsx`:** the key on every row and the new line.
- **The gate:** `make check` and `make check-frontend` green (counts in the PR).
- **In a browser:** headless Chromium against a local build pointed at the LAN Concord, with a
  scratch database, at 390 px and 1280 px, light and dark: Malachi 2:16, an EMB note opened, the
  Notes menu and Settings. No sideways overflow and no page errors.

---

## v1.8 follow-up — a Settings page (and a first look at the articles)

- **Date:** 2026-10-02
- **Branch:** `slice/v1.8-settings-page`
- **Spec:** `docs/v1/SPEC.md` §12, "Settings page"; a dated note in `docs/v1.8/STUDY-BIBLE-SPEC.md`
  §3.

### Why

The top of the screen had grown crowded: on a phone the reader's header ran to eight lines. Kris
asked for one Settings page holding the "Show … notes" checkboxes, the light/dark switch, Sources
and Status, reached from a single Settings link.

### What landed

- **`/settings`** (`routes/SettingsView.tsx`):
  - Every notes source, always, whatever is being read, with one line saying what a tick does.
  - Light / Dark / Match this device. The profile already stored `system` as the default, but the
    old two-way switch could never get back to it.
  - Links to Sermon sources and Status.
- **Choices taken** (the plan's defaults; Kris didn't pick):
  - Sermon sources and Status stay their own pages, each with a "‹ Settings" link back. The top
    bar's Settings link is highlighted on all three pages.
  - The reader keeps a compact **Notes ▾** menu beside Places and Map: the same ticks, two taps
    away, and "All settings ›".
  - Your name and Log out stay in the top bar.
- **Shared pieces:**
  - `hooks/useShowNotesFrom.ts`: the optimistic tick with rollback, moved out of the reader.
  - `ME_KEY` is exported from `useAuth`, so `["auth","me"]` is spelled once.
  - `useThemeControl().setTheme` now updates the cached profile at once, so the Settings options
    follow the click.
- **An outage is an error, not an empty list.** When `/translations` fails, Settings and the
  reader's Notes menu both say "Couldn't load the Bibles from Concord". The old checkboxes just
  vanished, one of the ways the "Show EMB notes" box could disappear (see the fix entry below).
- **`capture.mjs`** gains a `settings` shot (`SETTINGS_ONLY=1` takes just that one).
  `reader-dark.png` now chooses Dark on Settings, since the top-bar switch is gone.
- **No database change.** `show_notes_from` and `theme` were already on `users`.

### The top bar, measured

On the reader (KJV Genesis 41), in headless Chromium:

| Width | Before (the server's build) | After |
|---|---|---|
| Phone (390 px) | 323 px | 295 px |
| Desktop (1280 px) | 210 px | 182 px |

On a phone the Notes button wraps under the chapter title. That line scrolls away with the
chapter, unlike the header.

### Gotchas

- **The Status page has its own `<header>`**, holding the new back link. A test selector that
  meant the top bar should use the `banner` role, not the `header` tag.
- **A radio bound to the cached profile shows checked one tick after the click**, the same
  TanStack Query delay A2 recorded for the checkbox. Playwright's `check()` fails on it, so scripts
  click and then wait for `checked`.
- **The Status-crash tests asserted the reader's checkbox**, which moved. They now assert the Notes
  button, which is built from the same cached list.

### The fix before this, on the server

PR #143 was deployed to Kris's server on 2026-10-02: no migration, and the live `index.html`
served the new build. Checked in headless Chromium against a throwaway container built from the
server's image, with its own empty database and account:
- Reader → Status, Status → Reader, Compare ↔ Status and Search ↔ Status all work, with no page
  errors.
- Reading KJV offers EMB and NET; EMB offers NET only; NET offers EMB only.

### A first look at EMB's articles (Concord V8-S3a)

A read-only sweep of EMB's notes found **219 articles**:
- 101 "Men, Women, and God", 94 "Someone You Should Know", 24 "Personal Gold".
- 185–601 words each.
- 94 open with a `##` heading; one (Job 4:1) uses `###`.
- 119 have block quotes and 17 have lists.
- Two (Genesis 35:21, Daniel 1:6) use backslash line breaks, and three (Matthew 26:8, Acts 5:33,
  Acts 12:20) use superscript footnote marks.
- None has raw HTML or a non-`ref:` link.

Opened in the reader at desktop and phone width, on EMB and borrowed onto KJV. Nothing is quoted
here.

**These render as intended:**
- the label as the kind line, the title, "Covers …";
- "From EMB" when borrowed;
- `##` headings, block quotes (dialogue lines stay separate), numbered lists;
- poetry with hard breaks, line by line;
- superscript footnote marks and their footnote lines;
- `ref:` links as jump buttons.

The close button stays pinned while scrolling. No raw Markdown leaks, there's no sideways
overflow, and there were no page errors.

**What's wrong is songbird's rendering. Nothing was fixed here; this is input for the "bigger
reading surface" the spec deferred until the articles arrived.**

1. **The popover's window is often small.** `Popover` opens below the marker whenever there's
   160 px below it, even with far more above. An article tapped low on the screen gets a
   190–220 px window: 4–10 boxfuls of scrolling (Genesis 35:21 on a phone took 10). Tapped near the
   top, the same article gets 520–730 px.
2. **The popover is 288 px wide** (`w-72`) for up to 600 words: about 35 characters a line on a
   desktop. On a phone it leaves verse text showing down both sides.
3. **The article's marker is the same small violet number as a one-line footnote.** Nothing says
   a 400-word feature is there.
4. **`##` and `###` render alike**, as body-size bold, which is also how the articles' bold lead-ins
   and "THE POINT:" closers look. Job 4:1's subheadings lose their place under its heading.
5. **A reference link can break away from its bracket** ("(" at a line end, "1 Corinthians 6:18)"
   on the next line), because a link is a button and wraps as one block.

**From Concord's text** (minor):
- A footnote's line sits where the source put it, sometimes just before the article's closing
  line (Acts 12:20).
- One footnote has no space after its mark where the others do.

---

## v1.8 fix — the Status page crash (one cache key, one shape)

- **Date:** 2026-10-02
- **Branch:** `fix/v1.8-status-crash`

### Why

On Kris's server, opening Status from the reader showed "Unexpected Application Error! Cannot read
properties of undefined (reading 'map')". Status had its own `fetchTranslations`, which returned
Concord's whole response (`{translations: [...]}`). The reader, Compare and Search use
`lib/reader.ts`'s, which returns the bare list. All four use the key `["translations"]`, so
whichever page loaded first decided the shape the next one read:

- Reader, Compare or Search, then Status: Status read `.translations` of a list.
- Status, then the reader or Search: `noteSources()` was handed an object ("translations.some is
  not a function"). Compare crashed the same way on `.map`.

The first direction is older than v1.8 (the same code is at 9e3aeb6). v1.8's `noteSources()` added
the second.

### What landed

- **`translationsOptions`** in `lib/reader.ts`: TanStack Query's `queryOptions` holding the key
  and its fetcher together. All four pages call `useQuery(translationsOptions)`, and Status maps
  the bare list. A page can no longer pair the key with a different fetcher by accident.
- **`routes/translationsCache.test.tsx`** moves between the real pages on one shared `QueryClient`
  with the app's own cache settings, through `createMemoryRouter` and `router.navigate`: Reader →
  Status, Status → Reader, Compare → Status → Compare, Search → Status → Search, Status → Search.
  All five failed before the fix with the two errors above. They don't click the top bar, so they
  survive the top bar changing.
- **Logout now drops every cached query except the signed-in user**, and so do login and register.
  See the check below.

### The check of every other query key

Every `queryKey`, `useQueries`, `setQueryData` and `getQueryData` in `frontend/src`:

| Key | Used in | Fetcher | Verdict |
|---|---|---|---|
| `["translations"]` | Reader, Compare, Search, Status | two fetchers, two shapes | **the bug** |
| `["books"]` | Reader, Compare, Search, Browse, Welcome | `fetchBooks` | one shape |
| `["tags"]` | Reader, Browse, Welcome, Sources | `fetchTags` | one shape |
| `["chapter", t, book, ch]` | Reader (own + borrowed), Compare | `fetchChapter` | one shape |
| `["notes", t, book, ch]` | Reader (own + borrowed) | `fetchNotes` | one shape |
| `["places", book, ch]` | Reader, Geography, MapView | `fetchPlaces` | one shape |
| `["place-verses", id]` | Geography, MapView, PlaceDetail | `fetchPlaceVerses` | one shape |
| `["browse", tags]`, `["browse-sermon", tags]` | Browse, Welcome | same fetcher, same arguments | one shape |
| `["auth", "me"]` | `useAuth` (query); `useTheme` and the reader (writes) | `User` or `null` | one shape |
| the other 24 | one place each, including both infinite queries | — | fine |

No other key had the fault. The check found a different one:

- **Logout left the last person's notes in the cache.** Annotations and sermon notes are
  author-scoped, but logout removed only `["chapter"]`, `["tags"]` and `["annotations"]` (a key no
  query uses). `["browse"]`, `["browse-sermon"]`, `["note-search"]` and the Sources lists survived.
  The next person to sign in on the same tab saw the previous person's notes on Home and Browse,
  served straight from the cache for 30 seconds (the app's `staleTime`), then until the refetch
  landed. `useAuth` now removes every query whose key doesn't start with `"auth"`, on logout,
  login and register.

### The "Show EMB notes" box Kris saw disappear

Three ways it can go, none of them the crash (which breaks the page instead):

- **By design**, while EMB is the translation being read.
- **If `/translations` fails when the reader mounts**, `noteSources([])` offers nothing and the
  Translation menu falls back to the one translation being read, with no message. Changing chapter
  doesn't remount the reader, so it stays that way until the reader is opened again. Concord on
  the server restarted about 6 hours before this was written (the article load), which would do
  it. The Settings page that follows shows an error here instead of an empty list.
- **A Concord without `note_count`** offers NET alone.

### Gotchas

- **`translationsOptions`, not `translationsQuery`.** Three pages already name their
  `useQuery` result `translationsQuery`, so an export of that name would shadow it.
- **The new user reaches `useAuth` one tick after `setQueryData`**, the same TanStack Query
  notification delay A2 noted for the checkbox. The login test waits for it.

### How it was verified

- The new tests failed first, with the exact errors from the server, then passed.
- `make check`: 550 passed. `make check-frontend`: 418 passed across 46 files; eslint, tsc and
  the build clean.

---

## v1.8 slice A2 — notes from any source

- **Date:** 2026-10-01
- **Branch:** `slice/v1.8-a2-notes-from-any-source` (stacked on A1)
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §3 ("Sources" and "Borrowing"); decision in
  [ADR 0005](adr/0005-borrow-notes-from-any-source.md).

### Why

ADR 0004 built "Show NET notes" for the one translation that had notes, and said generalising it
would take "a small migration and a source picker". Concord v8 now reports `note_count` per
translation, and a study Bible (EMB) has notes of its own. This is that generalisation.

### What landed

- **Sources:** `noteSources()` returns every translation with `note_count > 0`, in Concord's order.
  Against a Concord without `note_count`, it returns NET alone when offered.
- **One checkbox per source**, hidden while that source is being read.
- **The preference** is now `users.show_notes_from`, a JSON list using the same pattern as
  `sermon_source_videos.suggestions`.
  - Migration 0015 turns `show_net_notes = 1` into `["NET"]` and drops the boolean.
  - `PATCH /auth/me` takes the whole list, upper-cased and de-duplicated, at most 32 codes of 1–16
    characters.
- **Borrowing** uses `useQueries` with two module-level combiners: one for each source's notes,
  one for its chapter text. Their stable identity lets TanStack Query hand back the same combined
  result while nothing has changed, so the per-verse merge doesn't recompute on every render.
- **Order at one spot** comes from `borrowed.rank`, the source's checkbox index. Marker keys now
  name their source, because two sources' ordinals can collide.
- **The popover** reads "From EMB" / "From NET", the code on the checkbox. Before, it read "From
  the NET Bible".

### Gotchas

- **An earlier migration seeds a user named `default`**, so a migration test that inserts users by
  id collides with it. The test identifies its own rows by name.
- **The migration test runs Alembic in a subprocess.** Alembic's `env.py` calls `fileConfig()` and
  reads songbird's cached settings; in-process, both would leak into the rest of the suite.
- **The checkbox shows ticked one tick after the click**, not during it. The cached user is updated
  at once, but TanStack Query notifies React on the next tick, so Playwright's `check()` reports
  "did not change its state". No person can see the delay, and the NET slice behaved the same.
  Browser scripts should click, then wait for the checked state.

### How it was verified

- `make check`: 550 passed. That includes migration 0015 run for real on a scratch database:
  0014 → head → 0014 → head, with NET on, NET off, `["EMB", "NET"]`, `["EMB"]` and a new profile.
- `make check-frontend`: 411 passed across 45 files; eslint, tsc and the build clean.
- **Today's behavior against a Concord without the new fields, in a browser** (headless Chromium
  through the real UI, a throwaway account and database):
  - *The pinned `concord:v1.2.0` image*, in a throwaway container: no notes checkboxes (it has no
    NET), no markers, no notes notice, Search unchanged, no page errors.
  - *The live LAN Concord, still pre-v8* (EMB's text loaded, NET's notes present, no
    `note_count`):
    - only "Show NET notes" is offered, and EMB is not a source;
    - ticking it puts 71 NET markers on KJV John 3 and saves `["NET"]`;
    - reading NET shows its own notes with no checkbox, and "Show NET notes" works on EMB too;
    - Search badges by type and names no Bible;
    - no page errors.

    The only visible change is the intended "From NET · NET reads …".

---

## v1.8 slice A1 — the note view (a study Bible's notes, shown properly)

- **Date:** 2026-10-01
- **Branch:** `slice/v1.8-a1-note-view`
- **Spec:** `docs/v1.8/STUDY-BIBLE-SPEC.md` §3 ("The note view" and "Search"). Slice A ships as two
  PRs; A2 (notes from any source: the per-source checkboxes, the preference list and its
  migration, ADR 0005) is stacked on this one.

### Why

Concord v8 is loading the Every Man's Bible's notes with fields NET never needed (Concord
ADR-0011): a label for the kind of note, a title, the passages it covers, and Markdown text with
`ref:` links. songbird already showed EMB's text; this makes its notes readable.

### What landed

- **The backend would have dropped every new field.** songbird validates Concord's notes into
  `concord/schemas.py` (Pydantic ignores unknown keys) and re-maps them field by field into
  `api/schemas.py`. Both layers now carry `label`, `title`, `text_format`, `passages` on notes,
  `label` and `text_format` on search hits, and `note_count` on translations. `text_format` is a
  plain string, not a `Literal["markdown"]`: an unknown future value must not fail a whole
  chapter's notes; the client treats only `"markdown"` as Markdown. `image` isn't modelled until
  slice B gives it a value.
- **Markdown is parsed, never injected.** markdown-it (`html: false`, `linkify: false`) turns the
  text into tokens and `NoteMarkdown.tsx` walks them into React elements. Raw HTML stays literal
  text, bare URLs stay text, and only a well-formed `ref:` link becomes a (button) link.
- **Not a new dependency in practice.** markdown-it 14.2.0 was already installed and already in the
  main chunk via the note editor's tiptap-markdown. It's now declared, with `@types/markdown-it`, at
  the installed versions. The main chunk went from 2,010.48 kB to 2,015.00 kB (+1.25 kB gzipped),
  all of it this slice's own code.
- **`ref:` targets are parsed to ADR-0011's grammar exactly**, backwards ranges rejected. A range
  jumps to its start and a chapter opens at its top, via the reader's existing `navigate`.
- **Search** badges a hit with its `label`, names the translation when more than one has notes
  (`noteSources()`: `note_count > 0`, or NET alone against an older Concord), and strips Markdown
  from snippets with regexes that keep `<mark>` and cope with links cut off at either edge (Concord
  cuts snippets from the raw Markdown).

### Gotchas

- **Prettier isn't enforced in this repo**: 42 files on `main` already differ from it. Only the
  files this slice created were formatted, so existing files carry no unrelated reformatting.
- **Study-note search rows were keyed by book/chapter/verse/translation/type.** A study Bible can
  have two notes of one kind on a verse, so the row index joined the key.
- `npm install` synced `package-lock.json`'s stale root version (0.1.0) to `package.json`'s 1.7.0.
  It wasn't one of the values release prep deliberately leaves alone.

### How it was verified

- `make check`: 546 passed (ruff, format check, pyright strict clean).
- `make check-frontend`: 401 passed across 45 files; eslint, tsc and the build clean.
- **Today's behavior against an older Concord**: the backend tests feed raw pre-v8 JSON through the
  real client and check that every field songbird sent before is unchanged and the new ones are
  null or `[]`. The frontend tests render pre-v8 notes and search hits (no `label`, no
  `text_format`) and check they look exactly as before. Every existing fixture lacks the new
  fields, and every existing test still passes unchanged.

---

## Release prep v1.7.0 — version reconciliation + CHANGELOG (Stop 1 of a two-stop release)

- **Date:** 2026-09-07
- **Branch:** `slice/release-1.7.0-prep`

### Why

v1.7 Sermon Sources is complete — six slices, plus the numeric-date fix and two compose fixes — but
the package versions still read `1.6.0` and everything since the 1.6.0 release was still sitting
under `## [Unreleased]`. This reconciles the drift and closes the changelog block, so the tag in Stop
2 has something honest to point at.

### The version is single-sourced

Unchanged since the 1.6.0 prep: `backend/songbird/__init__.py`'s `__version__` is the one source of
truth for the *served* version — `main.py` passes it to `FastAPI(version=__version__)` (so the
OpenAPI `info.version` follows) and `health.py` returns it on `/healthz`. Four files declare the
literal:

- `backend/pyproject.toml` → `1.7.0`
- `backend/songbird/__init__.py` (`__version__`) → `1.7.0`  *(drives FastAPI/OpenAPI + `/healthz`)*
- `frontend/package.json` → `1.7.0`
- `frontend/src/test/msw/handlers.ts` (the `/healthz` mock) → `1.7.0` *(fixture realism; no test
  asserts the literal — `health_test.py` only checks it's a `str`)*

**No fifth site has crept in since 1.6.0.** The version-looking values that entry listed as
deliberately untouched are untouched again, for the same reasons: the screenshot tool's own `1.0.0`,
the export-bundle **data-format** `version` in `schemas.ts` / `api/schemas.py`, MapLibre's
`version: 8` style-spec number, and `concord_contract_test.py`'s `"1.2.0"` — which is **Concord's**
pinned OpenAPI version, not songbird's.

### What's in the release

Sermon sources end to end (slices 1–6: the YouTube client and settings, the Sources page, re-dating,
the scan and the ledger, the review list, the schedule and the guide), the numeric-date fix that
stopped `John 06-25-2020` being read as sixteen chapters, and **two compose fixes** — `CONCORD_BASE_URL`
being ignored in favour of a bundled engine, and `PORT` being ignored entirely. The dark-mode
highlight and multi-note fixes carried over from before v1.7 started ship here too, since 1.6.0 was
tagged before them.

### The `PORT` entry was missing, and finding out why took a `git log -S`

`PORT=8077` has been in `.env.example` since the original scaffold commit, so it *looks* like old
news that shipped long ago. It isn't: `docker-compose.yml` hardcoded `"8077:8077"` until
`234d70a fix(compose): take songbird's published port from PORT`, which is **after `v1.6.0`**. So
setting `PORT` did nothing at all until this release, and it belongs in 1.7.0's Fixed list. The
README's "port won't load" troubleshooting still told people to go stop the other program; it now
tells them to set `PORT` instead.

The lesson for the next release prep: **a setting's presence in `.env.example` says nothing about
when it started working.** Check the file that consumes it, not the file that documents it.

### The README's spec index needed nothing

The brief expected `docs/v1.7/SERMON-SOURCES-SPEC.md` to be missing from a list in the README. There
is no such list any more — Docs Slice 5 replaced it with a generic pointer ("then the per-feature
specs under `docs/`"), which cannot go stale. The enumerated index lives in `docs/v1/SPEC.md` §12,
and slice 6 already added v1.7 to it. Nothing to fix; worth recording so the next release doesn't go
looking for it either.

### Two-stop release

This PR is **files only** (versions + `CHANGELOG.md` + README troubleshooting + this entry) and
leaves both gates green. The **tag and GitHub Release are Stop 2** — presented for explicit
authorization *after* this PR merges, run from a freshly pulled `main`. The tag is never pushed in
the same breath as the PR.

### Verified

- `grep -rn "1\.6\.0"` (deps/locks excluded) → only CHANGELOG history and this file's 1.6.0 entry;
  the four bumped sites read `1.7.0`.
- `make check` → green. `make check-frontend` → green. The bump, including the `/healthz` mock, broke
  no test.
- The finished `[1.7.0]` block read top to bottom as its audience, not as its author.

### Still open

- **`docs/v1/SPEC.md` §12 still has no v1.6 paragraph** — the section says so itself. Carried over
  from slice 6; still not this slice's job.
- **`frontend/src/lib/schedule.ts:46` renders "use Check now"** where the button it means is labelled
  **Check all now** (`SermonSourcesView.tsx:413`). A one-word product-string nit that would touch a
  shipped test and a committed screenshot, so it was named rather than fixed during release prep.

---

## Sermon sources slice 6 — the schedule, and the documentation

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-6-schedule-docs`

### Why

Two things were left. `SERMON_CHECK_INTERVAL_HOURS` had been declared since slice 1 and **read by
nothing** — songbird only ever checked when a button was pressed. And nobody but Kris could set the
feature up at all, because getting a YouTube key is a seven-screen trip through Google's Cloud
console that no page in this repo described.

### What landed

- **`sermons/schedule.py`** — `ScheduledCheck`, built like `ScanRunner` and owning no scan logic. It
  stamps `check_requested_at` on every enabled source and calls `request_scan()`. A timer that made
  its own task would step around the one guard that stops two scans, so it makes none.
- **Boot catch-up**, which is what makes a weekly interval survive a nightly reboot. The two rules
  differ on purpose: at boot, fire only if something is genuinely overdue; on the interval, stamp
  everything, because the interval elapsing is itself the event.
- **`/status`** gains `interval_hours`, `timer_enabled`, `last_scheduled_run_at`,
  `next_scheduled_run_at`; the page turns them into one line.
- **`docker-compose.yml`** finally passes the two sermon settings through — see the gotcha below.
- **The User's Guide** gains its section, with the key walkthrough and three screenshots. **README**
  and **SECURITY.md** and the **Dockerfile** comment stop claiming Concord is the only outbound call.
- **`v1/SPEC.md` §12** gains its v1.7 paragraph and loses its "no new tables" claim.

### Gotchas

- **A mutation harness with no baseline gate reports every mutant as killed.** The frontend pass
  came back 7/7 on the first run and all seven were lies: `npx vitest` resolved a cached vitest from
  `~/.npm/_npx`, which could not find `happy-dom`, so *every* run failed identically — mutated or
  not. It now runs the project's own `node_modules/.bin/vitest` and **asserts the unmutated tree is
  green before it mutates anything**. A mutation result is only worth what the baseline is worth.
- **`docker-compose.yml` has no `env_file:`.** The pass-through is compose interpolating `${VAR}`
  from the repo-root `.env`, which means a variable absent from the `environment:` block reaches
  nothing at all — `SERMON_CHECK_INTERVAL_HOURS` and `SERMON_MIN_MINUTES` had been documented in
  `.env.example` and silently ignored since slice 1. Check with `docker compose config --no-interpolate`
  — **always with that flag**, because the plain form prints the real key.
- **A `fullPage` screenshot of a page with a 352-row ledger is 24,644 pixels tall and 3.6MB.**
  Useless as a guide image and a silly thing to commit. Viewport-framed now.
- **Playwright `selectOption({label})` breaks on a label carrying a count** — the state options read
  "Needs a passage (352)". Select by value.
- **A dev instance serves the API only** unless `FRONTEND_DIST_DIR` points at a built SPA, so the
  screenshot harness cannot even find the login form. Build once, point all three instances at it.
- SQLite still hands `DateTime(timezone=True)` back **naive**, so dueness is a pure function that
  normalises before comparing. Comparing straight against `datetime.now(UTC)` is a `TypeError`.

### How it was verified

`make check` **535 passed**, Ruff, format and Pyright-strict clean; `make check-frontend` **326
passed** across 42 files, ESLint, tsc and build clean.

**Mutation testing, 17/17 killed** — 10 on the timer (the `<=` boundary, never-checked-is-due, the
naive normalisation, the interval-0 guard, both `enabled` restrictions, the unconditional catch-up,
the missing commit, the runner never being told, and `next_run_at` before the first sleep) and 7 on
the status line. Both passes ran in a **throwaway `git worktree`**, source committed first.

**Live acceptance** against the real key and a dockerised Concord, one source
(`@majesticviewchurchlive407`), four checks:

1. `SERMON_CHECK_INTERVAL_HOURS=1` — the line reads as specified and `next_scheduled_run_at` is
   59.8 minutes out.
2. `last_checked_at` wound back two days directly in the dev database, restart — boot catch-up
   fired, logged `scheduled check: 1 source(s) queued`, and the source came back `ok`.
3. `SERMON_CHECK_INTERVAL_HOURS=0`, 30 days overdue — **nothing ran**, `check_requested_at` still
   null, and `POST /check` still answered `202 {queued: 1}`.
4. `docker compose config --no-interpolate` — all three variables pass through, key unexpanded.

**A bonus the scan itself reported:** the clean run came back **12 placed / 352 needs a passage / 7
skipped**, where slice 5 got 13/351/7. The one that moved is
`MVC - Talking About Respect with Pastor John 06-25-2020` — PR #133's numeric-date fix, confirmed on
live data, with no `John 6-25` note anywhere in the database.

**Secrets:** zero key-shaped tokens across every server log, and 23 confirmed `key=REDACTED` lines
proving the filter is doing it. The only `AIza` strings in the tree are the same all-zeros fixture
in two test files.

**Browser pass** on `inspect-sources.mjs` across **three** instances (normal, keyless, zero
interval), 76 shots, light and dark, 1440px and 390px. Then a focused check with contrast measured,
not eyeballed: the schedule line **7.24:1** light and **12.04:1** dark, the new guide link 6.42:1 /
6.98:1, both line states correct in every combination, no schedule line at all without a key, and
phone `scrollWidth` 390 on all three instances.

**Closed an open item from slice 2:** a truly absent `YOUTUBE_API_KEY` on a machine that has a
`.env` had never been exercised. Passing `YOUTUBE_API_KEY=` as an environment variable overrides the
`.env` value, and that instance boots `sermon sources: off (no YOUTUBE_API_KEY)` with no timer.

### Still open

- **`v1/SPEC.md` §12 has no v1.6 paragraph** — headings, topics, word study and journeys shipped
  without one. Slice 6 says so in the spec rather than leaving the gap looking deliberate, but
  writing it is somebody's next small job.
- A contrast harness has now been written from scratch four slices running. Promoting it to
  `scripts/screenshots/` is still worth doing and still not this slice's job.
- `capture.mjs` registers-then-signs-in while `inspect-sources.mjs` signs-in-then-registers. Both
  work — capture's fallback covers the fresh instance — so they were left alone, but one order
  would be better than two.

---

## Sermon sources slice 5 — the review list

- **Date:** 2026-09-07
- **Branch:** `slice/sermon-sources-5-review`

### Why

Slice 4b shipped the scan and left **~970 videos in `needs_passage` across four channels** — mostly
dated livestreams whose text never names a passage. That list was read-only. This slice makes it
work, and the design constraint is that number: hundreds of rows, worked through over months, not a
handful.

### What landed

- **`api/_sermon_ledger.py`** — one WHERE builder for the listing and the bulk dismiss. They must
  not be able to disagree about what a filter selects, or a sweep would take rows nobody saw.
- **`sermons/notes.py`** — `build_sermon_note`, used by both the scan and the review list, so a note
  tapped into place is the note a rule would have made. **`api/_anchors.py`** — the Concord-to-HTTP
  shims, so a reference that will not resolve fails identically wherever it was typed.
- **`api/sermon_review.py`** — place / dismiss / restore / reopen, plus `dismiss-matching`, plus
  `reopen_if_last_note`, which the sermon-note DELETE calls.
- **The listing** gains `published_after`, `published_before`, `q`, and per-state `counts`.
- **The UI**: filter bar with counts, one-tap chips, a reference box, per-row undo, and the bulk
  confirm. A row that is acted on **stays where it is** and grows its undo; the cache is patched
  rather than invalidated, so the reader keeps their place among hundreds.
- **No migration.** `dismissed` and `manual` were already legal in their `String(24)` columns.

### The ten minutes, and the six things it found

The point of the exercise, and it earned its keep. Working the real Majestic View list:

1. **Choosing "Needs a passage" put "Dismiss all 349 matching" on screen** — a one-confirm sweep of
   the entire untouched queue, offered by the first thing anybody does. A state is no longer a
   narrowing on its own; the sweep needs a source, a date or a search.
2. The source card above kept its own tallies and went stale — **"350 needs a passage" over a filter
   bar reading 349**. A row change refreshes them now.
3. The bulk confirm had **two headings**, the Modal's and its own, with the one that mattered
   underneath.
4. It read **"up to 2021-12-31"** over rows all saying "Dec 26, 2021".
5. A misspelling answered in the server's words: *"Couldn't find reference 'Jhon 3:16': Concord could
   not resolve 'Jhon 3:16'"* — the reference twice, and a sentence about Concord.
6. At phone width **six filter controls pushed every row below the fold**, on the page most likely to
   be opened on a phone. Dates and search fold away now, and say so when one is still on.

Nothing here was visible from reading the code.

### Gotchas

- **A bulk `delete()` orphans a many-to-many.** "Wrong passage" deleted its notes with
  `delete(SermonNote).where(…)`, leaving the `sermon_note_tags` rows behind — SQLite never enforces
  `ON DELETE CASCADE`, because `PRAGMA foreign_keys` is off and songbird never turns it on. SQLite
  then **reuses the deleted note's id**, and the next note handed that id collided on (note, tag) and
  **took a whole catalogue scan down ten videos in**. Loaded and deleted through the ORM now. The
  test that missed it counted notes; the new one looks at the join table.
- **`git checkout --` in a mutation harness will eat an uncommitted fix.** It ate this one: the fix
  was written, tested, then reverted by the harness's cleanup, and committed in its reverted state.
  Caught by re-running the gate. This is the third slice to record the same lesson — **commit before
  mutating** is not advice, it is a precondition.
- **`pkill -f` kills its own shell.** Fourth time. `ss -lptnH "sport = :8099" | grep -oP 'pid=\K[0-9]+'`
  is the way to stop a dev server.
- A Playwright **locator re-resolves lazily**: "the first row with chips" points somewhere else the
  moment a row is placed. Find the card by title.
- `uvicorn` needs `--factory` here: `songbird.main` exposes `create_app`, not `app`.

### How it was verified

`make check` **514 passed**, Ruff and Pyright-strict clean; `make check-frontend` **316 passed**
across 41 files, ESLint, tsc and build clean.

**Mutation testing, 26/26 killed.** 20 on the backend — the shared undo rule, the state guard, the
`placed`-exclusion in the sweep, the empty-filter refusal, the sibling count in auto-reopen, the
scoping, the date edges, the search escaping — and 6 on the cache patcher. One survivor, on the
title search: deleting `autoescape=True` changed nothing because the fixture had no title a wildcard
would reach and an escaped one would not. A title containing "100" as a prefix closes it.

**Live acceptance** against the real key and a dockerised Concord, one source
(`@majesticviewchurchlive407`), ~33 quota units over two scans. The clean scan reproduced slice 4b
exactly — **13 placed, 351 needs a passage, 7 skipped**, `last_check_status: ok`. Then the list was
worked for real: three placed from their own suggestions, one typed by hand (misspelled first, on
purpose, to see what it said), **94 dismissed in one sweep by date**, and the known-wrong anchor from
slice 4b — `MVC - Talking About Respect with Pastor John 06-25-2020` → `John 6-25`, sixteen chapters
— reopened, with the reader confirmed clear of it afterwards. Zero orphaned join rows, zero
tracebacks, zero key-shaped tokens in the logs, every URL redacted. Test data deleted afterwards.

**Browser pass** on `inspect-sources.mjs`, extended with the review states — dismissed rows, the
reopen confirm, the folded filters, the bulk dialog — light and dark, 1440px and 390px. Phone
`scrollWidth` 390: nothing overflows. **Contrast measured, not eyeballed**: selected chip 6.70:1 both
themes, unselected 10.31:1 light / 11.86:1 dark, row title 17.74:1 / 13.34:1, the grey facts line
4.83:1 / 5.78:1, Place 5.48:1. One failure, and it was **pre-existing since slice 4a**: the filter
selects inherited their label's `text-gray-500` and measured **4.20:1** against the grey the browser
paints behind them. They carry their own colour now — 15.43:1. Same class of mistake as #122.

### Still open

- The `MM-DD-YYYY` date collision (spec §13) is still unfixed — this slice gives it a one-tap cure
  rather than a prevention. Extending §7's date guard to a bare `N-N` span followed by `-NNNN` would
  catch it, and that is still Kris's call.
- A contrast harness has now been written from scratch three slices running. It is worth promoting
  to `scripts/screenshots/` next to `inspect-sources.mjs`, but that is not this slice's job.

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
- **Live, against all three real states**, running uvicorn with a throwaway `DATA_DIR`:
  - *Right Concord* — `CONCORD_BASE_URL=http://192.168.1.62:8000` → `reachable: true`,
    **19 translations**, `translation_ids` carrying ESV, NET, NKJV, NLT.
  - *Wrong but healthy* — a throwaway `ghcr.io/kbennett2000/concord:v1.2.0` on `:8100`, which is
    the incident exactly → `reachable: true`, `status: "ok"`, **15 translations**, and the four
    licensed ones absent. Nothing errors; the corpus is the only tell. This is the state the
    change exists to make readable, and it now reads as
    `Concord corpus: 15 translations (AKJV, ASV, BSB, …)` at boot.
  - *Unreachable* — pointed at a stopped container → `reachable: false`,
    `translation_ids: null`, a `WARNING Concord not reachable at startup`, and the app boots
    anyway. Invariant 3 intact: absence is an error for the requests that need Concord, not a
    reason for the process to die.

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
