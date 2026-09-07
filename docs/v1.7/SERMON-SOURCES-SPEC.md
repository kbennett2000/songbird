# songbird — Sermon Sources (v1.7 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**. Sermon sources are a
> songbird slice with one new outside dependency — **YouTube's Data API** — but they create ordinary
> sermon notes: no Scripture text is stored, and every anchor is still resolved through Concord by the
> same path the sermon form uses today. See [the design spec](../v1/SPEC.md) for the Concord
> relationship and [the sermon-notes spec](../v1.2/SERMON-NOTES-SPEC.md) for the note type this
> feature feeds.

A **sermon source** is a YouTube channel (or playlist) you follow. songbird checks it on a schedule,
finds the sermons it hasn't noted yet, works out the passage each one preaches on, and creates the
sermon notes for you — dated to the day the sermon went up on YouTube, tagged with the source's tags.
Sermons it can't place with confidence wait in a short review list where one tap finishes the job.
Nothing is ever pinned to a guess.

This is a **v1.7 feature.** v1.2 shipped sermon notes as hand-made entries; this removes the hand.

---

## 1. What this is (and is not)

- **It is** a collector. You register a source once; songbird keeps the sermon notes flowing.
- **It is** honest. A sermon note is created only when the passage was stated in the video's own
  text (a labeled scripture line, the title, or the description's opening line — §7). Anything less
  certain becomes a suggestion in the review list, never a note.
- **It is not** a media store or a mirror of YouTube. songbird keeps the video's title,
  description, date, and length as bookkeeping for its own decisions (§4), and the note's body is
  still just the link (v1.2 §1).
- **It is not** an AI reader. Placement is text matching plus Concord's resolver. No ML in songbird
  (CLAUDE.md); a sermon whose passage is never written down goes to review, by design.
- **It is not** a Concord change. Concord knows nothing about YouTube or sources.

## 2. The boundary — a second outbound dependency, held to the Concord rules

- **YouTube is reached through one configured client** (`songbird/youtube/client.py`), the way
  Concord is reached through `ConcordClient`: one class, one base URL, explicit failure types. It
  uses the **YouTube Data API v3** with an API key — Google's official read interface; free; a
  daily allowance of 10,000 "units". A weekly check of ten sources costs roughly 30 units; a full
  back-catalog scan of a 1,000-video channel roughly 40.
- **Chosen over YouTube's no-key RSS feed** because the feed shows only a channel's newest 15
  videos and cannot look up an older video by ID — which the back-catalog scan (§5) and the re-date
  action (§11) both need. One mechanism, one key.
- **The key is a secret.** It lives in `.env` / the compose `environment`, is never logged, and is
  never sent to the browser. The container now needs outbound access to `www.googleapis.com`
  (update the Dockerfile comment that says Concord is the only outbound call, and `docs/SECURITY.md`).
- **YouTube failures never break the app.** Unlike Concord (a hard dependency — its absence is an
  error), YouTube being unreachable, rate-limited, or out of quota is recorded on the affected
  source (`last_check_status`) and shown on the Sources page. The reader, notes, and everything
  else are unaffected. A missing key simply leaves the feature switched off: the Sources page says
  so; nothing else changes.
- **Concord stays the authority on references.** songbird only *finds candidate strings* in text
  (§7); each one is handed to Concord's `/v1/verses/{ref}` to decide what it means, exactly as
  `POST /api/v1/sermon-notes` does today. If Concord is unreachable mid-scan, the scan stops and
  records that; already-processed videos stay processed (§6), the rest are picked up next time.

## 3. Configuration (`Settings`, `.env`, compose)

| Setting | Default | Meaning |
|---|---|---|
| `YOUTUBE_API_KEY` | *(unset)* | Enables the feature. Unset → Sources page explains how to get one; no checks run. |
| `SERMON_CHECK_INTERVAL_HOURS` | `168` (weekly) | How often the scheduled check runs. `0` → scheduled checks off; "Check now" still works. |
| `SERMON_MIN_MINUTES` | `10` | Videos shorter than this are skipped. Per-source override in the UI (§4). |

`docker-compose.yml` gets the three lines with the same plain-language comments the file already
uses; the User's Guide gets a zero-assumptions walkthrough for creating the key (Google account →
Cloud project → enable "YouTube Data API v3" → create an API key), screen by screen.

## 4. Data model

All songbird-owned, Alembic-migrated, author-scoped. No Scripture text anywhere (invariant 5).

