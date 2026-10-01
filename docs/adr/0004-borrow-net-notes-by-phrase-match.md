# ADR 0004 — Borrow NET's translator's notes onto other translations by phrase match

- **Status:** Accepted; generalised to any notes source by
  [ADR 0005](0005-borrow-notes-from-any-source.md)
- **Date:** 2026-09-29
- **Context:** reader feature: "show NET notes on other translations"

## Context

Translator's notes come from Concord, and only **NET** has them (about 58,000). Until now the reader
showed notes only for the translation being read, because a note is anchored by a single
`char_offset`: a point just after the word or phrase it comments on, in **NET's own verse text**.
Switch to the ESV and that offset means nothing.

The ask was an opt-in setting that shows NET's notes while reading another translation, on "their
version of that line". For example, NET's note on "and" in Titus 3:1 should appear on the ESV's "and".

What we have to work with:

- A note carries its canonical book, chapter and verse, plus `char_offset`. It does **not** carry
  the word or phrase it's about. The note text starts with that phrase only occasionally (under 2%
  of `tn` notes).
- Concord has **no English word alignment**. Word tokens and Strong's numbers exist only for the
  Hebrew and Greek texts (OSHB and SBLGNT), and English-to-original alignment is out of scope in
  Concord's spec. There is no data that says "NET's *and* is the ESV's *and*".

So any placement inside another translation's verse is songbird's own inference.

## Decision

1. **Borrow by canonical verse, then place by phrase match.** Notes join the reader's verses on the
   canonical verse number, the same bridge annotations use (invariant 4). Within a verse, songbird
   looks for the NET words just before the anchor in the other translation's text:
   - It tries the last 3 words, then the last 2, then the last 1. Case and punctuation are ignored,
     and curly apostrophes count as straight ones.
   - A match is used only if it occurs **exactly once** in the verse.
   - If there's no unique match, the marker goes at the **end of the verse**.
   - A note anchored before NET's first word (a verse-level note) goes at the start of the verse.
2. **Always say what the note is about.** A borrowed note's popover says it's from the NET Bible
   and quotes up to six NET words ending at the anchor. So even an end-of-verse marker is
   understandable, and a wrong-looking placement can be checked against NET's words.
3. **Opt-in, per user.** A `show_net_notes` boolean on the user (default off), toggled by a checkbox
   in the reader. The checkbox appears only when Concord offers NET and the reader is on another
   translation.
4. **Fetched live, never stored.** The reader fetches NET's notes and NET's chapter text from
   Concord (through songbird's existing proxies) only while borrowing. A Concord outage shows the
   existing "notes unavailable" notice (invariant 3). songbird's database holds only the
   preference (invariants 1 and 5).
5. **Pure frontend logic.** Placement lives in `frontend/src/lib/borrowedNotes.ts` as pure,
   unit-tested functions. There's no backend endpoint, and no ML or alignment dependency.

## Alternatives considered

- **Always put borrowed notes at the end of the verse.** This is never wrong, but it's less precise
  than the request asked for. Kept as the fallback rather than the rule.
- **Proportional position** (the same fraction of the way through the verse). This would put markers
  mid-word or on the wrong word with nothing to warn the reader. Rejected.
- **Align through the original language** (Strong's). There's no English tagging in Concord to
  align against. That's a Concord feature, not something songbird can do on its own.

## Consequences

- **Placement is a best guess by design.** Unique-match-only keeps it conservative, so a note
  either lands on matching words or waits at the end of the verse. Where translations reword a
  phrase, more notes end up at the end of the verse. Quoting the NET words makes that
  understandable.
- **Two extra fetches while borrowing** (NET notes and NET text for the chapter). They share cache
  keys with reading NET directly, and are skipped entirely when the setting is off.
- **Named for NET.** The preference and the `NOTES_SOURCE` constant are NET-specific because NET is
  the only source Concord has. If another translation gains notes, generalising means a small
  migration and a source picker.
- **Better data would replace the heuristic.** If Concord ever exposes English word alignment,
  `placeBorrowedNote` is the one function to swap out.
