# songbird v1.8 — Study Bibles Build Spec

Concord v8 (its `docs/v8/SPEC.md`) lets a self-hoster load a study Bible they own. The first is the Every Man's Bible (`EMB`); its text is already a translation in the reader. v1.8 teaches songbird to show the rest — notes from any source on any translation, charts, book introductions and front matter, a second topical source — without storing any of it (invariants 1 and 5: everything is fetched from Concord at request time).

## 1. What Concord provides (the contract songbird reads)

Appended to every note and every notes-search hit (Concord ADR-0011):

- `label` — the source's own name for the kind of note ("Textual Note", "Study Note", later "Men, Women, and God" …), or null.
- `title` — a heading, or null.
- `text_format` — `"markdown"`, or null for plain text (NET's notes are plain).
- `passages` — the ranges the note covers beyond its anchor verse, each `{start_chapter, start_verse, end_chapter, end_verse, reference}` in the note's own book; `[]` when none.
- `image` — always null until Concord's images slice.
  - *Live since Concord V8-S4 (ADR-0012):* a chart's `image` names one of its own translation's images, e.g. `chart-01.jpg`, and every other note's is null. Notes-search hits carry `image` and `title` too.
- `type` may now also be `article` or `chart`.
- Markdown text may carry `ref:` links, `[words](ref:TARGET)`, where TARGET is one of `JHN.3` · `GEN.12-14` · `JHN.3.16` · `JHN.3.16-18` · `JHN.3.16-4.2` (USFM code, then chapter, then verse).

And on `GET /v1/translations`, each entry has `note_count` (0 when none).

And `GET /v1/translations/{translation}/assets/{name}` (Concord ADR-0012) returns an image: its bytes (a JPEG or PNG) with a strong `ETag`, `Cache-Control: public, max-age=31536000, immutable` and `Vary: Origin`, a `304` on `If-None-Match`, and a `404` for an unknown translation or a name it lacks.

A Concord that predates v8 sends none of these. songbird must behave exactly as it does today against one (the pinned image is v1.2.0), so every new field is optional.

## 2. Slices

| # | Slice | Delivers | Usable result |
|---|---|---|---|
| A | Notes from any source | §3 | A study Bible's notes on every translation, shown properly |
| B | Charts | Images in the note view (after Concord's images slice) | Charts in the reader |
| C | Introductions + About | A book's introduction from the reader; an About page for a Bible's front matter and reading plan (after Concord's documents slice) | Book intros, front matter and reading plan |
| D | Topics by source | The Topics page and verse topics show each topic's source, with a filter (after Concord's Verse Finder slice) | Verse Finder beside Nave's |
| E | Pin bump + release | Concord pin moved to its v8 release, the contract fixture refreshed and extended to the new fields and the assets endpoint, songbird 1.8.0 | — |

Slices B–E get their detail when their Concord slice lands. Slice B's is §4.

## 3. Slice A — notes from any source

**Sources.** A notes source is any translation whose `note_count` is above 0. Against a Concord that doesn't send `note_count`, NET is the one source if Concord offers it (today's behavior).

**Borrowing** (generalises ADR 0004; record it as ADR 0005).

- The single "Show NET notes" checkbox becomes one checkbox per source, in the same place, each shown only when that source isn't the translation being read: "Show NET notes", "Show EMB notes".
  - *2026-10-02, after slice A shipped:* the checkboxes moved out of the reader's bar to a Settings page, which lists every source; the reader keeps them in a compact Notes menu beside the chapter's title, still without the source being read. The top of the screen had grown crowded. See `docs/v1/SPEC.md` §12, "Settings page".
- The preference becomes a per-user list of source codes. The migration keeps an existing choice: `show_net_notes = true` becomes `["NET"]`.
- Placement is ADR 0004's rule, per source: a note anchored inside its source verse is placed by phrase match (a unique match of the last 3, 2, then 1 words, else the end of the verse); a note anchored at the start of its source verse stays at the start. A note whose verse the translation lacks is left out.
- Order at one spot: the translation's own notes first, then borrowed ones, sources in checkbox order.
  - *2026-10-02, after slice A shipped:* each source's markers now have their own look (a colour and a shape), so with two sources showing their notes can be told apart; a key sits beside each source in the Notes menu and on Settings. See `docs/v1/SPEC.md` §12, "Each notes Bible's look".
- Fetched live, never stored. An unreachable Concord shows the existing notice (invariant 3).

**The note view** (own and borrowed notes alike).

- The kind line shows `label` when Concord sends one, otherwise today's type label.
- `title` shows as a heading.
- A note with `passages` shows what it covers under the heading, from the passages' `reference` strings.
- `text_format: "markdown"` renders as Markdown: paragraphs, emphasis, lists, block quotes. A `ref:` link jumps the reader to that passage, the way a cross-reference button does. No other link target becomes a link, and no raw HTML is rendered. Plain-text notes show as they do today.
- A borrowed note says which translation it came from, and still quotes the source's words when it was placed by phrase match.
- A long note scrolls inside the popover.
  - *2026-10-02, after slice A shipped:* the popover opens below its marker when it fits there, and otherwise on the side with more room; it used to open below whenever 160 px were free, which left a long article a sliver. Each heading level has its own look: the title 16 px bold, `#` and `##` slightly larger than the text with a rule under them, `###` and below small capitals; bold opening words stay inline. A paragraph of two or more lines split by hard breaks (not counting a last line that is only its `ref:` reference) is poetry: each line is its own block with a hanging indent, so a wrapped line reads as one line carried over. Two markers at one spot have a gap between them. The popover's width and the markers' looks are unchanged.

**Search.** In the "Study notes" results, the badge shows `label` when present; a hit names its translation when more than one source has notes; snippets of Markdown notes show without Markdown syntax (the `<mark>` highlights stay).

**Out of scope for A.** Images (slice B). Choosing which kinds of notes to borrow. A bigger reading surface for long articles (decided when the features arrive).

## 4. Slice B — charts

EMB has 44 charts. Each is a note of type `chart`, label "Chart", with a title, `passages` (on 40 of them), an `image`, and text that is just its reference as one `ref:` link. A chart's words are inside its picture (Concord has no text for them), so the picture has to be readable on a phone.

**The picture, through songbird.** `GET /api/v1/translations/{translation}/assets/{name}` passes the picture through from Concord at request time, behind the login like everything else. songbird reads the bytes, sends them and keeps nothing (invariants 1 and 5).
- `200`: the bytes. Concord's `ETag` and `Vary` pass through, and so does its `Cache-Control`, with `public` made `private`: the browser keeps the picture for a year, but a shared cache between it and songbird may not, since songbird serves it only to someone signed in (Kris's call). Plus `X-Content-Type-Options: nosniff`.
- Only `image/jpeg` and `image/png` are relayed. Anything else from Concord is a `502`, so songbird's origin never serves Concord's HTML or script.
- `304`: the browser's `If-None-Match` is forwarded, and Concord's `304` comes back with the same headers.
- `404`: a name Concord lacks, or an unknown translation. `.` and `..` are refused before any call.
- `502` `CONCORD_UNREACHABLE` when Concord can't be reached (invariant 3), with no caching headers, so asking again really asks again.

