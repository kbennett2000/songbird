# songbird — Topical Bible (v1.6 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which owns the
> topical index (a ~5,300-topic Nave's-style index); songbird stores none. See
> [the design spec](../v1/SPEC.md) for that relationship.

"What does Scripture say about *X*" — forgiveness, the covenant, the resurrection — is a primary
way people study the Bible, and it's the one entry point songbird doesn't have yet. Concord ships a
large curated topical index. This surfaces it from **both directions**: while reading, *what themes
is this verse part of?* (and pivot straight into studying that theme across Scripture); and as a
browsable index, *pick a theme, read its verses.* The first is a reader panel; the second is a new
top-nav surface. Together they complement the keyword and semantic search songbird already has with
human-curated topicality.

Second feature of the **v1.6 fan-out epic**. The shared Concord pin bump (epic **Slice 0**, merged
in PR #96) already landed, so this needs **no new infra gate** — it's pure songbird.

---

## 1. What this is (and is not)

**Is:**
- **(Slice 1)** a verse's topics in a reader SidePanel — each topic drillable, in the same panel,
  to that topic's verses, each verse jump-able back into the reader.
- **(Slice 2)** a browsable **Topics** index (text search + section filter + pagination) → a topic
  → its verses → jump to read.

**Is not:** topic editing (read-only, Concord-owned); no AI/semantic topic *inference* (these are
Concord's curated topics, not generated); no per-topic user collections or saved themes; no
topic-scoped annotation surface.

**Deferred synergy (noted, not built):** a verse's topic names are natural **tag suggestions** when
annotating — a clean future hook between Concord's topics and songbird's own tag system. Left out
of both slices deliberately to keep them tight; worth its own small slice later if it proves useful.

## 2. The boundary — pure songbird, no new Slice 0

Concord **v1.2.0** already exposes every topic endpoint, and the runtime pin + contract fixture are
already at v1.2.0 (epic Slice 0, PR #96). So: **no Concord change, no `docker-compose.yml` change,
no fixture/version change.** This is the same proxy-through shape as translator's notes and
cross-references — `api/read.py`'s cross-references handler and the `CrossReferences` component are
the working templates.

## 3. Concord contract used

```
GET /v1/verses/{ref}/topics
  → { reference, total, topics: [ {id, name, section, see_also} ] }        # the reverse lookup  (Slice 1)

GET /v1/topics/{id}/verses?translation=&include_text=true&limit=&offset=
  → { id, translation?, include_text, limit, offset, total,
      verses: [ {book, chapter, verse, reference, text?} ] }               # a topic's verses    (Slices 1 & 2)

GET /v1/topics?q=&section=&limit=&offset=
  → { q?, section?, limit, offset, total, topics: [TopicSummary] }         # browse / search     (Slice 2)

GET /v1/topics/{id}
  → { id, name, section, see_also, verse_count }                           # topic header        (Slice 2)
```

`see_also` (a topic id) marks a **"See X" redirect** — that topic carries no verses of its own;
resolve to the target. A bad/unknown id or ref returns 4xx (a not-found, **not** unreachability),
exactly like cross-references.

## 4. songbird changes

### Slice 1 — Verse topics in the reader (reverse-lookup panel, with drill-in)

Backend is the notes/cross-references proxy shape. Frontend adds **one new SidePanel mode, mirroring
`xref` exactly**, whose body is a small two-level component (topics → a topic's verses).

- **Client** (`concord/client.py`), mirroring `get_cross_references`:
  - `get_verse_topics(book, chapter, verse)` → `VerseTopicsResponse`. Build the `"{book}
    {chapter}:{verse}"` ref and `quote` it; 400/404 → `ConcordNotFoundError`, other HTTP →
    `ConcordUnreachableError`. (No `include_text` — topics are just id/name/section.)
  - `get_topic_verses(topic_id, translation=None, limit=50, offset=0)` → `TopicVersesResponse`.
    Pass `include_text=true` and `translation` when given (like cross-references), so the drill-in
    can show verse text.

- **Concord schema** (`concord/schemas.py`): `TopicSummary` (`id, name, section, see_also`),
  `VerseTopicsResponse` (`reference, total, topics`), `TopicVerse` (`book, chapter, verse,
  reference, text`), `TopicVersesResponse` (`id, translation, include_text, limit, offset, total,
  verses`).

- **songbird API** (`api/topics.py`, **new** router `prefix="/api/v1"`, `tags=["topics"]`, mounted
  in `main.py` beside the others):
  - `GET /verse-topics/{book}/{chapter}/{verse}` → `response_model=list[TopicSummary]`
  - `GET /topics/{topic_id}/verses?translation=&limit=&offset=` → `response_model=list[TopicVerse]`
  - `ConcordNotFoundError` → `404 NOT_FOUND`; `ConcordUnreachableError` → `502
    CONCORD_UNREACHABLE`. `api/schemas.py` gains API-layer `TopicSummary` + `TopicVerse` (the kept
    hand-mirrors, per the notes/places pattern — codegen still deferred).

- **Frontend — fetch** (`schemas.ts` + `lib/reader.ts`), modelled on `crossReferenceSchema` /
  `fetchCrossReferences`: `topicSummarySchema`, `topicVerseSchema` (+ array schemas + inferred
  types); `fetchVerseTopics(book, chapter, verse)`, `fetchTopicVerses(topicId, translation,
  limit?, offset?)`.

- **Frontend — `VerseTopics` component** (the panel body; clone `CrossReferences`' query / pending
  / error / empty / list shape, then add one level of drill-in):
  - Props: `{ book, chapter, verse, translation, onJump }`.
  - **Level 1** — `useQuery(["verse-topics", book, chapter, verse])` → `fetchVerseTopics`.
    Pending / error / empty messages mirror `CrossReferences` — **error shows the inline "Couldn't
    load (is Concord reachable?)" message, NOT silence.** (This panel is user-invoked on demand,
    unlike the passive headings overlay that stays silent — the divergence is deliberate and
    correct.) Render topics as a list (each row: `name`, with `section` as a quiet secondary line);
    tapping a row sets internal `selectedTopic`.
  - **Level 2** — when `selectedTopic` is set: a "← Topics" back button + the topic `name` as a
    sub-heading, then `useQuery(["topic-verses", topicId, translation])` → `fetchTopicVerses`
    (with text). Render verses as jump-able rows (`reference` + `text`), each `onClick` →
    `onJump(book, chapter, verse)`.
  - **`see_also`**: a topic with `see_also` set is a redirect — drilling in follows it to the
    target's verses. (Won't normally appear in a verse's reverse-lookup, which carries only real
    topics; handle defensively.)

- **Frontend — `ReaderView.tsx` wiring** (mirror the `xref` mode **exactly**):
  - `interface TopicsView { book: string; chapter: number; verse: number; reference: string }`
    and `const [topics, setTopics] = useState<TopicsView | null>(null)`.
  - `openTopics(verse: ReadVerse)` mirroring `openXref` — clears `editing` / `xref` / `geo` / `map`,
    then `setTopics({...})`.
  - **CRITICAL — add `setTopics(null)` to EVERY other mode-switcher.** A fourth panel mode is only
    correct if every path that opens or closes another mode also clears it: `openXref`, `openGeo`,
    `openMap`, `closePanel`, `navigate`, and the editing-open paths — i.e. **every place that today
    calls `setXref(null)`, add the parallel `setTopics(null)`.** Missing one is *the* defect to
    avoid here (the structural analogue of the headings no-banner rule).
  - **Verse-row trigger:** a hover-revealed icon button beside the `⇄` cross-references button —
    same `opacity-0 transition group-hover:opacity-100` styling, a **distinct glyph** visually
    parallel to `⇄` (final glyph per frontend-design; avoid `#`, which reads as the annotation tag
    system), `aria-label={`Topics for verse ${v.verse}`}`, `title="Topics"`, `onClick={() =>
    openTopics(v)}`. Hover-revealed, so the default reading view stays uncluttered.
  - **SidePanel:** add `|| topics !== null` to the `open=` condition; add the
    `: topics ? `Topics — ${topics.reference}`` arm to the header chain; add
    `{topics && <VerseTopics book={topics.book} chapter={topics.chapter} verse={topics.verse}
    translation={…} onJump={(b, c, v) => navigate(b, c, v)} />}` to the body.

### Slice 2 — Topics browse (the gazetteer)

A new top-nav surface, the **`PlacesView` pattern**. Independent of Slice 1 (its own value:
open-ended "study *X*" discovery), reusing Slice 1's verse-list rendering.

- **Client** (`concord/client.py`): `list_topics(q=None, section=None, limit=50, offset=0)` →
  `TopicsResponse`; `get_topic(topic_id)` → `TopicDetail`.
- **Schemas** (`concord/schemas.py` + `api/schemas.py`): `TopicsResponse`, `TopicDetail`
  (`TopicSummary` / `TopicVerse` already exist from Slice 1).
- **songbird API** (`api/topics.py`, extend): `GET /topics?q=&section=&limit=&offset=` → a
  paginated shape mirroring `placesPage` (`{ total, limit, offset, topics }`); `GET
  /topics/{topic_id}` → `TopicDetail`.
- **Frontend:** `TopNav` gains a **Topics** entry (e.g. between Search and Places); a route + a
  `TopicsView` (`frontend/src/routes/`) mirroring `PlacesView` — a debounced search box (`q`) + a
  `section` filter + a paginated topic list (list rows show `name` + `section`; counts live on the
  detail). Clicking a topic → a detail header (`name`, `section`, `verse_count`; if `see_also`,
  render "→ See {target}" linking to the target) + its verses (reuse the Slice 1 verse-list — at
  this point extract a small shared `TopicVerseList` used by both the panel and the browse view)
  with jump-to-read.
- **`see_also`** is first-class here (you can land on a redirect directly): show it and link to the
  target topic.

## 5. Tests

### Slice 1
- **Backend** (`topics_test.py`): verse-topics returns the verse's topics; a verse with none →
  `200 []`; unknown ref → `404`; unreachable → `502`. topic-verses returns verses (passthrough;
  `translation` optional); unknown topic → `404`; unreachable → `502`. `FakeConcordClient` gains
  `get_verse_topics` + `get_topic_verses`.
- **Frontend** (`VerseTopics.test.tsx` + `ReaderView.test.tsx`): the panel lists a verse's topics;
  tapping a topic drills into its verses; a verse row jumps the reader (`onJump`) and closes the
  panel; "← Topics" returns to the list; empty and error states (error renders the inline message).
  MSW handlers for `/verse-topics/...` and `/topics/{id}/verses`. **A ReaderView test that opening
  the topics panel closes any open xref/geo panel and vice-versa** — this guards the
  clear-everywhere wiring.
- **Contract** (**required**): add `("GET", "/v1/verses/{}/topics")` and
  `("GET", "/v1/topics/{}/verses")` to `_REQUIRED_ENDPOINTS`. (Version assertion untouched — Slice 0
  already set 1.2.0.)

### Slice 2
- **Backend**: `list_topics` (q / section / pagination passthrough, `total`); `get_topic` (detail,
  including `see_also`).
- **Frontend** (`TopicsView.test.tsx`): search filters the list; section filter; pagination; a topic
  → its verses → jump; a `see_also` topic renders the redirect and links to the target. MSW handlers
  for `/topics` and `/topics/{id}`.
- **Contract** (**required**): add `("GET", "/v1/topics")` and `("GET", "/v1/topics/{}")`.

## 6. Definition of done

- **Slice 1:** from any verse, a hover trigger opens a **Topics** panel listing that verse's
  topics; each drills (in-panel) to its verses; each verse jumps the reader and closes the panel;
  opening topics closes any other open panel and vice-versa; an outage shows an inline error (not
  silence); both schema mirrors kept; the contract pins the two endpoints; `make check` +
  `make check-frontend` green; a `dev-notes.md` entry.
- **Slice 2:** a **Topics** top-nav surface — search + section filter + pagination → topic →
  verses → jump; `see_also` redirects resolve; the contract pins the two endpoints; gates green; a
  `dev-notes.md` entry.

## 7. PR shape

Slice 1 and Slice 2 are **separate PRs** (a reader panel vs. a browse surface — different
features). Unlike headings, each slice here is substantial enough to keep the **usual
backend/frontend split** *within* it — no exception needed (contrast HEADINGS-SPEC §7):

- **Slice 1a — backend:** the two proxy routes + schemas + client + contract lines + backend tests.
- **Slice 1b — frontend:** `VerseTopics` + the ReaderView `topics` mode + frontend tests.
- **Slice 2a — backend:** list/detail proxies + schemas + contract lines + tests.
- **Slice 2b — frontend:** `TopNav` entry + `TopicsView` + tests.

Each backend half is independently load-bearing (a tested proxy + a contract pin); each frontend
half is the substantial UI on top.

## 8. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; songbird owns zero Scripture text — topics are
Concord-owned curated data, proxied verbatim; branch + PR per slice; tests required; types/lint
clean; never self-merge, push to `main`, or `--force`.
