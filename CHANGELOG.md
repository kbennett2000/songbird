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
- **A study Bible's front matter and its reading plan.** The Every Man's Bible prints more than
  notes: a copyright page, an introduction to the Bible and one to its translation, the people who
  made it, a one-year reading plan, and notes on the authors behind its *Personal Gold* features.
  An **About EMB** button beside the chapter's title (and a row on Settings) opens them, each in
  full. The reading plan shows a month at a time and opens on today's date; pick another month or
  day, or tap a reading to open that passage, then **About EMB** again to come back to the same
  day. songbird keeps no record of what you've read, and fetches every page from your Scripture
  engine as you open it, keeping no copy.
- **A book's introduction, one tap from the text.** A study Bible such as the Every Man's Bible
  introduces each of its 66 books: what it's about, who wrote it, when, an outline, key people and
  passages, how long it takes to read, and for many books a timeline. While you read that Bible, an
  **Introduction** button beside the chapter's title opens the book's introduction over the page.
  Its references take you to the passage, its picture opens full-screen, and **Close** puts you
  back on the line you left. Reading another translation with that Bible's notes ticked, the button
  names it (**EMB introduction**). songbird fetches each introduction from your Scripture engine as
  you open it and keeps no copy.
- **Charts you can read.** A study Bible's charts, such as the 44 in the Every Man's Bible, now
  show their picture when you open them, both while you read that Bible and when you borrow its
  notes into another translation. A chart's words are part of the picture, so tap it to see it
  full-screen. Zoom in with a pinch or a double-tap on a phone, or with + and − on a computer, and
  drag to move around. **Close** brings you back to the note. A chart that turns up on the Search
  page shows its title and a small picture you can tap the same way. songbird fetches each
  picture from your Scripture engine as you open it and keeps no copy.
- **← Prev and Next → buttons at the bottom of each chapter.** When you finish reading a chapter,
  you can go straight to the next one without scrolling back up. It opens at the top of the page.
  This works on both the reader and the Compare page.
- **Notes from other Bibles can follow you into the translation you're reading.** The new
  **Settings** page has a box for each Bible that has notes: NET's translator's notes, and a study
  Bible's notes such as the Every Man's Bible's. Tick one, and its notes appear while you read the
  ESV, KJV or any other translation. While reading, the **Notes ▾** button beside the chapter's
  title has the same boxes. Each note lands on the same words when songbird can find them,
  and otherwise at the end of the verse. Every note says which Bible it's from and quotes that
  Bible's wording. songbird remembers your choices, and if you'd already switched on NET's notes,
  they stay on.
- **A study Bible's notes, shown the way the book prints them.** When your Scripture engine carries
  a study Bible's notes (the Every Man's Bible is the first), tapping one shows what kind of note it
  is, its heading and the verses it covers, with its paragraphs, italics and lists intact. A blue
  reference inside a note takes you straight to that passage, and a long note scrolls. On the
  Search page these notes carry their own labels, and each says which Bible it came from when more
  than one Bible has notes.
- **Each Bible's notes have their own look.** With NET's and the Every Man's Bible's notes both
  showing, you can now tell them apart: NET's are plain violet numbers, as before, and the Every
  Man's Bible's are rose numbers in a little square. The difference is in the shape as well as the
  colour, so it holds in dark mode and for colour-blind eyes. Settings and the **Notes ▾** menu show
  each Bible's mark beside its name, and an open note names its Bible at the top.
- **Every study note a search finds, and a choice of whose.** The Search page used to stop at 20 study
  notes, so the Every Man's Bible's rarely showed up beside NET's far larger set. Now it says how many
  there are in all (*20 of 242*), and **Load more** brings the next 20. When more than one Bible has
  notes, a **From:** row lets you search just one Bible's notes, or **All** of them. If your Scripture
  engine can't be reached, the study notes now say so instead of quietly showing nothing.