**The note view.** A note with an `image` shows its picture after its title and "Covers …" line and before its text.
- The picture always comes from the **note's own Bible**: EMB's chart borrowed onto KJV loads from EMB.
- It sits in a fixed frame: the box's full width, 12rem tall. Loading, loaded and failed all take the same space, because the popover places itself once, from its height when it opens. The whole chart shows (contained) on a white ground in both themes, as the printed page it is, and colours are never inverted.
- While it loads, the frame says "Loading the chart…". If it fails, it says "Couldn't load the chart's picture (is Concord reachable?)." and offers **Try again**. The rest of the note stays usable.
- The whole frame is a button, "Open the chart larger: {title}", with an "⤢ Open larger" caption. The picture's text alternative is "Chart: {title}".
- A chart with no label is called "Chart". A note without an image (every note from an older Concord) shows no frame.

**The large view.** Tapping or clicking the picture opens a native modal `<dialog>` that fills the window at every width.
- The note's popover closes meanwhile; it would close itself on the viewer's clicks and scrolls, or on a phone turned sideways. Closing the viewer reopens the note at its marker with focus on the picture.
- A header holds the title (the dialog's name) and its "Covers …" line, then − (Zoom out), the zoom as a percentage (a live region), + (Zoom in), Fit and Close. At phone width it takes two rows.
- The picture opens fitted: the whole chart on screen, never enlarged past its own size. It zooms up to three times its own pixels, keeping the point under the fingers, pointer or centre still:
  - + and − step by 1.5×; Fit goes back.
  - A pinch, a double-tap or double-click (fitted ↔ its own size, or 2× when it already fits at that), and Ctrl + wheel. The page itself never zooms.
  - The keys + (or =), − and 0. Arrow keys and Page Up/Down move around the picture area, which has focus when the view opens.
- Dragging and momentum are the browser's own: the picture zooms by changing size inside a scroll box.
- Close, Escape and Android's Back close it. A visually hidden line tells a screen reader that the chart's words are part of the picture and aren't available as text.
- No zoom library: the arithmetic is `frontend/src/lib/chartZoom.ts`.

**Search.** A "Study notes" hit with an `image` shows its title in bold and a small lazy-loaded thumbnail that opens the same large view; focus returns to the thumbnail on close. Its badge and snippet are as before (a chart's indexed text is just its reference). Other hits are unchanged.

**An older Concord.** The pinned v1.2.0 sends no `image` and no assets endpoint, so no frame appears and nothing calls it: everything behaves as before.

## 5. Rules that hold for every slice

- songbird stores nothing from Concord: no note text, no images, no documents (invariants 1 and 5). Its database gains only preferences.
- The Concord pin stays at v1.2.0 until slice E. Until then the contract test keeps validating against the pinned fixture, and the new fields are covered by songbird's own tests.
- No new dependency without a reason (CLAUDE.md).

## 6. Acceptance

**Slice A.**

On Kris's server, with Concord serving EMB's notes: reading EMB shows its textual and study notes with their labels, passages and formatting; ticking "Show EMB notes" on another translation shows them there; "Show NET notes" still works, including on EMB; a `ref:` link jumps; the Search page labels EMB's notes. Against a Concord without the new fields, everything behaves as before.

**Slice B.** On Kris's server, with Concord serving EMB's charts, open these on EMB and on KJV with EMB ticked, at desktop and phone width: Genesis 13 (the chart at the end of verse 4), Jeremiah 1 (verse 3) and Psalm 9 (verse 1). Each chart shows its picture in its note, opens large, zooms until its words can be read, and closes back to the note. A chart in the study-note search opens from its thumbnail. Against a Concord without pictures (the pinned v1.2.0), everything behaves as before.
