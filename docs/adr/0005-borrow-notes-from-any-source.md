# ADR 0005 — Borrow notes from any Bible that has them

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** v1.8 slice A, "notes from any source" (`docs/v1.8/STUDY-BIBLE-SPEC.md` §3).
  Generalises [ADR 0004](0004-borrow-net-notes-by-phrase-match.md).

## Context

ADR 0004 let a reader show NET's translator's notes while reading another translation. It was
named for NET on purpose, because NET was the only translation Concord had notes for, and it
predicted this ADR: "If another translation gains notes, generalising means a small migration and
a source picker."

That has happened. Concord v8 serves a study Bible, the Every Man's Bible (`EMB`), with its own
textual and study notes, and says which translations have notes: each `/v1/translations` entry
now carries `note_count` (Concord ADR-0011). A Concord that predates v8 sends no `note_count`.

## Decision

1. **A notes source is any translation with `note_count` above 0**, in Concord's translation
   order. Against a Concord that sends no `note_count` at all, NET is the one source when Concord
   offers it, which is exactly ADR 0004's behaviour. (`noteSources()` in
   `frontend/src/lib/borrowedNotes.ts`.)
2. **One checkbox per source**, in the NET checkbox's old place, labelled with the source's code
   ("Show EMB notes", "Show NET notes"). A source's checkbox is hidden while that source is the
   translation being read, because its notes are then the translation's own.
3. **The preference is a list of codes**, `users.show_notes_from` (JSON, default `[]`), replacing
   the `show_net_notes` boolean. Migration 0015 keeps an existing choice: `show_net_notes = 1`
   becomes `["NET"]`. `PATCH /api/v1/auth/me` takes the whole list, upper-cases and de-duplicates
   it, and needs no Concord round-trip. A stored code Concord doesn't currently offer is kept but
   ignored, so a source that disappears and comes back keeps the user's choice.
4. **Placement is ADR 0004's rule, per source, unchanged.** A note anchored inside its source's
   verse is placed by phrase match (the last 3, 2, then 1 words, used only when the match is
   unique, else the end of the verse). A note anchored at the start of its source's verse stays at
   the start. A note whose verse the translation lacks is left out.
5. **Order at one spot:** the translation's own notes first, then borrowed ones, sources in
   checkbox order. Each borrowed note carries its source's checkbox position (`borrowed.rank`), and
   `verseSegments` sorts on it.
6. **The popover names the source by its code** ("From EMB · EMB reads “…”"), matching the
   checkbox the reader ticked, and still quotes the source's words whenever the note had words
   before its anchor.
7. **Unchanged from ADR 0004:** fetched live from Concord through songbird's existing proxies,
   never stored (invariants 1 and 5). An outage of any source shows the existing notes-unavailable
   notice (invariant 3). Pure frontend logic, with no backend endpoint.

## Alternatives considered

- **A source picker (one menu) instead of checkboxes.** One choice at a time would rule out NET's
  and EMB's notes together, which is useful, and a menu hides what's available behind a click.
- **Order borrowed notes by the order the user ticked them.** Order would then depend on history
  nobody can see. Checkbox order is visible and stable.
- **Keep `show_net_notes` beside a new list.** Two sources of truth for NET, and every reader of
  the profile would have to reconcile them.
- **Name the source by its full translation name** ("From Every Man's Bible (NLT)"). Clear, but
  long in a narrow popover, and it no longer matches the checkbox the reader ticked.

## Consequences

- **More fetches while borrowing:** two per ticked source per chapter (its notes and its text),
  sharing cache keys with reading that translation directly.
- **The downgrade is lossy by design.** Migration 0015's downgrade turns a list containing `NET`
  back into `show_net_notes = 1`, and any other code is dropped, since 0014 can't express it.
- **Placement stays a best guess.** A study Bible's textual notes are anchored inside verses and
  get the same phrase match as NET's; its study notes are anchored at the start of their first
  verse, so they stay at the start, exactly where they belong.
- **Choosing which kinds of notes to borrow** (say, study notes but not textual notes) is out of
  scope for now (spec §3).