**`sermon_sources`** — one registered channel or playlist.
`id`, `author_id`, `kind` (`channel` | `playlist`), `youtube_id` (the `UC…` channel id or `PL…`
playlist id), `uploads_playlist_id` (channels only — the `UU…` list every check reads), `input_url`
(what was pasted, kept for display/edit), `title` (channel/playlist name from YouTube, cached for
display), `enabled` (bool), `include_live` (bool, default true — past livestreams count), `min_minutes`
(nullable; null → `SERMON_MIN_MINUTES`), `last_checked_at`, `last_check_status` (nullable text: `ok`,
or the plain-English reason it failed), `created_at`, `updated_at`.
Tags via **`sermon_source_tags`** (`source_id`, `tag_id`) — the **same shared tag vocabulary** as
annotations and sermon notes (v1.2 §4), not a parallel set.

**`sermon_source_videos`** — the ledger: every video a scan has seen, and the review queue.
`id`, `source_id`, `author_id`, `video_id` (unique per author), `title`, `description`, `published_at`
(UTC), `duration_seconds`, `is_live` (was a livestream), `status`
(`placed` | `needs_passage` | `skipped` | `dismissed` | `already_noted`), `skip_reason` (nullable:
`too_short` | `live_excluded`), `placed_by` (nullable: `scripture_line` | `title` | `first_line` |
`manual`), `suggestions` (JSON list of reference strings found deeper in the text, §7), `seen_at`,
`decided_at`. Index on (`author_id`, `status`) for the review list and on (`author_id`, `video_id`)
for the "have we seen this" check.

