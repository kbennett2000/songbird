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
