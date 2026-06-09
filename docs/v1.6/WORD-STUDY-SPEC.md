# songbird — Original-language word study (v1.6 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which owns the
> lexicons and the tagged original-language texts (the Hebrew OT, OSHB; the Greek NT, SBLGNT) this
> feature reads; songbird stores none. See [the design spec](../v1/SPEC.md) for that relationship.

Word study is what turns reading into *study*: tap into a verse, see the Hebrew or Greek behind it,
each word's lemma, gloss, and definition, and — the real payoff — every other verse that same word
appears in. It's core to sermon prep and teaching. Concord ships the whole-Bible tagging (~19K
lexicon entries, ~440K tagged tokens) and a concordance; songbird surfaces it as a reader panel.

**Deliberate scope (the load-bearing decision):** this is the **original-language strip + Strong's
detail + concordance** — *not* tap-an-English-word interlinear. Concord exposes the verse's
original tokens, not a mapping from English words to them, so "tap an English word → its Strong's
entry" would be an invented, approximate alignment — the version that demos well and then mismaps a
word in front of someone who trusts it. That alignment, and morphology *decoding*, are parked as
future **Concord** work (§7), not built here.

Third feature of the **v1.6 fan-out epic**. The shared Concord pin (epic **Slice 0**, PR #96)
already landed — **no new infra gate**, pure songbird.

---

## 1. What this is (and is not)

**Is:**
- **(Slice 1)** a verse's original-language tokens in a reader SidePanel — an interlinear strip
  (surface form, transliteration, gloss). Each *tagged* word drills, in the same panel, to its
  Strong's entry (lemma, definition) and its **concordance** (every verse it occurs in), each
  jump-able into the reader.
- **(Slice 2 — optional, lower-priority)** a standalone Strong's lexicon search.

**Is not:**
- **tap-an-English-word interlinear / English↔original alignment** — deferred; it needs data
  Concord doesn't expose (future Concord work, §7). The strip shows the *original* words, not the
  English ones annotated.
- **morphology decoding** — `morph_code` is shown raw (expert notation); songbird does not parse it
  into human-readable grammar (that would need a Concord morph endpoint — future work).
- no editing of the original text or lexicon (read-only, Concord-owned).

## 2. The boundary — pure songbird, no new Slice 0

Concord **v1.2.0** already exposes every word/Strong's endpoint, and the pin + fixture are already
at v1.2.0 (epic Slice 0, PR #96). **No Concord change, no docker-compose/fixture/version change.**
The notes/cross-references/topics proxy shape again; the **topics panel (Slice 1b)** is the closest
working template — this is structurally the same verse-scoped, two-level drill-in panel.

The only things that *would* need Concord — the English-word alignment and morph decoding — are
explicitly out of this feature (§1, §7).

## 3. Concord contract used

```
GET /v1/verses/{ref}/words
  → { reference, text_id,
      tokens: [ {position, surface_form, strongs_id?, morph_code?, lemma?, transliteration?, gloss?} ] }   (Slice 1)
    # text_id is the tagged text used; auto-selected by testament (OT → Hebrew/OSHB, NT → Greek/SBLGNT).
    # A bad ref → 400/404. A VALID ref with no tagged original (e.g. deuterocanon) → 200 with tokens: [].
    # strongs_id/lemma/transliteration/gloss are null for untagged tokens (punctuation, particles).

GET /v1/strongs/{id}
  → { strongs_id, language, lemma, transliteration, gloss, definition, source }     # the lexical payoff   (Slice 1)
    # unknown id → 404.

GET /v1/strongs/{id}/verses?translation=&include_text=true&limit=&offset=
  → { strongs_id, text_id, translation?, include_text, limit, offset, total,
      verses: [ {book, chapter, verse, reference, text?} ] }                          # the concordance      (Slice 1)
    # auto-selects the tagged text by the id's language (H… → Hebrew, else Greek). unknown id → 404.

GET /v1/strongs?q=&language=&limit=&offset=
  → { q?, language?, limit, offset, total, entries: [StrongsSummary] }               # lexicon search       (Slice 2)
```

`StrongsVerse` (`{book, chapter, verse, reference, text?}`) is the **same shape** as Slice 1-topics'
`TopicVerse` — the concordance and the topic-verse list are the same UX.

## 4. songbird changes

### Slice 1 — Original-language panel (verse → tokens → Strong's detail + concordance)

The notes/topics proxy shape (backend) + a verse-scoped SidePanel mode mirroring the **topics**
mode (frontend) — same two-level drill-in, same clear-everywhere wiring (now a **fifth** mode), a
third hover trigger on the verse row. `api/topics.py`, the `VerseTopics` component, and the topics
ReaderView wiring are the direct templates.

- **Client** (`concord/client.py`):
  - `get_verse_words(book, chapter, verse)` → `VerseWordsResponse`. Build + `quote` the
    `"{book} {chapter}:{verse}"` ref; `GET /v1/verses/{ref}/words`; **no `text` param** (Concord
    auto-selects Hebrew/Greek). 400/404 → `ConcordNotFoundError`, else `ConcordUnreachableError`.
    (An empty token list is a normal 200 — *not* an error.)
  - `get_strongs(strongs_id)` → `StrongsDetail`. `GET /v1/strongs/{id}` (quoted); 400/404 →
    `ConcordNotFoundError`, else unreachable. Mirror `get_topic` / `get_place`.
  - `get_strongs_verses(strongs_id, translation=None, limit=50, offset=0)` →
    `StrongsVersesResponse`. `include_text=true` (default) + `translation` when given; mirror
    `get_topic_verses`.
- **Concord schema** (`concord/schemas.py`): `WordTokenOut` (position, surface_form, strongs_id,
  morph_code, lemma, transliteration, gloss — all but position/surface_form **nullable**),
  `VerseWordsResponse` (reference, text_id, total, tokens), `StrongsDetail` (strongs_id, language,
  lemma, transliteration, gloss, definition, source), `StrongsVerse` (book, chapter, verse,
  reference, text), `StrongsVersesResponse`.
- **songbird API** (`api/strongs.py`, **new** router `prefix="/api/v1"`, `tags=["word-study"]`,
  mounted in `main.py`):
  - `GET /verse-words/{book}/{chapter}/{verse}` → **`response_model=VerseWordsOut`** — a small
    API-layer model **`{ reference, text_id, tokens: list[WordTokenOut] }`**. **NOT a bare
    `list[WordTokenOut]`** (contrast topics' bare list): the frontend needs `text_id` to choose
    text direction (RTL for Hebrew). This is the one place the bare-list pattern doesn't fit —
    don't drop `text_id`.
  - `GET /strongs/{strongs_id}` → `response_model=StrongsDetail`
  - `GET /strongs/{strongs_id}/verses?translation=&limit=&offset=` → `response_model=list[StrongsVerse]`
    (bare list is fine here — the concordance is LTR English text, no `text_id` needed).
  - Errors **surface** (this panel is user-invoked, like topics): `ConcordNotFoundError` →
    `404 NOT_FOUND`; `ConcordUnreachableError` → `502 CONCORD_UNREACHABLE`. (A 200-empty token list
    is *not* an error — see the frontend "no data" state.) `api/schemas.py` gains API-layer
    `WordTokenOut`, `VerseWordsOut`, `StrongsDetail`, `StrongsVerse` — **both mirrors kept**.
- **Frontend — fetch** (`schemas.ts` + `lib/reader.ts`): `wordTokenSchema` (nullable
  strongs_id/morph_code/lemma/transliteration/gloss — match the backend nullability so the parse
  never throws), `verseWordsSchema` (`{reference, text_id, tokens}`), `strongsDetailSchema`,
  `strongsVerseSchema` (identical to `topicVerseSchema` — alias or reuse). `fetchVerseWords(book,
  chapter, verse)`, `fetchStrongs(strongsId)`, `fetchStrongsVerses(strongsId, translation, limit?,
  offset?)`.
- **Frontend — `WordStudy` component** (`frontend/src/components/WordStudy.tsx`; mirror
  `VerseTopics`' two-level shape):
  - Props: `{ book, chapter, verse, translation, onJump }`.
  - **Level 1 — the interlinear strip:** `useQuery(["verse-words", book, chapter, verse])` →
    `fetchVerseWords`. Pending/error mirror `VerseTopics` (**error is inline**, not silent).
    **Empty (`tokens.length === 0`) → a graceful "No original-language data for this verse."
    message** — distinct from an error (this is the deuterocanon / untagged-verse 200, not a
    failure). Render each token: `surface_form` prominent (original-language sized),
    `transliteration` + `gloss` as a quiet secondary line, `morph_code` raw/quiet. Tokens **with**
    a `strongs_id` are tappable (→ level 2); tokens **without** render but aren't tappable.
  - **RTL — required, not cosmetic:** Hebrew is right-to-left; rendered LTR it's wrong. When the
    verse is Hebrew, render the strip `dir="rtl"`; Greek `dir="ltr"`. Detect Hebrew robustly from
    the **`strongs_id` prefix** (`H…` = Hebrew, `G…` = Greek — e.g. `tokens.some(t =>
    t.strongs_id?.startsWith("H"))`), with `text_id` as corroboration (don't hard-code a single
    text_id string).
  - **Level 2 — Strong's detail + concordance** (`selectedStrongsId` set): a "← Words" back button
    + the lemma / `strongs_id` as a sub-heading; `useQuery(["strongs", id])` → `fetchStrongs`
    (show `definition` prominently, plus lemma / transliteration / gloss / source) **and**
    `useQuery(["strongs-verses", id, translation])` → `fetchStrongsVerses` → the **concordance**
    verse list (jump-able rows: `reference` + `text`, `onClick` → `onJump`). Back clears
    `selectedStrongsId`.
  - **Concordance verse list — reuse:** `StrongsVerse` is identical to `TopicVerse`. Prefer
    generalizing the Slice 2b `TopicVerseList` into a presentational **`VerseRefList`**
    (`{ verses, onJump }`, no fetching) that both the topics drill-in and this concordance render —
    a small extraction. If that refactor of just-shipped code is messier than it's worth, say so in
    the plan and build a parallel `StrongsVerseList`, noting the shared component as a follow-up.
    (Same judgment call, and same default-to-share, as the 2b extraction.)
- **Frontend — `ReaderView.tsx` wiring** (mirror the `topics` mode **exactly** — now the **fifth**
  panel mode):
  - `interface WordsView { book; chapter; verse; reference }` + `[words, setWords] =
    useState<WordsView | null>(null)`.
  - `openWords(verse)` mirroring `openTopics`: clears `editing`/`xref`/`geo`/`map`/`topics`, then
    `setWords({...})`.
  - **CRITICAL — add `setWords(null)` to EVERY existing mode-switcher**, beside each existing
    `setTopics(null)` (which sits beside each `setXref(null)`). Grep for the clearing sites; **the
    plan must enumerate them and confirm the count.** This is the third time this exact wiring is
    the load-bearing risk — five modes now, every switcher clears the other four.
  - **Verse-row trigger:** a **third** hover-revealed icon beside `⇄` (xref) and `※` (topics) —
    same `opacity-0 transition group-hover:opacity-100` styling, a distinct glyph evoking
    original-language/lexicon (final per frontend-design; visually distinct from `⇄` and `※`),
    `aria-label={`Original language for verse ${v.verse}`}`, `title="Original language"`,
    `onClick={() => openWords(v)}`. (Three hover icons on the row is the ceiling; if it ever feels
    crowded, consolidating verse actions into a `⋯` menu is a future refactor — out of scope here.)
  - **SidePanel:** add `|| words !== null` to `open=`; add `: words ? `Original language —
    ${words.reference}`` to the header chain; add `{words && <WordStudy book={words.book}
    chapter={words.chapter} verse={words.verse} translation={…} onJump={(b, c, v) =>
    navigate(b, c, v)} />}` to the body. Use the same translation source the topics/xref bodies pass.

### Slice 2 — Strong's lexicon search (optional, lower-priority)

**Honest framing:** you almost always *arrive* at a Strong's number from a word in a verse — which
Slice 1's concordance already gives you. A cold lexicon search is a narrower, more expert entry
point. Recommend building this **only if** living with Slice 1 makes you want a standalone search;
it isn't required for the feature to be valuable. Specced lightly.

- **Client**: `list_strongs(q=None, language=None, limit=50, offset=0)` → `StrongsResponse`.
- **Schemas**: `StrongsResponse` / `StrongsSummary` (concord + api).
- **songbird API** (`api/strongs.py`, extend): `GET /strongs?q=&language=&limit=&offset=` →
  `StrongsPageOut` (`{ entries, total }`, mirror `PlacesPageOut`/`TopicsPageOut`). Errors surface.
- **Frontend**: `TopNav` gains a "Word study" (or "Lexicon") entry; a `StrongsView` mirroring
  `TopicsView` — a debounced `q` search + a **`language` select** (Hebrew / Greek — a real two-value
  vocabulary, unlike topics' free-text section) + a paginated entry list → entry detail reusing the
  Slice 1 Strong's-detail + concordance rendering.

## 5. Tests

### Slice 1
- **Backend** (`strongs_test.py`): verse-words returns tokens **and `text_id`**; a valid ref with
  no tagged original → `200` with `tokens: []`; a bad ref → `400/404`; unreachable → `502`. strongs
  detail; unknown id → `404`. strongs-verses concordance (passthrough; `translation` optional);
  unknown id → `404`; unreachable → `502`. `FakeConcordClient` gains `get_verse_words`,
  `get_strongs`, `get_strongs_verses`.
- **Frontend** (`WordStudy.test.tsx` + `ReaderView.test.tsx`): the strip lists a verse's tokens; a
  **Hebrew verse renders `dir="rtl"`** (assert it); tapping a tagged token drills to the Strong's
  detail + concordance; an **untagged token isn't tappable**; a verse with **no tokens shows the
  "no original-language data" message (not an error)**; the error state renders inline; a
  concordance verse jumps the reader and closes the panel; "← Words" returns to the strip. MSW
  handlers for `/verse-words/...`, `/strongs/{id}`, `/strongs/{id}/verses`. **A ReaderView test that
  opening the word-study panel closes any open xref/topics/geo panel and vice-versa** — guards the
  five-mode clear-everywhere wiring.
- **Contract** (**required**): add `("GET", "/v1/verses/{}/words")`, `("GET", "/v1/strongs/{}")`,
  and `("GET", "/v1/strongs/{}/verses")` to `_REQUIRED_ENDPOINTS`. (Version assertion untouched.)

### Slice 2 (if built)
- **Backend**: `list_strongs` (q / language / pagination passthrough, total).
- **Frontend** (`StrongsView.test.tsx`): search filters; the language select works; pagination;
  entry → detail + concordance. MSW handler for `/strongs`.
- **Contract** (**required**): add `("GET", "/v1/strongs")`.

## 6. Definition of done

- **Slice 1:** from any verse, a hover trigger opens an **Original language** panel showing the
  verse's interlinear strip (Hebrew rendered RTL); each tagged word drills, in-panel, to its
  Strong's definition and concordance; each concordance verse jumps the reader and closes the panel;
  a verse with no tagged original shows the "no data" message (not an error); an outage shows an
  inline error; opening the panel closes any other open panel and vice-versa; both schema mirrors
  kept; the contract pins the three endpoints; `make check` + `make check-frontend` green; a
  `dev-notes.md` entry.
- **Slice 2 (if built):** a lexicon-search surface — `q` + language select + pagination → entry →
  detail + concordance; the contract pins the endpoint; gates green; a `dev-notes.md` entry.

## 7. PR shape & deferred Concord work

- **Slice 1a — backend:** the three proxy routes + schemas + client + contract lines + tests.
- **Slice 1b — frontend:** `WordStudy` + the ReaderView fifth mode + RTL + the (shared or parallel)
  concordance list + tests. **1b carries the real risk:** RTL, the empty-vs-error distinction, and
  the five-mode clear-everywhere.
- **Slice 2a / 2b (optional):** backend search proxy, then the `StrongsView` surface — built only
  if desired.

**Parked as future Concord work (not this feature):** (1) an aligned-interlinear endpoint that maps
English translation words to original tokens, which is the only honest way to do tap-an-English-word
study; (2) a morphology endpoint that decodes `morph_code` into human-readable grammar. Both are
Concord-side and out of scope here — same bucket as the OpenAPI response-model debt noted earlier.

## 8. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; songbird owns zero Scripture text — the
original-language tokens, lexicon, and concordance are Concord-owned, proxied verbatim; branch + PR
per slice; tests required; types/lint clean; never self-merge, push to `main`, or `--force`.