**`sermon_notes.youtube_video_id`** — new nullable indexed column. Set server-side on create/update
whenever `sermon_url` is a YouTube link (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`,
share suffixes like `?si=` ignored), and back-filled for existing notes by §11. This is how a scan
knows a video was already noted by hand. **`sermon_notes.source_video_id`** — nullable FK to the
ledger row that created the note, so the review list can show "placed → note".

## 5. Adding a source

Paste a YouTube link. Accepted forms: `youtube.com/@handle` (the common case),
`youtube.com/channel/UC…`, `youtube.com/playlist?list=PL…`. Anything else (old `/c/name`, `/user/name`
links) → a clear message asking for the channel's `@handle` link. songbird resolves the link through
YouTube once (`channels.list?forHandle=` / `?id=`, or `playlists.list`), stores the id, the uploads
playlist id, and the title, then runs the **first scan immediately: the whole back catalog.** For a
curated playlist source the playlist is the catalog.

Why a playlist option: some churches keep a "Messages" playlist that excludes worship nights and
announcements — a cleaner catalog than the channel's uploads.

## 6. The scan

**When.** (a) On add (full catalog). (b) On "Check now" — one source or all. (c) On the schedule:
an `asyncio` task started in the app lifespan runs every `SERMON_CHECK_INTERVAL_HOURS`; at boot, any
enabled source whose `last_checked_at` is older than the interval is checked shortly after start, so a
weekly interval survives restarts. One scan at a time (a process-wide lock); the Sources page shows
"checking…" while it runs. songbird is one process, so an in-process timer is enough — no sidecar, no
cron.

**What.** List the source's playlist newest-first (`playlistItems.list`, 50 per page, 1 unit each);
stop at the first page where every video is already in the ledger (a curated playlist is paged fully —
its order isn't chronological). Fetch the unseen videos' details in batches of 50
(`videos.list?part=snippet,contentDetails,liveStreamingDetails`, 1 unit per batch): title,
description, `publishedAt`, `liveBroadcastContent`, `duration`, `actualStartTime`.

**Filters, in order** (a filtered video is ledgered as `skipped` with its reason, so nothing is
silently hidden):
1. `liveBroadcastContent` is `upcoming` or `live` → not ledgered at all; it is re-seen once finished.
2. Duration < the source's minimum → `too_short`. This is also the Shorts rule: a Short cannot exceed
   3 minutes, so the 10-minute default excludes every one of them without a separate check.
3. Livestream (`liveStreamingDetails` present) and the source has `include_live` off →
   `live_excluded`.
4. `video_id` already on one of the author's sermon notes → `already_noted` (no new note).

**Then** the passage rules (§7). Each video is processed and committed on its own, so a failure
part-way (Concord down, quota out) leaves the finished ones finished and the rest untouched — the
ledger is the checkpoint, and a re-run is safe.

**Failure.** A YouTube error records on the source and stops that source's scan; the next source
still runs. Quota exhaustion (`403 quotaExceeded`) stops the whole run; it resumes at the next
scheduled check or "Check now".

## 7. Finding the passage

**Candidates.** A deliberately loose pattern over the text finds anything shaped like a reference —
optional leading `1`/`2`/`3`, one or two capitalized words (a trailing `.` allowed, so `2 Cor.`
works), a chapter, optional `:verse`, optional range using `-`, `–`, or `—`, optional `:verse` on the
range end (so `2 Chronicles 30:1–31:7` is one candidate). Dashes are normalized to `-` and the
abbreviation `.` dropped before the string goes to Concord. **Concord is the judge:** every candidate
is resolved via `/v1/verses/{ref}`; whatever Concord rejects (`Episode 63`, `Sunday 9:00`,
`Israel 24:03`) is discarded. songbird never decides what a book name means.

**Boilerplate.** A reference that appears in at least half of a source's ledgered videos (minimum
five videos) is treated as part of the channel's template — a giving verse, a church-name verse —
and is ignored everywhere for that source. (2819 Church is literally named after Matthew 28:19;
Cornerstone's descriptions carry a giving verse.) Recomputed from the ledger at each scan; the full
catalog scan fetches everything first, then computes this, then places.

**Rules, first hit wins; every reference on the winning text becomes its own note:**
1. **Labeled scripture line** — a description line whose label is one of `scripture`,
   `main scripture`, `scriptures`, `text`, `passage(s)`, `key verse(s)`, `bible reference(s)`,
   `reference(s)`, `reading`, followed by `:`. Take every reference on that line.
   *Celebration Church:* `Main Scripture: Acts 7:33–35 (with reference to Exodus 3:5–10)` → two notes.
2. **Title.** *2819 Church* titles appear to carry the passage in parentheses.
3. **First line of the description** (first non-empty line). *Cornerstone Chapel:*
   `7/22/2026 An in-depth study of 2 Chronicles 29.` → one note spanning the chapter.
4. Nothing → `needs_passage`, with every non-boilerplate reference found anywhere else in the
   description saved as `suggestions` for the review list. (Cornerstone's timestamp lines and
   *Majestic View*'s dated livestreams land here.)

A placed note records `placed_by` on its ledger row, so a wrong placement can be traced to the rule
that made it. The note's `reference` is the normalized candidate string; the anchor is whatever
Concord resolved it to (a chapter-only reference spans the chapter — the existing resolve behavior).

**One note per passage.** Same title (the video's title), same link, same date, same tags — one row
per reference on the winning line. A comma-continued list (`Romans 8:28, 31-39`) yields only the first
span; known limitation, listed in §13.

**Date.** `event_date` = the calendar day (UTC) of `liveStreamingDetails.actualStartTime` when
present — for a livestreamed service that is the service itself — else `snippet.publishedAt`, the
day the video went up. This is the rule the product owner asked for (the date the sermon was added to
the channel, not the date the note was made), and it is the same rule §11 applies to old notes.

**Tags.** The source's tags, through the same `resolve_tags` normalization every other note uses.

## 8. The review list

On the Sources page, filtered by status:
- **Needs a passage** (default): video title · source · date · "Watch" link · the `suggestions` as
  one-tap buttons (tap several → one note each) · a text box to type a reference · **Not a sermon**
  (dismiss). Placing goes through the same server-side resolve as a manual sermon note; all-or-nothing
  per action (if one reference fails to resolve, nothing is created and the failing one is named).
- **Skipped**: the reason (`too short`, `livestream excluded`) and a **Note it anyway** button that
  opens the same place action.
- **Dismissed**: restorable to *Needs a passage*.
- **Placed**: links to the notes it created.

## 9. API

Auth-gated and author-scoped, under `/api/v1/sermon-sources`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/sermon-sources` | List the user's sources with counts (placed / needs passage / skipped) |
| `POST` | `/api/v1/sermon-sources` | Add: `url`, `tags`, `include_live`, `min_minutes` → resolves via YouTube, then starts the catalog scan |
| `GET` / `PATCH` / `DELETE` | `/api/v1/sermon-sources/{id}` | Fetch / edit (`tags`, `enabled`, `include_live`, `min_minutes`) / delete (the ledger goes with it; created notes stay) |
| `POST` | `/api/v1/sermon-sources/{id}/check` | Check this source now → summary `{seen, placed, needs_passage, skipped}` |
| `POST` | `/api/v1/sermon-sources/check` | Check all enabled sources now |
| `GET` | `/api/v1/sermon-sources/status` | Key configured? interval, running?, last/next scheduled run |
| `GET` | `/api/v1/sermon-sources/videos?status=…` | The ledger, filtered (`needs_passage` default) |
| `POST` | `/api/v1/sermon-sources/videos/{id}/place` | Body `{references: [...]}` → one note per reference; row → `placed`/`manual` |
| `POST` | `/api/v1/sermon-sources/videos/{id}/dismiss` · `/restore` | Dismiss / undo |
| `POST` | `/api/v1/sermon-notes/redate` | §11: `?dry_run=true` returns the preview; without it, applies |

## 10. UI

- A **Sermon sources** page (`/sermon-sources`): the source list (title, tags, enabled, include
  livestreams, minimum minutes, last checked + status, counts), **Add source**, **Check all now**,
  per-source **Check now** / edit / delete, and the review list (§8). Linked from the top nav and from
  the Browse view's sermon controls (next to export/import).
- Without a key, the page shows one short explanation and the walkthrough link; nothing else appears.
- Responsive like the rest of the app; no new dependencies.

## 11. Re-dating existing notes (the one-time cleanup)

An in-app action rather than a script: the deploy is Docker, the image does not ship `scripts/`, and
the action needs the same YouTube client the app already has. On the Sources page: **Re-date YouTube
sermons** → the server collects the author's sermon notes with a YouTube link, looks the videos up in
batches of 50, and returns a **preview table** — title · current date → new date · link — plus the
notes it could not look up (private/removed; left untouched). Nothing is written until **Apply**.
Apply sets `event_date` by the §7 date rule and stamps `youtube_video_id` on every note it touched,
which is what lets a later catalog scan treat those videos as `already_noted`. Re-runnable; the
preview is the gate, mirroring the seed loader's dry-run.

## 12. Cross-check against the product owner's real sources

- **@CelebrationChurch_org** — labeled `Main Scripture:` line → rule 1, often two notes per sermon.
- **@cornerstonechpl** — the edited uploads open with `An in-depth study of <passage>.` → rule 3.
  The same sermon is also streamed three times each Sunday plus Wednesday, with no passage in the
  stream's text; with `include_live` **off** for this source those are skipped, not queued. Their short
  daily devotionals fall under the length rule.
- **@2819Church** — titles appear to carry the passage → rule 2; `Matthew 28:19` in the channel's
  template is caught by the boilerplate rule.
- **@majesticviewchurchlive407** — sermons are livestreams (`include_live` on, the default) titled by
  date with no passage in the text; they will land in **Needs a passage** every week. That is the
  honest outcome: one tap with the reference, not a guess.

## 13. Deferred (not this feature)

- An AI reading of the description for sermons with no written passage (would be a sidecar service
  by the CLAUDE.md rule; the review list covers the gap today).
- Dates in a local timezone (UTC calendar day for now; a re-run of §11 would apply a change).
- Comma-continued verse lists (`8:28, 31-39`) as a single multi-span anchor.
- Other platforms (Vimeo, podcast feeds). The source `kind` column leaves the door open.
- Per-source custom placement patterns (regex). The three built-in rules cover all four real sources.

## 14. Definition of done (feature)

- One YouTube client, key never logged or served; feature cleanly off without a key.
- Sources CRUD; adding a source scans its full catalog; scheduled + on-demand checks; one scan at a
  time; per-source failure recording; the app never errors because YouTube did.
- Filters and rules as specified, with the real Celebration / Cornerstone / 2819 description shapes as
  test fixtures; boilerplate exclusion tested against a repeated reference.
- Created notes are ordinary sermon notes: canonical anchor via Concord (invariant 4 test applies),
  shared tags, `event_date` by the date rule, `youtube_video_id` stamped.
- Review list: place (one note per reference, all-or-nothing), dismiss, restore, note-it-anyway.
- Re-date action with preview-then-apply; back-fills `youtube_video_id`.
- User's Guide section (with the key walkthrough), CHANGELOG entry, compose comments, SECURITY note.

## 15. Slice plan

Smallest reviewable, load-bearing unit; branch `slice/N-…`, PR per slice, Plan Mode first.

1. **Foundation** — settings (§3), the YouTube client with a fake for tests, the YouTube-URL → video
   id helper, `sermon_notes.youtube_video_id` (migration `0010`) stamped on create/update.
2. **Re-date** (§11) — the endpoint (preview/apply) and its button + preview table. Ships the cleanup
   first and proves the client against real data.
3. **Sources CRUD** (§4–5, no scanning) — tables + join (`0011`), API, the Sources page with add /
   list / edit / delete; adding a source resolves it through YouTube.
4. **The scan** (§6–7) — the ledger (`0012`), filters, candidate finder, rules, boilerplate, note
   creation, "Check now". Fixture-driven tests on the real description shapes.
5. **Review list** (§8) — place / dismiss / restore / note-it-anyway, UI.
6. **Schedule + docs** — the in-process timer with boot catch-up, status endpoint, compose lines,
   User's Guide walkthrough, CHANGELOG, SECURITY note, Dockerfile comment.

Slices 3 and 4 could merge if the CRUD alone feels too thin to review; the default is to keep them
apart so the scan lands as one focused diff.
