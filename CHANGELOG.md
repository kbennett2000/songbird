# Changelog

What's changed in songbird, newest first — written for the people who use it, not just the people
who build it. For how to *use* any feature, see the **[User's Guide](docs/USER-GUIDE.md)**.

This project follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/). Each version is named after the feature line it shipped
(matching the design notes under `docs/`).

> **About the tags and dates.** songbird's release tags drifted: the early versions were tagged
> (`v1.0.0`, `v1.1.0`), then everything from sermon notes onward shipped without a tag. **v1.6.0** is
> the release that re-aligns the tag with the feature line and reconciles the package versions. The
> earlier versions below are documented here for a complete, honest history but are **not**
> retroactively tagged. Dates are taken from git (release tags for 1.0–1.1; the first commit of each
> feature's design notes for 1.2–1.5); songbird was built in a tight burst, so treat them as the
> order things landed rather than precise release days.

## [Unreleased]

### Added
- **songbird can follow your church's YouTube channel and write the sermon notes for you.** Add a
  channel or playlist once, on the new **Sermon sources** page, and songbird reads through it: for
  each sermon it looks for the passage in the video's own words — a "Scripture:" line in the
  description, the passage in the title, or the opening line — and makes an ordinary sermon note for
  each one it finds. The notes are dated the day the sermon actually went up (a Sunday service
  streamed in the morning and posted after midnight is still filed under the Sunday), tagged the way
  you tagged the source, and they show up in the reader and in Browse exactly like the notes you
  write yourself, on every translation. songbird asks Concord what each reference means rather than
  guessing, so anything it can't be sure of it leaves alone. Sermons whose passage was never written
  down anywhere wait in a **Needs a passage** list, with any references songbird did spot shown
  beside them — the one-tap way to place those is coming next. A sermon you'd already noted by hand
  is left as it is. This needs the same free YouTube key as the re-dating button below.
- **Your sermon notes can take their dates from YouTube.** A sermon note you made by hand carries
  whatever date you typed — usually the day you wrote the note, not the day the sermon was preached.
  On the Browse notes page there's now a **Re-date YouTube sermons** button: songbird looks up every
  sermon note that links to a YouTube video and shows you exactly what it would change — the old
  date, the new one, and whether it came from when the service was streamed or when the video was
  posted. Nothing is written until you press **Apply**, and pressing it twice is safe. Sermons hosted
  somewhere other than YouTube are left alone, and so are videos that have since been made private or
  removed — those are listed so you know they were skipped rather than missed. This needs a free
  YouTube API key; without one the button explains what to set, and the rest of songbird is unchanged.

### Fixed
- **All notes on a verse now show, not just one.** When a verse carried more than one note, the
  reader and the side-by-side compare view showed a single marker and opened only the first note —
  the others were invisible and unreachable. The marker now carries a small count, and tapping it
  lists every note so you can open any of them. A verse with a single note is unchanged.
  ([#114](https://github.com/kbennett2000/songbird/issues/114))
- **The multiple-notes list is calmer and easier to read.** That list used to show each note's full
  text as one long, run-together scroll. It's now a tidy stack of cards — one clear preview line per
  note, with its tags, and obvious gaps between them (in dark mode too). Tap a note to open it in
  full. ([#116](https://github.com/kbennett2000/songbird/issues/116))
- **Highlighted verses look right in dark mode.** A verse carrying a note used to be washed in a
  heavy orange-brown. On a chapter where you've marked a dozen verses in a row it turned most of the
  page that colour, and it buried the small dot you tap to open the note. Marked verses now sit on a
  faint grey lift with a slim amber line down the left edge — you can see at a glance which run of
  verses you've written on, without the page changing colour. The same pass fixed the things around
  it that had been left with daylight colours: the note pop-ups, the count on a verse with several
  notes, highlighted words in search results, and the note labels on your home page. Light mode is
  unchanged. ([#122](https://github.com/kbennett2000/songbird/issues/122))

## [1.6.0] — 2026-06-09

The big fan-out — four study features at once, plus a proper guide.

### Added
- **Section headings in the reader.** Translations that carry editorial headings (like "The Beatitudes")
  now show them in place as you read, with a small banner noting where they came from.
- **The topical Bible.** Open a verse to see the topics it belongs to, and drill in to read every verse
  on a topic — or browse the whole topic list to explore by theme.
- **Original-language word study.** Open any verse in its original Hebrew or Greek, laid out word by
  word; tap a word for its meaning and a concordance of every place it appears.
- **Journeys.** Follow a Scripture journey — the Exodus, Paul's travels — as an ordered list of stops
  and traced on a map, each stop tied to the passage it comes from. A place's page now also lists the
  journeys that pass through it. Honest about stops it can't place on the map: they're listed, not
  guessed.
- **The User's Guide.** A single, screenshot-illustrated walkthrough of every feature, linked from the
  README.

### Changed
- The README is now a short landing page that points to the User's Guide, rather than carrying the
  feature how-to itself.

## [1.5.0] — 2026-06-07

### Added
- **Verse of the day.** The welcome page now greets you with a verse to start from.

## [1.4.0] — 2026-06-07

### Added
- **Places gazetteer.** Browse the people-and-places of the Bible world, open any place to read the
  verses that mention it, and see a passage's places pinned on a map.

## [1.3.0] — 2026-06-07

### Added
- **Search, expanded.** Keyword search now spans multiple translations, and your own study notes are
  searchable alongside Scripture.

## [1.2.0] — 2026-06-07

### Added
- **Sermon notes.** Attach a sermon — title, speaker, your notes — to the passage it was preached on,
  and find it again from that passage.

## [1.1.0] — 2026-06-06

### Added
- **The map.** See a passage's places pinned on a map of the Bible world, honest about the ones it
  can't place.

## [1.0.0] — 2026-06-06

### Added
- **The first release.** Read a Bible translation, highlight a verse, and write a Markdown note behind
  it — anchored to the verse's canonical address, so it follows you across translations. Tag your
  notes and search them. Switch translations without losing your place or your notes. Self-hosted: the
  Scripture comes from [Concord](https://github.com/kbennett2000/concord); songbird keeps only your
  notes, on your own machine.

[1.6.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.6.0
[1.1.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.1.0
[1.0.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.0.0
