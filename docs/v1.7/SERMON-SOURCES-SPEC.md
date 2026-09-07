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
  *Keeping it unlogged takes three mechanisms, not one — slice 1 found this the hard way.* httpx
  puts the full request URL into `HTTPStatusError`'s message, so a `raise ... from exc` (the
  `ConcordClient` idiom) leaks the key through any rendered traceback: every raise in the YouTube
  client is `from None` with a redacted message, and nothing keeps the httpx exception, its
  request, or its response. And httpx logs `HTTP Request: GET <full url>` at **INFO on every
  successful call**, which `logging.basicConfig(level=INFO)` in `create_app()` then prints — so
  the client also installs a redacting `logging.Filter` on the `httpx` logger. Without that
  filter a working deployment prints the key on every request; redacted exceptions do nothing
  about it.
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
(UTC), `actual_start_time` (UTC, nullable — when a stream began), `duration_seconds`, `is_live` (was
a livestream), `status` (**`pending`** | `placed` | `needs_passage` | `skipped` | `dismissed` |
`already_noted`), `skip_reason` (nullable: `too_short` | `live_excluded`), `placed_by` (nullable:
`scripture_line` | `title` | `first_line` | `manual`), `suggestions` (JSON list of reference strings
found deeper in the text, §7), `seen_at`, `decided_at` (**when the row was last decided** — null
while it is still `pending`; slice 5 restamps it on every place, dismiss, restore and reopen, since
a row can now be decided more than once). Index on (`author_id`, `status`) for the
review list and on (`author_id`, `video_id`) for the "have we seen this" check — the latter is the
uniqueness constraint itself, which in SQLite *is* an index.

*As built (slice 4a):* **`pending`** is the entry state — fetched and filtered, but not yet read for
a passage. It is the seam between 4a and 4b (§15), and it is what makes a scan resumable: fetching
depends only on YouTube, evaluation only on Concord, and either can fail without losing the other's
work. **`actual_start_time` is stored beside `published_at`** because the two genuinely disagree and
the ledger has to show the day a reader sees on YouTube: a service streamed at 14:55 UTC on the
Sunday is routinely published at 04:32 on the Monday, so `published_at` alone dates it a day late —
which is the §7 rule applied to the ledger as well as to the note.

Two columns on **`sermon_sources`** drive the checking: **`check_requested_at`** (nullable) is the
durable half of "Check now" — the button writes it down and the background runner clears it when
that source's check finishes, so a restart mid-scan loses nothing. **`scan_complete`** (bool) says
whether the last check paged the catalogue all the way to its natural stop; see §6.

