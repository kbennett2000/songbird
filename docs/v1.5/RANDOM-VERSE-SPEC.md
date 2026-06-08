# songbird — Verse of the Day (v1.5 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which serves the
> random verse this feature shows. See [the design spec](../v1/SPEC.md) for that relationship.

A small, inviting **"verse of the day"** card on the Welcome page: one random verse from Concord,
shown in the translation you read, openable in the reader, with a gentle "show another" to
re-roll. A warm entry point on a page that today only reflects your own notes back at you.

This is a **v1.5 feature**, gated on the Concord pin bump in
[SEARCH-EXPANSION-SPEC §Slice 0](../v1.3/SEARCH-EXPANSION-SPEC.md) (`/v1/random` exists since
v1.0.0, but all post-bump work shares that pin).

---

## 1. What this is (and is not)

**Is:** a single random verse on the Welcome page, in the user's reading translation, with an
"Open" link to the reader at that verse and a subtle "show another" that refetches. Best-effort:
if Concord is unreachable, the card simply doesn't appear — it never breaks the Welcome page.

**Is not:** a *daily-pinned* verse (it's a freely re-rollable random verse, not a once-per-day
locked one — pinning would need storage/scheduling; deferred), no book/testament filter UI (the
endpoint supports it; deferred), no sharing.

## 2. The boundary — a pure songbird slice

**No Concord change.** `GET /v1/random` already exists. It is intentionally `no-store` (a fresh
verse every call), so "show another" is just another request — no caching to defeat.

## 3. Concord contract used

`GET /v1/random?translation=&book=&testament=` →
`{translation, book, testament, verse: {book, chapter, verse, reference, text}}`. This slice uses
only `translation`.

## 4. songbird changes

- **Client** (`concord/client.py`): `random_verse(translation?)` → a `RandomVerse`-shaped
  response. Unreachable → `ConcordUnreachableError`.
- **Concord schema** (`concord/schemas.py`): `RandomVerse` (`translation, book, chapter, verse,
  reference, text`).
- **songbird API**: `GET /api/v1/random-verse?translation=` → `RandomVerse`. `api/schemas.py`
  gains the model. A real outage may surface as `502`; the **frontend hides the card on error**
  (the Welcome page must not break if Concord is down — consistent with this being a bonus).
- **Frontend** (`WelcomeView.tsx`): a "verse of the day" card near the top, using
  `user.last_translation` (fallback to a sensible default) as the display translation. Shows
  reference + text, an "Open" link to the reader at that verse, and a subtle "show another"
  button that refetches. **Hidden when the query errors** (no error banner on Welcome).

## 5. Tests

- Backend (`random_verse_test.py`): returns a verse; `translation` passthrough; unreachable →
  `502`. `FakeConcordClient` gains `random_verse`.
- Frontend (`WelcomeView.test.tsx`): the card renders a verse; "show another" refetches; the card
  is hidden when the fetch errors. MSW handler for `/random-verse`.
- Contract (**required**): add `("GET", "/v1/random")` to `_REQUIRED_ENDPOINTS` (in the v1.1.0
  fixture).

## 6. Definition of done

A verse-of-the-day card on Welcome, in the reading translation, openable and re-rollable,
gracefully hidden if Concord is down; the contract test pins `/v1/random`; tests/types/lint
green; a dev-notes entry.

## 7. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; branch + PR per slice; tests required;
types/lint clean; never self-merge, push to `main`, or `--force`.