### Changed
- **A Settings page, and a less crowded top of the screen.** Light or dark, which Bibles' notes to
  show, Sermon sources and Status now live on one **Settings** page, reached from the top right of
  every page. That takes four things off the top bar and the reader's bar, which on a phone is a
  whole line of controls. Settings also offers **Match this device**, which follows your phone or
  computer's own light or dark setting; the old switch couldn't get back to it.

### Fixed
- **A long note opens where there's room to read it.** Tapping a note low on the screen used to
  squeeze it into a small box underneath, even with most of the screen free above. If a note won't
  fit below its mark, it now opens on whichever side has more room.
- **Two marks side by side no longer read as one number.** Where two notes sit at the same spot,
  their numbers now have a small gap between them, so you see "6 7" rather than "67".
- **A note's title and headings stand out.** In longer notes, the title, the section headings, the
  smaller subheadings and the bold opening words all used to look the same. Now the title is the
  largest, a section heading has a thin line under it, a subheading is in small capitals, and bold
  opening words stay part of their paragraph.
- **Poetry that wraps is easier to follow.** When a line of poetry in a note is too long for the box,
  the part that wraps onto the next line is now indented, so it no longer looks like an extra line
  of the poem.
- **Reloading keeps your place.** After you jumped to a passage, the address bar still showed the
  chapter you started on, so reloading the page took you back there. It now follows you, so a
  reload or a bookmark opens the passage you're reading.
- **No more brief failures reaching Concord.** Now and then a request to your Scripture engine
  (Concord) failed even though it was running fine. Usually the page asked again a second later,
  so all you saw was a short pause; once in a while an "is Concord reachable?" message showed
  instead. It happened when you did something about five seconds after your last click: songbird
  reused its connection to Concord at the very moment Concord was closing it. songbird now lets
  an unused connection go after two seconds. If a connection is ever closed under a request
  anyway, songbird sends that request again at once. When Concord really is down, you still see
  the message straight away.
- **Notes markers no longer multiply.** Reading with a study Bible's notes ticked, switching another
  Bible's notes on and off could leave extra copies of a marker behind, one more each time, until
  the page was reloaded (seen at Malachi 2:16). Each marker now appears once.
- **The Status page opens properly from the reader again.** Opening Status after the reader, Compare
  or Search showed "Unexpected Application Error!", and opening the reader after Status did the
  same. These pages now all read the list of translations the same way.
- **Signing out now leaves nothing of yours behind.** If someone else signed in on the same browser
  tab after you, the home page and Browse notes could briefly show your notes before theirs
  loaded. Now songbird forgets your notes and searches as soon as you sign out, and again when
  anyone signs in.

## [1.7.0] — 2026-09-07

Sermon sources — songbird follows your church's channel and writes the notes itself.

### Added
- **songbird can follow your church's YouTube channel and write the sermon notes for you.** Add a
  channel or playlist once, on the new **Sermon sources** page, and songbird reads through it: for
  each sermon it looks for the passage in the video's own words — a "Scripture:" line in the
  description, the passage in the title, or the opening line — and makes an ordinary sermon note for
  each one it finds. The notes are dated the day the sermon actually went up (a Sunday service
  streamed in the morning and posted after midnight is still filed under the Sunday), tagged the way
  you tagged the source, and they show up in the reader and in Browse exactly like the notes you
  write yourself, on every translation. songbird asks Concord what each reference means rather than
  guessing, so anything it can't be sure of it leaves alone. A sermon you'd already noted by hand is
  left as it is. This needs the same free YouTube key as the re-dating button below.
- **And you can work through the sermons it couldn't place, a tap at a time.** Plenty of churches
  title every service by its date and never write the passage down anywhere, so those sermons wait
  in a **Needs a passage** list — and on a channel with years of Sunday livestreams behind it, that
  list starts long. The Sources page now lets you clear it. Each sermon shows any passage songbird
  spotted in the description as a button: tap the right one — or several — and press **Place**, and
  you get the same notes songbird would have made itself. You can type a passage instead if it isn't
  offered. Anything that isn't a sermon at all — a concert, an announcement, a test stream — is one
  tap to set aside, and one tap to bring back if you change your mind.