**`sermon_notes.youtube_video_id`** — new nullable indexed column. Set server-side on create/update
whenever `sermon_url` is a YouTube link (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`,
share suffixes like `?si=` ignored), and back-filled for existing notes by §11. This is how a scan
knows a video was already noted by hand. **`sermon_notes.source_video_id`** — nullable, indexed, pointing at the
ledger row that created the note, so the review list can show "placed → note".

*As built (slice 4b, migration `0013`):* the **model** declares the foreign key with
`ON DELETE SET NULL`; the **migration adds a plain column with no `REFERENCES` clause**. SQLite
cannot add a constraint to a table that already exists — `ALTER TABLE … ADD COLUMN … REFERENCES` is
emitted by Alembic as a separate `ADD CONSTRAINT` that fails *after* the column has landed, leaving
a half-applied migration; and `batch_alter_table`, which rebuilds the table instead, refuses because
reflection finds an unnamed foreign key on `sermon_notes` (0006's link to `users`). The divergence
is deliberate and checked: the migration's schema was diffed column-for-column and index-for-index
against the model, and they match everywhere except that one line. It costs nothing at runtime,
because SQLite does not enforce foreign keys anyway — `PRAGMA foreign_keys` defaults to off and
songbird never turns it on, so **the delete route nulls the link explicitly** rather than trusting
the schema, exactly as it already does for the ledger's `CASCADE`.

## 5. Adding a source

Paste a YouTube link. Accepted forms: `youtube.com/@handle` (the common case),
`youtube.com/channel/UC…`, `youtube.com/playlist?list=PL…`. Anything else (old `/c/name`, `/user/name`
links) → a clear message asking for the channel's `@handle` link. songbird resolves the link through
YouTube once (`channels.list?forHandle=` / `?id=`, or `playlists.list`), stores the id, the uploads
playlist id, and the title, then runs the **first scan immediately: the whole back catalog.** For a
curated playlist source the playlist is the catalog.

*As built:* slice 3 does the resolve-and-store half; the scan-on-add arrives with the scan itself in
slice 4 (§15). **An unknown handle or id comes back as HTTP 200 with no `items`, not a 404** —
confirmed live — so "nothing came back" is where a genuine not-found is detected. A link songbird
cannot parse is rejected before any lookup, so a typo costs no quota.

Why a playlist option: some churches keep a "Messages" playlist that excludes worship nights and
announcements — a cleaner catalog than the channel's uploads.

## 6. The scan

**When.** (a) On add (full catalog). (b) On "Check now" — one source or all. (c) On the schedule:
an `asyncio` task started in the app lifespan runs every `SERMON_CHECK_INTERVAL_HOURS`; at boot, any
enabled source whose `last_checked_at` is older than the interval is checked shortly after start, so a
weekly interval survives restarts. One scan at a time (a process-wide lock); the Sources page shows
"checking…" while it runs. songbird is one process, so an in-process timer is enough — no sidecar, no
cron.

*As built (slice 4a): the trigger and the work are separate.* A catalogue scan is dozens of Google
calls, so it cannot sit inside a request. **"Check now" — and adding a source — only write
`check_requested_at` down and answer `202`**; one background `asyncio` task then processes every
source that is *due* (a request pending, or never checked at all) and ends when nothing is left. The
page polls `/status` while it runs. Three consequences worth stating:

- **"One scan at a time" needs no lock.** The trigger is a plain synchronous function, so on a
  single-threaded event loop nothing can run between "is one going?" and "start one" — and a lock's
  own `acquire()` would reintroduce exactly the interleaving it was reached for. A separate flag
  covers the one gap a liveness check cannot: a run that has just asked "anything left?" is not yet
  finished, so a request arriving in that instant would otherwise be dropped in silence.
- **A request made *during* a source's own check survives it.** The clear is conditional on the
  request being older than the check that served it, so pressing "Check now" three minutes into a
  back-catalogue scan is honoured on the next pass rather than vanishing.
- **The scheduled check (c) needs no scan logic of its own.** Slice 6's timer sets
  `check_requested_at` on every enabled source when the interval elapses; this runner does the rest.

**What.** List the source's playlist newest-first (`playlistItems.list`, 50 per page, 1 unit each);
stop at the first page where every video is already in the ledger (a curated playlist is paged fully —
its order isn't chronological).

*As built:* **the stop rule is only safe after a check that finished.** It assumes every page above
the stop is complete, so a scan that committed page one and then failed on page two would leave page
one entirely known — and every later check would stop there, putting the rest of the catalogue
permanently out of reach with no error anywhere. So a source pages its whole catalogue unless
`scan_complete` says its last check ran to its natural stop. That flag is written `false` as part of
the first batch's commit rather than in a cleanup step, which is what also covers a container restart
or a power cut; a failure that never consumed a page leaves it alone, so a transient blip does not
cost every source a full re-walk. Re-walking is cheap in any case: paging an already-scanned channel
spends one unit per page and **no** detail calls, because there is nothing unseen to ask about. Fetch the unseen videos' details in batches of 50
(`videos.list?part=snippet,contentDetails,liveStreamingDetails`, 1 unit per batch): title,
description, `publishedAt`, `liveBroadcastContent`, `duration`, `actualStartTime`.

**Filters, in order** (a filtered video is ledgered as `skipped` with its reason, so nothing is
silently hidden):
1. `liveBroadcastContent` is `upcoming` or `live` → not ledgered at all; it is re-seen once finished.
2. Duration < the source's minimum → `too_short`. This is also the Shorts rule: a Short cannot exceed
   3 minutes, so the 10-minute default excludes every one of them without a separate check.
   **An unknown duration is not a short one.** The client parses a missing or unrecognised
   `contentDetails.duration` to `None` rather than `0`, because filing such a video under
   `too_short` would record a reason it has not earned — the opposite of this section's promise
   that nothing is silently hidden. So the test is `duration is not None and duration < minimum`,
   and a video of unknown length falls through to the passage rules and, failing those, into the
   review list. (A genuine `PT0S`/`P0D` is `0` and is still too short.)
3. Livestream (`liveStreamingDetails` present) and the source has `include_live` off →
   `live_excluded`.
4. `video_id` already on one of the author's sermon notes → `already_noted` (no new note).

**Then** the passage rules (§7). Each video is processed and committed on its own, so a failure
part-way (Concord down, quota out) leaves the finished ones finished and the rest untouched — the
ledger is the checkpoint, and a re-run is safe.

*As built:* the fetch half commits **per batch of fifty** rather than per video. Fifty is one quota
unit and about a second of work, and 4a creates no notes, so that is the natural checkpoint; the
placement half, which calls Concord once per video, keeps the per-video commit this paragraph
describes.

**Failure.** A YouTube error records on the source and stops that source's scan; the next source
still runs. Quota exhaustion (`403 quotaExceeded`) stops the whole run; it resumes at the next
scheduled check or "Check now".

## 7. Finding the passage

**Candidates.** A deliberately loose pattern over the text finds anything shaped like a reference —
optional leading `1`/`2`/`3` (or `I`/`II`/`III`, normalized to digits), one or two capitalized words
(a trailing `.` allowed, so `2 Cor.` works), a chapter, optional `:verse`, optional range using `-`,
`–`, or `—`, optional `:verse` on the range end (so `2 Chronicles 30:1–31:7` is one candidate).
Dashes are normalized to `-`, the abbreviation `.` dropped and whitespace collapsed before the
string goes to Concord — the normalizing matters less for resolution (Concord reads Roman numerals,
trailing periods and shouted case perfectly well) than for **counting**, since the boilerplate rule
below tallies strings and a template that writes `II Timothy 2:2` one week and `2 Timothy 2:2` the
next must count once. **Concord is the judge:** every candidate is resolved via `/v1/verses/{ref}`;
whatever Concord rejects (`Episode 63`, `Sunday 9:30`, `Israel 24:13` — all three confirmed live as
a 404) is discarded. songbird never decides what a book name means.

*As built (slice 4b):* **a two-word book name also offers its second word alone.** Two words are
allowed because people write `First Corinthians 13`, but that also lets the pattern swallow a real
reference behind any capitalized word in front of it: in `Sunday Service John 3:16` the book part
matches `Service John`, Concord refuses it, and `John 3:16` is never offered at all — a sermon that
plainly states its passage would go to the review list. So the second word is offered as well. It is
safe because Concord refuses a bare ambiguous name (`Corinthians 13` and `Peter 1:6-7` are both a
404, checked live), so the extra candidate can only resolve when the second word is a whole book
name. It costs one lookup, answered from the run's cache after the first time.

**Dates are not references.** The one thing the finder decides for itself, and it is a judgement
about the shape of the surrounding text rather than about what a word means. Churches title services
by the day they happened, in two shapes, and both collide with a real reference.

*Written with a month name.* A candidate whose book part is a bare month — full name or three-letter
short form, period optional, any case — is dropped when it either carries no verse part or is
followed immediately by a four-digit year (a comma and an ordinal suffix both optional). `Mark 15`
and `Mar. 15:16-20` still go to Concord; `Mar. 15 2026`, `Mar. 15, 2026`, `Mar. 15th 2026` and a
year-less `Sunday Service Mar. 15` do not.

*Written in digits.* A candidate is dropped when **either** a number in its span is written with a
leading zero — a chapter is never `06` and a verse is never `:03`, while every numeric date pads —
**or** the rest of a date sits immediately behind it: a separator (`-`, `–`, `—`, `/` or `.`,
whitespace optional either side, as above) and a four-digit year, with an optional day of its own in
between. That day part matters because `/` is not a span separator: in `John 6/25/2020` the
candidate is only `John 6`, and the year is not directly behind it. Unlike the month rule this asks
nothing about the book part, so it drops the second-word reading too — `Pastor John 06-25` and
`John 06-25` are both the date. `John 6-25`, `John 6:25` and `Genesis 1-11` are untouched.

This second rule exists because the by-eye audit of slice 4b found **one wrong note in 1,082**, and
this was it: Majestic View's `MVC - Talking About Respect with Pastor John 06-25-2020`. `John 06-25`
is a reference Concord correctly reads as John 6–25, so a video about respect carried a note
spanning sixteen chapters. Slice 5's review list gave that a one-tap cure; this is the prevention.
Two things follow, both accepted. It also stops offering video timestamps (`9:00`, `24:03`), which
were only ever costing a lookup that came back 404 — a small bonus. And because whitespace is
allowed either side of the separator, a series title like `Genesis 1 - 2025 Vision Series` loses its
candidate and the video goes to the review list instead: a miss into the list is the safe direction,
and it is one tap to place.

This exists because live acceptance found it the hard way. Majestic View titles every service by the
day it happened, and **`Mar.` is an abbreviation Concord accepts for Mark** — so `Mar. 15 2026`
became a note on Mark 15. Five notes in the first run were wrong that way, and three of them were
the *only* note on their video, so those videos were confidently mis-placed instead of going to the
review list where they belonged. Every other month is in the rule for uniformity, not necessity: no
other month collides with a book, and dropping them only saves a lookup that came back 404 (all 36
month strings the four real sources produce were checked against live Concord — every one refused).
`Sept` is deliberately **not** in the set, because the short form here is three letters and nothing
Concord knows answers to `Sept`; the cost of that is one wasted lookup, which is the safe direction.

**Boilerplate.** A reference that appears in at least half of a source's ledgered videos — `ceil(n/2)`
— is treated as part of the channel's template, a giving verse or a church-name verse, and is
ignored everywhere for that source: excluded from the rules *and* from the suggestions. The rule is
**switched off entirely below five ledgered videos**. Five is a sample-size floor, not an occurrence
count: under it, "half" is two or three, and a two-part series on one passage would strike out its
own passage. The failure this accepts instead is a short series landing in the review list, one tap
each. Recomputed from the ledger at each scan over **all** of a source's rows — skipped and
already-noted included, because a bigger denominator makes a template easier to see — and the full
catalog scan fetches everything first, then computes this, then places.

*As built:* boilerplate matches **normalized candidate strings, not resolved anchors**, so a
template that writes one reference two ways whose normalizations still differ can evade it. Listed
in §13. And see §12: on all four real sources today the rule strikes nothing out at all.

**Rules, first hit wins; every reference on the winning text becomes its own note.** A *hit* is at
least one candidate on that rule's text which survives boilerplate **and** resolves through Concord —
so a labelled line reading `Scripture: TBA` does not win by existing and shadow a real reference
below it.
1. **Labeled scripture line** — a description line whose label is one of `scripture`,
   `main scripture`, `scriptures`, `text`, `passage(s)`, `key verse(s)`, `bible reference(s)`,
   `reference(s)`, `reading`, followed by `:`. Matched case-insensitively and through leading
   decoration (`*`, `#`, `-`, `•`, an emoji). Take every reference on that line.
   *Celebration Church:* `Main Scripture: Acts 7:33–35 (with reference to Exodus 3:5–10)` → two notes.
   **The heading extension:** when the text after the colon yields no candidate — the
   `Scripture References:` heading with a list beneath it — the following lines are taken instead,
   stopping at a blank line or at the first line carrying no candidate. That stop rule is textual: it
   asks whether a line *has* something reference-shaped on it, never whether Concord likes it, so
   where the block ends does not depend on a network call.
2. **Title.**
3. **First line of the description** (first non-empty line).
4. Nothing → `needs_passage`, with every non-boilerplate reference that resolves anywhere else in
   the **description** saved as `suggestions` for the review list, deduplicated and in order of
   appearance.

A placed note records `placed_by` on its ledger row, so a wrong placement can be traced to the rule
that made it. The note's `reference` is **Concord's own string** for the resolved span, not the text
the church typed: Concord normalizes as it resolves, so `2 Cor 5:17` comes back `2 Corinthians 5:17`
and a shouted `MATTHEW 28:19` comes back `Matthew 28:19` (both checked live). That is what gives
scan-created notes one consistent spelling. `suggestions` store the same strings, so slice 5's
one-tap place re-resolves exactly what the reader was shown. The anchor is whatever Concord resolved
the reference to — a chapter-only reference spans the chapter, the existing resolve behavior.
Resolved references are collapsed by **anchor**, not by string, so `2 Cor. 5` and `2 Corinthians 5`
on one line make one note rather than two.

**One note per passage.** Same title (the video's title), same link, same date, same tags — one row
per reference on the winning line. A comma-continued list (`Romans 8:28, 31-39`) yields only the first
span; known limitation, listed in §13.

**Date.** `event_date` = the calendar day (UTC) of `liveStreamingDetails.actualStartTime` when
present — for a livestreamed service that is the service itself — else `snippet.publishedAt`, the
day the video went up. The two genuinely disagree, and often: Majestic View's 6 September 2026
service started at `2026-09-06T14:55:12Z` and was published at `2026-09-07T04:32:29Z`, so
`publishedAt` would file a Sunday sermon under Monday. YouTube's own page labels it "Streamed live
on Sep 6, 2026" — this rule makes songbird agree with what a reader sees on YouTube. This is the rule the product owner asked for (the date the sermon was added to
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

*As built (slice 5).* The list this describes is the one the live data demands: **one church left
351 rows in `needs_passage` after a single scan**, because a service titled by its date names no
passage, and they get worked through a few at a time over months. Five things follow from that
number.

**One definition of what a filter selects.** The listing (`GET /videos`) grows `published_after`,
`published_before` and `q` (a case-insensitive title substring), and the bulk dismiss takes the same
five fields as its body. Both go through one WHERE builder, because a sweep that selected different
rows from the ones on screen would dismiss videos the reader never saw and nothing on the page would
show that it had. The listing also answers with **`counts`** — the same filter tallied per state
with the state clause removed — which puts a number beside every state in the filter bar and is
where the bulk button gets its N.

**The dates compare against the day the row shows** — `coalesce(actual_start_time, published_at)`,
the §7 rule expressed in SQL. A service streamed 14:55 on the Sunday and posted 04:32 on the Monday
displays as Sunday, and a filter that disagreed with the screen would be a filter feeding a bulk
write. Ordering stays by `published_at`: the two differ by at most a day, and re-sorting a list
somebody is working through row by row is worse than the inconsistency.

**Undo has one rule, shared by restore and reopen.** A row carrying a `skip_reason` goes back to
`skipped` with its reason; everything else goes to `needs_passage`. `skip_reason` is the only record
of where a row came from, which is why **placing keeps it** rather than clearing it — without that,
"Note it anyway" followed by "Wrong passage" would quietly promote a three-minute announcement clip
into the sermon queue.

**Reopen, and its automatic half.** `POST /videos/{id}/reopen` on a placed row deletes the notes
that row created — scoped by `source_video_id`, so a note the owner wrote by hand on the same sermon
is untouched — clears `placed_by`, keeps the suggestions, and applies the rule above. It is the fix
path for the defect this feature is most likely to produce: a title that reads as a reference and
isn't (§13). **The same reopening happens when the last note behind a video is deleted through the
ordinary sermon-note DELETE**, because otherwise deleting a wrong note from Browse would leave the
row marked `placed` with nothing behind it — invisible in the review list, findable only by someone
who thought to filter by a state they had no reason to suspect. A surviving sibling note leaves the
row alone, and so does a row somebody has since decided something else about.

**The bulk dismiss, and the two things it will not do.** `POST /videos/dismiss-matching` marks
everything the filter selects as not a sermon and answers with the count. It **refuses an empty
filter** (422 `EMPTY_FILTER`) — unrecoverable in one action, since restore is per row — and it
**only ever touches rows in `needs_passage` or `skipped`**, so however wide the filter it can never
delete a note, and never throw away a `pending` row the next check is about to read. The count it
returns can therefore be smaller than the number of rows on screen, and it is the count that gets
reported. In the UI the offer is narrower still: a **state on its own does not earn the button**.
Choosing "Needs a passage" is the first thing anybody does, and the live pass found it putting
"Dismiss all 349 matching" on screen before a single row had been read — so the sweep needs a
source, a date or a search behind it.

**Anything else is a 409** (`VIDEO_STATE`): the row is real and yours, and it has already moved on,
usually because another tab is showing a state that stopped being true. Placing is allowed from
`needs_passage`, `skipped` and `dismissed`.

**A row that is acted on stays where it is** and grows its undo, rather than dropping out of a
filtered list. It keeps the reader's place among hundreds, puts the mistake just made within reach,
and means no action refetches the pages already loaded. The per-state counts are moved with the row,
or the bulk button would start promising a number the server would not deliver. Only the bulk sweep
refetches — it changes rows wholesale, so there is no place left to keep.

**No migration.** `dismissed` and `manual` were already legal values of the plain `String(24)`
`status` and `placed_by` columns — the vocabulary is held in Python at both ends by design (§4) —
and `skip_reason` already carried everything undo needs. The absence of a `0014` is deliberate.

## 9. API

Auth-gated and author-scoped, under `/api/v1/sermon-sources`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/sermon-sources` | List the user's sources with counts (placed / needs passage / skipped) |
| `POST` | `/api/v1/sermon-sources` | Add: `url`, `tags`, `include_live`, `min_minutes` → resolves via YouTube, then starts the catalog scan |
| `GET` / `PATCH` / `DELETE` | `/api/v1/sermon-sources/{id}` | Fetch / edit (`tags`, `enabled`, `include_live`, `min_minutes`) / delete (the ledger goes with it; created notes stay) |
| `POST` | `/api/v1/sermon-sources/{id}/check` | Check this source now → `202 {queued}` |
| `POST` | `/api/v1/sermon-sources/check` | Check all enabled sources now → `202 {queued}` |
| `GET` | `/api/v1/sermon-sources/status` | Key configured? interval, running?, last/next scheduled run |
| `GET` | `/api/v1/sermon-sources/videos?status=…&source_id=…&published_after=…&published_before=…&q=…` | The ledger, filtered (no filter = every state); answers `{videos, total, counts}` |
| `POST` | `/api/v1/sermon-sources/videos/{id}/place` | Body `{references: [...]}` → one note per reference; row → `placed`/`manual` |
| `POST` | `/api/v1/sermon-sources/videos/{id}/dismiss` · `/restore` | Dismiss / undo |
| `POST` | `/api/v1/sermon-sources/videos/{id}/reopen` | §8: delete the notes this row made, put it back in the list |
| `POST` | `/api/v1/sermon-sources/videos/dismiss-matching` | Body = the listing's filters → `{dismissed: n}`; 422 on an empty filter |
| `POST` | `/api/v1/sermon-notes/redate` | §11: `?dry_run=true` returns the preview; without it, applies |

*As built (slice 4a), two corrections this table needed:*

- **The check endpoints answer `202 {queued: n}`, not a summary.** They were written when the scan
  was going to happen inside the request; it does not (§6), so there are no results to report yet —
  only how many sources were accepted into the queue. A paused source queues nothing and is not
  stamped, because the runner would never pick it up and the row would then say "waiting to be
  checked" for ever. Both endpoints still require a key: queueing work that could never run is a lie
  told in the friendliest possible way. **`GET /videos` does not** — it reads songbird's own table,
  and a key rotated out must not take away the record of what was already found.
*As built (slice 5):*

- **The four row actions live in their own module** (`api/sermon_review.py`) on the same prefix, the
  shape `sermon_redate.py` already uses. `sermon_sources.py` is the catalogue — registering a channel
  and reporting what has been seen; this is the deciding, and the two review as separate diffs. The
  scoping, the filter builder and the row-shaped response they share live in `api/_sermon_ledger.py`.
- **Every action answers with the updated row**, in the same shape a page of them uses, so the list
  can redraw one row instead of refetching hundreds (§8).
- **`dismiss-matching` is declared before `/videos/{id}/…`** for the reason `/status` and `/videos`
  already document, and has its own test.

- **The ledger's default filter is every state, not `needs_passage`.** Nothing can *be*
  `needs_passage` until the placement slice, so that default would answer the first person who ever
  opens the view with an empty list. Which state to show first is the client's business.

## 10. UI

- A **Sermon sources** page (`/sermon-sources`): the source list (title, tags, enabled, include
  livestreams, minimum minutes, last checked + status, counts), **Add source**, **Check all now**,
  per-source **Check now** / edit / delete, and the review list (§8). Linked from the top nav (as
  "Sources", which is what fits at phone width) and from the Browse view's sermon controls (next to
  export/import). The counts, "Check now" and the review list arrive with the slices that produce
  them (§15); slice 3 ships the list, add, edit and delete.
- **Editing cannot repoint a source.** The URL and the identity it resolved to are immutable — to
  follow a different channel you delete the source and add the new one, so a source's ledger can
  never be silently reattached to a catalog it did not come from.
- **The minimum-minutes field is a placeholder, not a prefill.** An empty field stores null, which
  means "follow `SERMON_MIN_MINUTES`". Writing today's default into every source would make raising
  the app-wide floor later reach none of them.
- Without a key, the page shows one short explanation and the walkthrough link; nothing else appears.
- Responsive like the rest of the app; no new dependencies.

## 11. Re-dating existing notes (the one-time cleanup)

An in-app action rather than a script: the deploy is Docker, the image does not ship `scripts/`, and
the action needs the same YouTube client the app already has. **Re-date YouTube sermons** →
the server collects the author's sermon notes with a YouTube link, looks the videos up in batches of
50, and returns a **preview** — title · reference · current date → new date · which timestamp
decided it · a Watch link — plus the notes it could not look up (private/removed; left untouched).
Nothing is written until **Apply**. Apply sets `event_date` by the §7 date rule and stamps
`youtube_video_id` on every YouTube-linked note it saw, including the ones YouTube could not return
— that id comes from the URL, not from YouTube, and it is what lets a later catalog scan treat those
videos as `already_noted`. Re-runnable; the preview is the gate, mirroring the seed loader's dry-run.

**Where the button lives.** The **Sources page** — its home, as originally written. Slice 2 parked it
on the Browse view only because that page did not exist yet; slice 3 built the page and moved it.
Browse keeps a link to Sources where the button used to be (§10).

**Not a table.** Written as "preview table", built as a list of cards: songbird has no `<table>`
anywhere, every list in the app is a stack of bordered cards, and five columns do not fit a phone.
Rows that would change show old → new; rows that already agree with YouTube stay visible but muted,
so the pass reads as thorough without the unchanged rows competing for attention. **Muted means a
dimmer colour, never a blanket opacity** — slice 3's browser pass found `opacity-60` had taken the
unchanged rows' own text to 2.3:1, under the 4.5:1 a reader needs. The same mistake as #122, and the
same rule: every text layer keeps its own contrast.

## 12. Cross-check against the product owner's real sources

**Rewritten after slice 4b's live acceptance.** Everything below the table was a guess before the
scan ran, and three of the guesses were wrong. What the four real sources actually do, over 2,671
videos and 1,082 notes:

| source | videos | scripture line | title | first line | needs a passage | skipped |
|---|---|---|---|---|---|---|
| @CelebrationChurch_org | 445 | 51 | 0 | 13 | 261 | 120 |
| @cornerstonechpl | 1,273 | 0 | 691 | 0 | 149 | 433 |
| @2819Church | 582 | 0 | 299 | 7 | 216 | 60 |
| @majesticviewchurchlive407 | 371 | 0 | 11 | 2 | 351 | 7 |

- **@CelebrationChurch_org** — as predicted: a labelled `Main Scripture:` line, rule 1, often two
  notes per sermon.
- **@cornerstonechpl** — **places by title, not by rule 3.** The prediction that its edited uploads
  open with `An in-depth study of <passage>.` was wrong about which text wins: the passage is in the
  title (`… | Mark 12:41-44 | Gary Hamrick`), the title is tried first, and rule 3 fires zero times
  on 1,273 videos. The `include_live` **off** guidance stands — that is what sends its three Sunday
  streams and the Wednesday one to `skipped` rather than the review list, and it is most of the 433.
- **@2819Church** — places by title, as predicted. But **its descriptions contain no `28:19` at
  all**, so the boilerplate rule catches nothing there. Its most repeated reference is
  `Acts 2:42-47`, in 9 videos of 582 — nowhere near half.
- **@majesticviewchurchlive407** — as predicted, almost the whole catalogue lands in **Needs a
  passage**: sermons are date-titled livestreams with no passage written down. That is the honest
  outcome, one tap each. It is also the source whose date-titling produced §7's date rule.

**The boilerplate rule fires on none of the four sources today.** It stays — it is unit-tested, it
costs nothing when it does not fire, and a channel that adds a template verse tomorrow needs it —
but nothing in the current data exercises it, and this section should not be read as saying
otherwise.

## 13. Deferred (not this feature)

- An AI reading of the description for sermons with no written passage (would be a sidecar service
  by the CLAUDE.md rule; the review list covers the gap today).
- Dates in a local timezone (UTC calendar day for now; a re-run of §11 would apply a change).
- Comma-continued verse lists (`8:28, 31-39`) as a single multi-span anchor.
- Other platforms (Vimeo, podcast feeds). The source `kind` column leaves the door open.
- Per-source custom placement patterns (regex). The three built-in rules cover all four real sources.

- **Reopening an `already_noted` row.** Deleting the last note behind a *placed* video puts it
  back in the review list (§8); deleting a hand-written note that made a video `already_noted` does
  not. Nothing links the two — an `already_noted` row is matched by `youtube_video_id` at scan time
  and no note ever points at it (§4) — so there is nothing to follow back. The video simply returns
  to the review list at the next check, which is the right answer arrived at slowly.

**Known limitations, found live in slice 4a:**

- **A broadcast that never airs is re-read on every check.** §6's first filter deliberately leaves an
  `upcoming` or `live` video unledgered, because it should be re-seen once it has finished. A stream
  that was scheduled and then abandoned never finishes, so it stays unledgered for ever — and while
  it sits on the newest page, the stop rule cannot fire there and that source pays two extra quota
  units per check. Majestic View has exactly one, a service scheduled for 19 July 2026 that still
  reads `upcoming`. Two units a week is not worth a special case, and the alternative — ledgering a
  video that may yet air — would be worse.
- **A video YouTube declines to return** (private, deleted, age-gated) is likewise never ledgered,
  with the same small recurring cost and the same reasoning.
- **A chapter-to-chapter range with a verse on one end is refused.** Cornerstone writes
  `Judges 13-14:11`; Concord will not resolve that shape, so those videos go to the review list —
  8 of them across 1,273. (A plain cross-chapter range with verses on both ends, `2 Chronicles
  30:1-31:7`, resolves fine.) Fixing it would mean songbird interpreting a reference rather than
  asking, which invariant 4 keeps out; a miss into the review list is the safe direction.
- **A source's boilerplate can be evaded by spelling.** The tally counts normalized candidate
  strings, so a template writing one reference two ways that normalize differently is counted twice
  and may clear neither half. Not observed live — no source currently has boilerplate at all (§12).
- **A video is ledgered by the first of an author's sources that sees it.** The ledger is unique per
  (author, video), so a church's curated playlist repeating its own uploads produces one row, not
  two — which is the point. The consequence is that the second source's own filter settings get no
  say over a video the first already decided.

## 14. Definition of done (feature)

- One YouTube client, key never logged or served; feature cleanly off without a key. "Never
  logged" is pinned by three tests: the key is absent from the full rendered traceback of every
  failure path, absent from the logs of a *successful* call, and the redacting log filter installs
  only once. (The middle one must set the level on the root logger — scoping it to `songbird`
  would make it unable to fail, since the logger that leaks is `httpx`'s.)
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
2. **Re-date** (§11) — the endpoint (preview/apply) and its button + preview list. Ships the cleanup
   first and proves the client against real data. **Also takes the `YOUTUBE_API_KEY` line in
   `docker-compose.yml`**, pulled forward from slice 6 so the re-date is usable on a Docker deploy as
   soon as it merges; the interval and minimum-minutes lines stay in slice 6 with the walkthrough.
3. **Sources CRUD** (§4–5, no scanning) — tables + join (`0011`), API, the Sources page with add /
   list / edit / delete; adding a source resolves it through YouTube.
4. **The scan** (§6–7), split in two because fetching and placing fail for different reasons, need
   different fixtures, and together make a diff nobody can review:
   - **4a — Fetch.** The ledger (`0012`), the playlist pager, the §6 filters, the background runner,
     "Check now", per-source counts and a read-only ledger view. Candidates land as `pending`.
   - **4b — Place.** ✅ The candidate finder, the §7 rules, boilerplate exclusion, note creation,
     and `sermon_notes.source_video_id` (`0013`). Consumes `pending`. Fixture-driven tests on the
     real description shapes, and a by-eye audit against the real channels that caught the date
     collision §7 now guards against.
5. **Review list** (§8) — ✅ place / dismiss / restore / note-it-anyway, plus reopen, the
   automatic reopen when a video's last note is deleted, the listing's date and title filters
   with per-state counts, and the bulk dismiss. Worked for real against 351 live rows, which is
   what found the six things the UI got wrong and the one that corrupted a scan.
6. **Schedule + docs** — the in-process timer with boot catch-up, status endpoint, compose lines,
   User's Guide walkthrough, CHANGELOG, SECURITY note, Dockerfile comment.

Slices 3 and 4 could merge if the CRUD alone feels too thin to review; the default is to keep them
apart so the scan lands as one focused diff. In the event 4 split again, for the same reason.
