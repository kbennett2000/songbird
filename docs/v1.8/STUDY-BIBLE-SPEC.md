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
  - *Since Concord V8-S6b (2 Oct 2026):* EMB's 26 Perspectives boxes (notes labelled "Perspectives") have their passage and their saying in italics, each closed before a hard break, with the punctuation at either edge outside the italics; the reference and the attribution stay upright.

And on `GET /v1/translations`, each entry has `note_count` (0 when none).

And `GET /v1/translations/{translation}/assets/{name}` (Concord ADR-0012) returns an image: its bytes (a JPEG or PNG) with a strong `ETag`, `Cache-Control: public, max-age=31536000, immutable` and `Vary: Origin`, a `304` on `If-None-Match`, and a `404` for an unknown translation or a name it lacks.

And `GET /v1/translations/{translation}/documents?kind=&book=` and `GET /v1/translations/{translation}/documents/{slug}` (Concord ADR-0012, V8-S5): a translation's documents — `front-matter`, `reading-plan`, `book-introduction` and `about` — with `document_count` on each `/v1/translations` entry.
- The list is `{translation, book, kind, total, documents: [{slug, kind, title, book, ordinal}]}`, with no paging; `book` is a book introduction's USFM code and null for the other kinds. An unknown kind or book is a `400`, an unknown translation a `404`.
- One document is `{translation, slug, kind, title, book, ordinal, text, images: [{name, media_type, width, height}]}`. `text` is always Markdown (CommonMark): `##` headings, flat lists, block quotes, hard breaks written as a backslash before the line end, `ref:` links, and pictures written `![alt](asset:NAME)`, served by the assets endpoint. `images` lists them with their pixel size. An unknown slug is a `404`.
- Both are immutable. EMB has 74 (Concord V8-S5b, V8-S5c and V8-S6b):
  - 66 book introductions, each with one picture (its reading time) and, in 36 of them, a timeline (a flat list whose items are a date, a hard break, then the event in bold);
  - 6 front matter (`front-matter-1` … `-5`: the copyright page, two introductions, the contributors, the translation team; and `front-matter-6`, the Tyndale Verse Finder as printed: about 95 KB, 183 `##` topics, an italic "see" or "see also" line in brackets under 29 of them, and 1,286 list items, each a statement and then its reference in brackets as a `ref:` link);
  - a reading plan (`reading-plan-1`: 365 days, each a `##` date over a list of 4 readings as `ref:` links; a month's first day is in capitals, "JANUARY 1"; a reading that crosses into the next book is two links in one item);
  - an about (`about-1`: Personal Gold's author notes and credits).
  None of the last eight places a picture.

And on the topics endpoints (Concord ADR-0013, V8-S6a): every topic carries `source`, its topical index by name, on `/v1/topics`, `/v1/topics/{id}`, `/v1/topics/{id}/verses` (at the page's top level) and `/v1/verses/{ref}/topics`.
- `/v1/topics` also returns `sources`: every loaded index with how many of its topics match the same `q` and `section` (0 included), ordered by name, and the echoed `source` filter. It takes `?source=`, an index's exact name; an unknown name is a `400` with code `unknown_source`.
- Order stays by name, then id, in binary collation, so a list or a verse's topics may mix the indexes (all-capitals names sort before mixed-case ones with the same first letter).
- Kris's Concord has two: "Nave's Topical Bible" (5,319 topics, names in capitals) and "Tyndale Verse Finder" (183 topics, ids `vf-1` … `vf-183`, names in ordinary case, 8 of them "see" redirects). The Verse Finder's statements and its "see also" pointers between topics with verses of their own don't fit the topics data; they are in `front-matter-6` above.

A Concord that predates v8 sends none of these. songbird must behave exactly as it does today against one (the pinned image is v1.2.0), so every new field is optional.

## 2. Slices

| # | Slice | Delivers | Usable result |
|---|---|---|---|
| A | Notes from any source | §3 | A study Bible's notes on every translation, shown properly |
| B | Charts | Images in the note view (after Concord's images slice) | Charts in the reader |
| C1 | Introductions | A book's introduction from the reader (§5) | Book introductions |
| C2 | About | A Bible's About page: its front matter, reading plan and notes on the edition (§6) | Front matter and reading plan |
| D | Topics by source | The Topics page and verse topics show each topic's source, with a filter (after Concord's Verse Finder slice) | Verse Finder beside Nave's |
| E | Pin bump + release | Concord pin moved to its v8 release, the contract fixture refreshed and extended to the new fields and the assets endpoint, songbird 1.8.0 | — |

Slices B–E get their detail when their Concord slice lands. Slice B's is §4, C1's is §5, C2's is §6 and D's is §7.

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
  - *2026-10-02, after slice C2 shipped:* a `ref:` link wraps together with the punctuation touching it (an opening bracket or quote before it; a closing bracket, quote, full stop, comma, colon, semicolon, `?` or `!` after it), so "(" or ")" is never left alone on a line. A link is a button, and a line may break on either side of a button. On a phone, 577 of the Verse Finder's 1,286 entries had a bracket left alone; none do now. This holds wherever Markdown renders: notes, introductions and the About page.
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

## 5. Slice C1 — book introductions

A study Bible introduces each of its books: what it's about, who wrote it, when, an outline that links into the text, key people and ideas, passages worth memorising, how long it takes to read (a picture), and often a timeline. Introductions run to a few hundred words, too long for the note box, so they get a view of their own.

**The API, through songbird.** Both pass through from Concord at request time, behind the login; songbird stores nothing (invariants 1 and 5).
- `GET /api/v1/translations/{translation}/documents?kind=&book=`: Concord's list, filters forwarded.
- `GET /api/v1/translations/{translation}/documents/{slug}`: one document. `.` and `..` are refused before any call.
- An unknown translation, kind, book or slug, or a Concord that predates documents, is a `404`; an unreachable Concord is a `502` `CONCORD_UNREACHABLE` (invariant 3).
- `document_count` passes through on `/api/v1/translations`. The picture comes through the assets route (§4).

**Where the reader offers it.** A Bible offers its introductions when its `document_count` is above 0: the Bible being read, then each Bible ticked under *Notes from other Bibles*, in that order.
- Each such Bible's whole list of book introductions is asked for once a session, so moving through the chapters asks for nothing more.
- The chapter's title row gains a button after **Notes ▾**, on every chapter of the book: **Introduction** for the Bible being read, **EMB introduction** for a ticked one. Its name is "Introduction to Genesis" or "EMB's introduction to Genesis".
- The button shows while its list is loading or if it failed (the view then says so), and is hidden only once the list says the book has none.
- A Concord that sends no `document_count` offers nothing, and nothing asks it for documents.

**The view.** A native modal `<dialog>` that fills the window over the reader, as the chart viewer does; the reader stays mounted underneath.
- **Header:** "Introduction", plus "· From EMB" when it's another Bible's, then the title (the book's name) as the dialog's name, and **Close**.
- **Body:** its own scroll (`overscroll-contain`), one column of at most 65 characters, 16 px text on a 28 px line. The Markdown renders as in a note (§3), with `##` as real `<h3>` headings. Lists, quotes, poetry (a hanging indent) and the timeline's entries (a date, then the event on its own line) read as they do in notes, with list items spaced apart.
- **The picture** sits in a frame of its own shape (from `images`), as wide as the column and at most its own width, on white in both themes. Under it: its caption (the alt text) and **⤢ Open larger**. Tapping either opens the chart viewer (§4), worded for a picture; closing that returns focus to the picture.
- **Getting back:** **Close**, Escape, Android's Back, or **← Back to Genesis 13** at the end close it. The reader is where it was, and focus returns to the button without scrolling. Opening the view closes any open note box.
- **A `ref:` link** closes the view and jumps the reader there, and the address follows.
- **States:** while it loads, the header shows the book's name and the body says "Loading the introduction…". If Concord fails: "Couldn't load the introduction (is Concord reachable?)" with **Try again**; the picture fails on its own, as a chart does. A book with none (only reachable in the moment before the list arrives): "EMB has no introduction to Genesis."

**An older Concord.** The pinned v1.2.0 sends no `document_count` and has no documents endpoints: no button appears and nothing calls them.

## 6. Slice C2 — About

A study Bible prints more than its notes and introductions: front matter (a copyright page, introductions to the edition and the translation, its contributors and translators), a reading plan, and notes about the edition. These are read once in a while, not beside a verse, so they get a page of their own: the Bible's **About** page.

**The API.** Nothing new: slice C1's passthrough (§5) serves every kind. The page reads a Bible's whole list (`GET /api/v1/translations/{translation}/documents`, no filter) and one document at a time. songbird stores nothing (invariants 1 and 5).

**Which Bibles have one.** A Bible whose `document_count` is above 0 and whose list holds any `front-matter`, `reading-plan` or `about` document. Its whole list is asked for once a session and shared by the reader and Settings. A Concord that sends no `document_count` is asked nothing, and nothing offers an About page.

**Where it's offered.**
- **The reader:** an **About EMB** button in the chapter's title row, right after that Bible's introduction button, for the Bible being read and each ticked under *Notes from other Bibles* (the Bibles that offer introductions, §5). It always names its Bible. It shows while its list loads or if it failed (the page then says so), and is hidden once the list has none of the three kinds.
- **Settings:** a section, **About these Bibles**, between *Notes from other Bibles* and *Appearance*: one row per such Bible, "About EMB ›", with its name and what's inside ("Front matter · Reading plan · About the edition"). No such Bible, no section.

**The page.** A native modal `<dialog>` that fills the window, as the introduction does (the shared `DocumentDialog`); what it opens over stays mounted underneath.
- **The list** (where it opens): "About EMB" over the Bible's name, which names the dialog. Groups in this order, each a small-capitals heading over its documents in Concord's order: **Front matter**, **Reading plan**, **About the edition**. Book introductions and kinds songbird doesn't know aren't listed. Each document is a row at least 44 px tall.
- **A document:** a **‹** button ("Back to About EMB") before the title, "Front matter · EMB" over the title (which may take two lines), and **Close**. The body is the introduction's reading column (§5): headings as `<h3>`, lists, quotes, poetry, pictures if any. The contributors' role-over-names lines read as poetry; the team list as divisions, book labels and lists of people.
- **The reading plan,** when every `##` heading is a month and a day in calendar order, shows one month at a time; otherwise it shows as any other document.
  - A bar under the title that never scrolls away: **Month** and **Day** (native selects) and **Today**. It opens on today's month (the device's date), scrolled to today, which has a blue bar and a **Today** tag. Today on 29 February goes to the 28th.
  - Each day: its date ("January 1", whatever case the plan wrote it in) over its readings, beside them from 640 px; one reading per line, no bullets. "← September" and "November →" end each month.
  - Only the month on the page is drawn. Nothing about what's been read is stored: it is a page to read, not a tracker.
- **Getting back:** **Close**, or "← Back to Genesis 13" (on Settings, "← Back to Settings") at the end of the list and of each document, closes the page; focus goes back to what opened it, without scrolling the reader. Escape and Android's Back step back one level: from a document to the list (its row gets focus), then out. "‹ About EMB" at a document's end also goes to the list.
  - *2026-10-02, after slice C2 shipped:* Escape steps back on its key press, before the browser turns it into a close request. Chrome (148) lets a page refuse a dialog's `cancel` only twice, even after a click, and then closes it, so the third Escape in a row used to close the whole page. Android's Back has no key press: it arrives only as a `cancel`, so on a phone the third Back in a row is expected still to close the page, by the browser's own rule against pages that trap Back (not tried on a real phone).
- **Reopening** from the reader in the same visit comes back to the document left, and on a plan to the month and the day whose reading was tapped. This is held in the reader's memory, never stored.
- **A `ref:` link** closes the page and jumps the reader there, in the Bible being read; the address follows. From Settings, it opens the reader there (`/read?book=&chapter=&verse=`), in the Bible last read. A link goes to the start of its passage, so the second half of a reading that crosses books (a link from the next book's first verse to where the day ends) opens at that first verse, where that part starts.
- **States:** while the list loads, "Loading EMB's front matter and reading plan…"; if it fails, "Couldn't load EMB's front matter and reading plan (is Concord reachable?)" with **Try again**; a list with none of the three kinds (only in the moment before it arrives), "EMB has no front matter, reading plan or notes on the edition." A document: "Loading Contributors…", or "Couldn't load Contributors (is Concord reachable?)" with **Try again**.

**An older Concord.** The pinned v1.2.0 sends no `document_count`: no button, no Settings section, and nothing asks it for documents.

## 7. Slice D — topics by source

Nave's was songbird's only topical index. Concord can now load more than one, each keeping its own topics (nothing is merged): beside Nave's, EMB brings the Tyndale Verse Finder. The topics screens say which index each topic comes from and let the Topics page show one at a time.

**The API, through songbird.** Passed through at request time; songbird stores nothing (invariants 1 and 5).
- `source` on every topic: a verse's topics (`/api/v1/verse-topics/{book}/{chapter}/{verse}`), the browse (`/api/v1/topics`) and a topic (`/api/v1/topics/{id}`). It is null from an older Concord.
- `GET /api/v1/topics` gains `sources` (Concord's list, each `{source, total}`; `[]` from an older Concord) and `?source=`, which reaches Concord only when given. An unknown source is a `404`, as any bad topics filter is.
- A topic's verses (`/api/v1/topics/{id}/verses`) are unchanged: the topic's page takes the source from the topic itself.

**The Topics page.**
- When `sources` has more than one entry, a **From:** row of pills like the study-note search's (§3): **All**, then each index with its count, "Nave's Topical Bible (5,319)", in Concord's order. The counts follow the search and the section. A choice applies at once, and the pills stay on screen while its first page loads.
- In the same case, each row's quiet line names its index: "A · Tyndale Verse Finder".
- With an index chosen, an empty result names it: "No Tyndale Verse Finder topics match."
- The rows are Concord's pages in Concord's order; songbird never re-sorts them.
- With one index, or none (an older Concord): no pills, no labels, and no `source` is ever asked for.

**A topic's page.**
- The quiet line under its name names its index ("L · Tyndale Verse Finder") when Concord sends one.
- **A "see" topic names its target.** It used to show the target's id ("See vf-56"; a Nave's id is a lower-case slug). Now the target topic is fetched, from the same cache its own page uses, and the link reads "See" and its name. While it loads, "See …". When Concord lacks the target (143 of Nave's "see" topics point to one it lacks) or the fetch fails, the id, as before, so the link still goes where it did.
- The "see" fix holds on any Concord (Kris's call, 2 Oct 2026). Against v1.2.0 it is the one visible change: a Nave's "see" topic shows its target's name in capitals.

**The reader's topics.** Each topic's quiet line in the ※ panel, and the drilled-in topic's, names its index ("A · Nave's Topical Bible") when Concord sends one.

**An older Concord.** The pinned v1.2.0 sends no `source` or `sources`: no pills, no labels, and `?source=` is never sent.

**Not in this slice.** A way to get around the Verse Finder as printed (`front-matter-6`, 106 screens on a phone, read through the About page): a jump-to-letter bar was suggested on 2 Oct 2026 and waits for Kris's call.

## 8. Rules that hold for every slice

- songbird stores nothing from Concord: no note text, no images, no documents (invariants 1 and 5). Its database gains only preferences.
- The Concord pin stays at v1.2.0 until slice E. Until then the contract test keeps validating against the pinned fixture, and the new fields are covered by songbird's own tests.
- No new dependency without a reason (CLAUDE.md).

## 9. Acceptance

**Slice A.**

On Kris's server, with Concord serving EMB's notes: reading EMB shows its textual and study notes with their labels, passages and formatting; ticking "Show EMB notes" on another translation shows them there; "Show NET notes" still works, including on EMB; a `ref:` link jumps; the Search page labels EMB's notes. Against a Concord without the new fields, everything behaves as before.

**Slice B.** On Kris's server, with Concord serving EMB's charts, open these on EMB and on KJV with EMB ticked, at desktop and phone width: Genesis 13 (the chart at the end of verse 4), Jeremiah 1 (verse 3) and Psalm 9 (verse 1). Each chart shows its picture in its note, opens large, zooms until its words can be read, and closes back to the note. A chart in the study-note search opens from its thumbnail. Against a Concord without pictures (the pinned v1.2.0), everything behaves as before.

**Slice C1.** On Kris's server, with Concord serving EMB's introductions, open Genesis, Isaiah and Philemon on EMB and on KJV with EMB ticked, at desktop and phone width. The reader offers each book's introduction (named by its Bible on KJV), which opens in its own view with its headings, lists, quotes, timeline and picture readable on a phone. Its links jump the reader, and closing it returns to the same place. Against a Concord without documents (the pinned v1.2.0), everything behaves as before.

**Slice C2.** On Kris's server, with Concord serving EMB's front matter, reading plan and about, open EMB's About page on EMB and on KJV with EMB ticked, and from Settings, at desktop and phone width, in light and dark. Each of the six front-matter pieces (the sixth, the Verse Finder, since Concord V8-S6b), Personal Gold's author notes and the reading plan read in full. The plan reaches its first day, a day in June and its last day without scrolling the year, and a reading that crosses into the next book jumps to each half. Closing returns to the same place. Against a Concord without documents (the pinned v1.2.0), everything behaves as before and nothing offers an About page.

**Slice D.** On Kris's server, with Concord serving the Verse Finder beside Nave's, at desktop and phone width, in light and dark. The Topics page offers All, Nave's and the Verse Finder with their counts; choosing the Verse Finder lists its topics in Concord's order, each naming its index, and a search updates the counts. `vf-1` names its index; a Verse Finder "see" topic and a Nave's one show their targets' names. Exodus 21:22's topics in the reader name their indexes. Against a Concord without sources (the pinned v1.2.0), the Topics page, a topic and the reader's topics look as before, with no pills and no labels, and no source is ever asked for.