- **Narrow the list, or clear a whole stretch of it at once.** Filter it by channel, by date, or by
  words in the title. And if a whole stretch is worth setting aside — every livestream from before
  2025, say — one button clears all of them, telling you exactly how many and which ones before it
  does. It never touches a sermon that already has notes.
- **And if songbird got a passage wrong, you can take it back.** The **Wrong passage** button returns
  the sermon's notes and puts it back in the list to be redone. Deleting the last note from a sermon
  on the Browse page does the same thing, so a sermon can't end up marked done with nothing behind
  it.
- **Your sermon notes can take their dates from YouTube.** A sermon note you made by hand carries
  whatever date you typed — usually the day you wrote the note, not the day the sermon was preached.
  On the Browse notes page there's now a **Re-date YouTube sermons** button: songbird looks up every
  sermon note that links to a YouTube video and shows you exactly what it would change — the old
  date, the new one, and whether it came from when the service was streamed or when the video was
  posted. Nothing is written until you press **Apply**, and pressing it twice is safe. Sermons hosted
  somewhere other than YouTube are left alone, and so are videos that have since been made private or
  removed — those are listed so you know they were skipped rather than missed. This needs a free
  YouTube API key; without one the button explains what to set, and the rest of songbird is unchanged.
- **And it keeps looking, without being asked.** songbird now checks the channels you follow on a
  schedule — once a week to begin with — so a Sunday sermon is usually noted before you next open
  the passage. The line under the heading on the Sermon sources page always says how often it looks
  and when the next look is due. If you would rather it never went looking on its own, set
  `SERMON_CHECK_INTERVAL_HOURS=0` and use the **Check all now** button instead. A songbird that has
  been switched off for a fortnight catches up as soon as it starts, so a machine you only turn on
  at weekends still keeps up.
- **And there's now a walkthrough for setting the whole thing up.** Getting the free key from Google
  is seven screens of a console you have probably never opened, so the User's Guide walks them one
  at a time, naming every button and where it sits. The Sermon sources page links straight to it
  when no key is set yet.

### Fixed
- **A sermon titled with a plain numeric date no longer gets the wrong passage.** A video called
  something like "… with Pastor John 06-25-2020" was being read as John chapters 6 to 25, so a talk
  about respect ended up noted across sixteen chapters. songbird now recognises a date written in
  digits the same way it already recognised one written with a month name, and leaves that video for
  you to place yourself.
- **songbird now reads the Concord you point it at.** If you set `CONCORD_BASE_URL` to your own
  Scripture engine, songbird ignored it: the `docker compose` setup started an engine of its own and
  quietly used that one instead. On a machine already running its own Concord that meant songbird
  read the wrong one, and the only visible sign was translations going missing from the dropdown —
  the engine that ships with songbird carries the public-domain translations only, since licensed
  ones like the ESV and the NKJV can't be included in a public download. Your address is now the one
  that wins, and when you give one, songbird doesn't start a second engine at all. If you don't have
  a Concord of your own, start songbird with `docker compose --profile bundled-concord up` and you
  get the included one exactly as before. **No notes or Bible data were ever lost by this** — the
  other Concord was simply being read instead.
- **You can see which Concord songbird is reading.** The **Status** page now has a link in the top
  bar, and it names the exact address songbird is using and lists every translation available there.
  If a translation you expect is missing, that page tells you why in one look.
- **songbird now opens on the port you asked for.** The `PORT` line in your `.env` file was being
  ignored: whatever you set it to, songbird still appeared at `localhost:8077`. That mattered if
  another program on your computer already had that port — songbird couldn't start, and changing the
  setting didn't help. Set `PORT` now and songbird is there.
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

[1.7.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.7.0
[1.6.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.6.0
[1.1.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.1.0
[1.0.0]: https://github.com/kbennett2000/songbird/releases/tag/v1.0.0
