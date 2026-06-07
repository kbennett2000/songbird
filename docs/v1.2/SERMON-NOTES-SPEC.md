# songbird — Sermon Notes (v1.2 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**. Sermon notes are a
> pure songbird slice — they store no Scripture text and need no Concord change — but they overlay
> the chapters Concord serves, anchored by the same canonical coordinates. See
> [the design spec](../v1/SPEC.md) for that relationship.

A **sermon note** pins a sermon to the passage it preaches on. Where an annotation is *your* note
behind a verse, a sermon note is a pointer — title, date, tags, and a link to watch — anchored to
a verse span and shown in the reader margin with a green ▶ marker. It is the second first-class
overlay alongside annotations.

This is a **v1.2 feature.** songbird v1.0 ships annotations; v1.1 added the map view; this adds
sermon notes. It reuses the annotation machinery (canonical anchoring, the chapter overlay, the
shared tag vocabulary) rather than inventing a parallel one.

---

## 1. What this is (and is not)

- **It is** a sermon *linked* to a passage: a title, an optional date, tags, and an external URL
  to watch/listen, pinned to a canonical verse span.
- **It is not** an annotation. Annotations carry your Markdown note and are scoped per-translation;
  sermon notes carry a link and are **always shown in every translation**.
- **It is not** a media store. songbird holds the **URL only** — it never embeds, downloads, or
  proxies the sermon. A sermon note's body is a link, by design (keeps songbird lean and offline-
  friendly; the link simply opens in a new tab).

## 2. The boundary — this is a pure songbird slice

Sermon notes are songbird-owned data in songbird's own database (invariant 5). They store **no
Scripture text** and require **no Concord endpoint** beyond the chapter read songbird already does.
Concord knows nothing about them.

## 3. The canonical anchor (invariant 4)

A sermon note is pinned to an **address**, never to a translation's rendering:

- `book_usfm` (USFM code, e.g. `PSA`) + `start_chapter`/`start_verse` … `end_chapter`/`end_verse`
  (inclusive; a single verse has start == end). This is the overlay match key.
- `book_order_index` — Concord's `canonical_order`, resolved **server-side at write time** and kept
  only so sermon notes can be **listed in canonical book order** (the ordering annotations lack).
  Clients never send it.

Because the anchor is canonical, a sermon note shows on the right verses **in every translation** —
the same load-bearing bridge that protects annotations.

## 4. Data model (`sermon_notes`)

songbird-owned SQLAlchemy model, Alembic-migrated. Fields: `id`, `title`, `sermon_url` (the body —
an external link), `reference` (display string, e.g. `"Acts 2:42-47"`, passed through verbatim),
the canonical anchor (§3), `event_date` (nullable), `author_id` (author-scoped, like annotations),
`created_at`/`updated_at`, and `tags`. Tags use the **same vocabulary as annotations** (a shared
join table) — not a parallel tag set. Indexes: `ix_sermon_notes_anchor` for the chapter overlay,
`ix_sermon_notes_order` for canonical-order listing.

## 5. API

All endpoints are auth-gated and author-scoped, under `/api/v1/sermon-notes`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/v1/sermon-notes` | List the current user's sermon notes (canonical order; `tags` + `match` filters, like browse) |
| `POST` | `/api/v1/sermon-notes` | Create — client sends `title`, `sermon_url`, `reference`, the anchor, optional `event_date`, `tags`; server resolves `book_order_index` from Concord |
| `GET`  | `/api/v1/sermon-notes/{id}` | Fetch one (404 if not owned) |
| `PATCH`| `/api/v1/sermon-notes/{id}` | Edit `title`/`sermon_url`/`reference`/`event_date`/`tags`. **The anchor is immutable** — re-anchoring is delete + recreate |
| `DELETE`| `/api/v1/sermon-notes/{id}` | Delete (204) |

The chapter read overlays each verse's sermon notes alongside its annotations, so the reader gets
them in one payload.

## 6. The reader affordance — the ▶ marker

- A verse carrying a sermon note shows a green **▶** marker in the margin (next to the annotation
  bullets and the cross-reference toggle). It appears in **every translation**.
- **One** sermon → clicking ▶ opens a popover with the title, `reference` · date, a **"▶ Watch the
  sermon"** external link (new tab), tags, and Edit/Delete for the author.
- **Multiple** sermons on a verse → the ▶ carries a small count badge; the popover stacks them
  **newest-first** (by `event_date`, then `created_at`).
- Create/edit happens from the reader's side panel (the same panel annotations use), with a
  type toggle when starting a brand-new note.

## 7. Browse + search

Sermon notes participate in the shared tag vocabulary, so they surface in the **browse** view
alongside annotations and can be filtered by the same tags.

## 8. Scope

- Author-scoped and auth-gated, exactly like annotations.
- Whole-verse-span granularity (no sub-verse anchoring) — consistent with v1.
- Always cross-translation (no per-translation scope) — the deliberate difference from annotations.

## 9. Seeding

Existing sermon archives can be bulk-loaded from a soap-journal backup via
`scripts/seed_sermon_notes.py` (dry-run / write / `--reset`). The transform in
`backend/songbird/seed/sermon_notes.py` is pure (no I/O), copyright-free (no Scripture text),
splits multi-chapter entries into per-chapter runs, validates `book_order_index` against Concord's
live book map, and normalizes tags into the shared vocabulary.

## 10. What's deferred (not this slice)

- Rich/Markdown sermon bodies (a sermon note is intentionally a link, not a document).
- Embedded/in-app playback of the sermon.
- Re-anchoring in place (delete + recreate covers it).
- Sharing sermon notes between users (single-user-per-note, author-scoped).

## 11. Definition of done (feature)

- Canonical anchor enforced; a sermon note shows on its verses in every translation (tested —
  the invariant-4 bridge applies to sermon notes too).
- Full CRUD over the API, auth-gated and author-scoped; anchor immutable on PATCH.
- Reader marker + single/stacked popover, create/edit/delete from the reader.
- Shared tag vocabulary with annotations (browse filters both).
- Bulk seeding from a backup, copyright-free and idempotent enough to re-run.
