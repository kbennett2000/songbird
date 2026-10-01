# songbird v1.8 — Study Bibles Build Spec

Concord v8 (its `docs/v8/SPEC.md`) lets a self-hoster load a study Bible they own. The first is the Every Man's Bible (`EMB`); its text is already a translation in the reader. v1.8 teaches songbird to show the rest — notes from any source on any translation, charts, book introductions and front matter, a second topical source — without storing any of it (invariants 1 and 5: everything is fetched from Concord at request time).

## 1. What Concord provides (the contract songbird reads)

Appended to every note and every notes-search hit (Concord ADR-0011):

- `label` — the source's own name for the kind of note ("Textual Note", "Study Note", later "Men, Women, and God" …), or null.
- `title` — a heading, or null.
- `text_format` — `"markdown"`, or null for plain text (NET's notes are plain).
- `passages` — the ranges the note covers beyond its anchor verse, each `{start_chapter, start_verse, end_chapter, end_verse, reference}` in the note's own book; `[]` when none.
- `image` — always null until Concord's images slice.
- `type` may now also be `article` or `chart`.
- Markdown text may carry `ref:` links, `[words](ref:TARGET)`, where TARGET is one of `JHN.3` · `GEN.12-14` · `JHN.3.16` · `JHN.3.16-18` · `JHN.3.16-4.2` (USFM code, then chapter, then verse).

And on `GET /v1/translations`, each entry has `note_count` (0 when none).

A Concord that predates v8 sends none of these. songbird must behave exactly as it does today against one (the pinned image is v1.2.0), so every new field is optional.

## 2. Slices

| # | Slice | Delivers | Usable result |
|---|---|---|---|
| A | Notes from any source | §3 | A study Bible's notes on every translation, shown properly |
| B | Charts | Images in the note view (after Concord's images slice) | Charts in the reader |
| C | Introductions + About | A book's introduction from the reader; an About page for a Bible's front matter and reading plan (after Concord's documents slice) | Book intros, front matter and reading plan |
| D | Topics by source | The Topics page and verse topics show each topic's source, with a filter (after Concord's Verse Finder slice) | Verse Finder beside Nave's |
| E | Pin bump + release | Concord pin moved to its v8 release, the contract fixture refreshed and extended to the new fields, songbird 1.8.0 | — |

Slices B–E get their detail when their Concord slice lands.

## 3. Slice A — notes from any source

**Sources.** A notes source is any translation whose `note_count` is above 0. Against a Concord that doesn't send `note_count`, NET is the one source if Concord offers it (today's behavior).

**Borrowing** (generalises ADR 0004; record it as ADR 0005).

- The single "Show NET notes" checkbox becomes one checkbox per source, in the same place, each shown only when that source isn't the translation being read: "Show NET notes", "Show EMB notes".
- The preference becomes a per-user list of source codes. The migration keeps an existing choice: `show_net_notes = true` becomes `["NET"]`.
- Placement is ADR 0004's rule, per source: a note anchored inside its source verse is placed by phrase match (a unique match of the last 3, 2, then 1 words, else the end of the verse); a note anchored at the start of its source verse stays at the start. A note whose verse the translation lacks is left out.
- Order at one spot: the translation's own notes first, then borrowed ones, sources in checkbox order.
- Fetched live, never stored. An unreachable Concord shows the existing notice (invariant 3).

**The note view** (own and borrowed notes alike).

- The kind line shows `label` when Concord sends one, otherwise today's type label.
- `title` shows as a heading.
- A note with `passages` shows what it covers under the heading, from the passages' `reference` strings.
- `text_format: "markdown"` renders as Markdown: paragraphs, emphasis, lists, block quotes. A `ref:` link jumps the reader to that passage, the way a cross-reference button does. No other link target becomes a link, and no raw HTML is rendered. Plain-text notes show as they do today.
- A borrowed note says which translation it came from, and still quotes the source's words when it was placed by phrase match.
- A long note scrolls inside the popover.

**Search.** In the "Study notes" results, the badge shows `label` when present; a hit names its translation when more than one source has notes; snippets of Markdown notes show without Markdown syntax (the `<mark>` highlights stay).

**Out of scope for A.** Images (slice B). Choosing which kinds of notes to borrow. A bigger reading surface for long articles (decided when the features arrive).

## 4. Rules that hold for every slice

- songbird stores nothing from Concord: no note text, no images, no documents (invariants 1 and 5). Its database gains only preferences.
- The Concord pin stays at v1.2.0 until slice E. Until then the contract test keeps validating against the pinned fixture, and the new fields are covered by songbird's own tests.
- No new dependency without a reason (CLAUDE.md).

## 5. Acceptance (slice A)

On Kris's server, with Concord serving EMB's notes: reading EMB shows its textual and study notes with their labels, passages and formatting; ticking "Show EMB notes" on another translation shows them there; "Show NET notes" still works, including on EMB; a `ref:` link jumps; the Search page labels EMB's notes. Against a Concord without the new fields, everything behaves as before.
