// Capture the README + user-guide screenshots against a running stack.
//
// Shots produced (all 1440×900 viewport-framed unless noted):
//   reader, reader-dark, note-editor, cross-references, topics-verse, topics-drill, topics-browse,
//   topic-detail, word-study, word-study-strongs, geography-panel, sermon, sermon-chooser,
//   translator-notes, journeys-list, journey-detail, place-detail, places-gazetteer, places,
//   compare, browse, notes-search, search (semantic), search-keyword, welcome, and the map shots
//   (desktop/mobile, with cards).
//
//   1. point songbird at a FULL Concord (see "Capture stack" below) and start it.
//   2. install once:      cd scripts/screenshots && npm install && npx playwright install chromium
//   3. capture:           npm run capture        (override the target with SONGBIRD_URL=…)
//
// Everything runs through the real login-gated UI against real Concord data — no mocks. Notes and
// sermons are seeded via authenticated API calls that ride the browser's session cookie.
//
// ── Capture stack (REQUIRED for the full set) ────────────────────────────────────────────────
// Point songbird at a Concord that ships the FULL data: every translation INCLUDING NET (its
// translator's footnotes drive translator-notes.png) and the curated topical index / journeys /
// Strong's lexicon (drive the topics/word-study/journeys shots). That is the LAN Concord at
// http://192.168.1.62:8000 — set songbird's CONCORD_BASE_URL to it (docker-compose env) before
// `docker compose up`. The stock public image lacks NET and is not assumed to carry the full
// curated set, so several shots below would come up empty against it.
//
// Run against a FRESH / throwaway songbird (a clean DATA_DIR / volume) so the capture account holds
// ONLY this script's seeded demo data — none of your real notes appear in any screenshot. The
// register-or-sign-in flow below creates the `reader` account on first run.
//
// Data assumptions (named constants up top make these one-line adjusts; the run confirms them):
//   • HEADINGS_TRANSLATION (WEB) ships section headings on READER_BOOK/READER_CHAPTER (JHN 3).
//   • OT_BOOK/OT_CHAPTER (Genesis 1) has Hebrew original-language tokens (word-study RTL).
//   • NET carries a translator's note on READER_BOOK/READER_CHAPTER (JHN 3).
//   • At least one journey has ≥2 located stops AND a reconstruction note (found by discovery).
//
// Honesty note: there is intentionally NO standalone study-notes-search screenshot — that section
// renders only when Concord serves study notes; we surface notes via notes-search.png (your own
// notes) instead.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = process.env.SONGBIRD_URL ?? "http://localhost:8077";
const USERNAME = "reader";
const PASSWORD = "graceandpeace";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../docs/screenshots");

// Data-dependent capture targets — adjust here if a chosen passage lacks the expected data on the
// Concord you point at (see the header's "Data assumptions").
const READER_BOOK = "JHN"; // the reader cluster (note, xref, topics, NET translator-notes)
const READER_CHAPTER = 3;
const READER_VERSE = 16;
const HEADINGS_TRANSLATION = "WEB"; // a translation that ships section headings (KJV does not)
const NET_TRANSLATION = "NET"; // carries the translator's footnotes (LAN Concord only)
const OT_BOOK = "GEN"; // an OT chapter with Hebrew original-language tokens (word-study RTL)
const OT_CHAPTER = 1;
const OT_VERSE = 1;

const NOTES = [
  {
    book_usfm: "JHN",
    start_chapter: 3,
    start_verse: 16,
    end_chapter: 3,
    end_verse: 16,
    note_markdown:
      "**For God so loved the world** — the whole gospel in a single verse: God's love is the source, the cross is the proof, and *whoever believes* is the open door.",
    scope_type: "all",
    translations: [],
    tags: ["grace", "gospel"],
  },
  {
    book_usfm: "MAT",
    start_chapter: 6,
    start_verse: 34,
    end_chapter: 6,
    end_verse: 34,
    note_markdown:
      "**Do not worry about tomorrow** — Jesus names the anxiety honestly, then hands us a daily-sized trust instead of a lifetime of dread.",
    scope_type: "all",
    translations: [],
    tags: ["anxiety", "peace"],
  },
  // A rich-text note (bold, italics, a bulleted list) so note-editor.png shows real formatting in
  // the editor — anchored on John 1:1 (a memorable verse with a clean reading column).
  {
    book_usfm: "JHN",
    start_chapter: 1,
    start_verse: 1,
    end_chapter: 1,
    end_verse: 1,
    note_markdown: [
      "**In the beginning was the Word.** John opens not at Bethlehem but at *eternity past*.",
      "",
      "Three claims in one verse:",
      "",
      "- the Word *was* — already there before creation",
      "- the Word was *with* God — distinct, in relationship",
      "- the Word *was* God — fully divine",
    ].join("\n"),
    scope_type: "all",
    translations: [],
    tags: ["gospel", "incarnation"],
  },
];

// Sermon notes anchor like annotations (canonical USFM + chapter/verse range) but always show on
// every translation and link out to the sermon instead of holding Markdown. One seeded note on
// Acts 2:42–47 lets the reader shot show the emerald ▶ sermon marker + its popover.
const SERMON_NOTES = [
  {
    title: "The Lord Is My Shepherd",
    sermon_url: "https://www.youtube.com/watch?v=ON9bop1Lcc0",
    reference: "Psalm 23",
    book_usfm: "PSA",
    start_chapter: 23,
    start_verse: 1,
    end_chapter: 23,
    end_verse: 6,
    event_date: "2026-05-18",
    tags: ["comfort", "trust"],
  },
  // TWO sermons on Romans 8:28 (a verse legitimately carries many) so it shows "2 sermons" and
  // tapping the marker opens the chooser — the subject of sermon-chooser.png. Kept off Psalm 23 so
  // the single-sermon sermon.png stays a single sermon.
  {
    title: "In All Things, Good",
    sermon_url: "https://www.youtube.com/watch?v=Qm2tHFiYrU0",
    reference: "Romans 8:28",
    book_usfm: "ROM",
    start_chapter: 8,
    start_verse: 28,
    end_chapter: 8,
    end_verse: 28,
    event_date: "2026-04-20",
    tags: ["providence", "hope"],
  },
  {
    title: "The Golden Chain",
    sermon_url: "https://www.youtube.com/watch?v=ON9bop1Lcc0",
    reference: "Romans 8:28",
    book_usfm: "ROM",
    start_chapter: 8,
    start_verse: 28,
    end_chapter: 8,
    end_verse: 28,
    event_date: "2026-04-27",
    tags: ["providence", "assurance"],
  },
];

async function ensureSignedIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  // Register the first (owner) account. If it already exists, fall back to signing in.
  const registerToggle = page.getByRole("button", {
    name: "Need an account? Register",
  });
  if (await registerToggle.isVisible().catch(() => false)) {
    await registerToggle.click();
  }
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register" }).click();

  // Either we land on the reader, or registration 409'd (user exists) — sign in instead.
  const landed = await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!landed) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 8000,
    });
  }
}

async function seedNotes(page) {
  for (const note of NOTES) {
    const res = await page.request.post(`${BASE}/api/v1/annotations`, {
      data: note,
    });
    if (!res.ok() && res.status() !== 409) {
      throw new Error(`seed failed (${res.status()}): ${await res.text()}`);
    }
  }
}

async function seedSermonNotes(page) {
  // Sermon notes have no uniqueness constraint (a verse legitimately carries many), so guard the
  // POST ourselves — otherwise re-running capture piles up duplicates and the single-sermon shot
  // turns into a "Sermons · N" stack.
  const existing = await page.request
    .get(`${BASE}/api/v1/sermon-notes`)
    .then((r) => (r.ok() ? r.json() : []));
  for (const note of SERMON_NOTES) {
    const already = existing.some(
      (e) => e.title === note.title && e.reference === note.reference,
    );
    if (already) continue;
    const res = await page.request.post(`${BASE}/api/v1/sermon-notes`, {
      data: note,
    });
    if (!res.ok()) {
      throw new Error(
        `sermon seed failed (${res.status()}): ${await res.text()}`,
      );
    }
  }
}

// Find a journey suitable for the hero shots: ≥2 LOCATED stops (so the route draws) and a non-empty
// reconstruction `note` (the honesty callout journey-detail.png is about). Returns its id plus one
// located stop's place_id — a place guaranteed to carry a "Journeys through here" section, for
// place-detail.png. Driven by the API (no guessing ids against data this script can't see).
async function discoverJourney(page) {
  const list = await page.request
    .get(`${BASE}/api/v1/journeys?limit=50`)
    .then((r) => (r.ok() ? r.json() : { journeys: [] }));
  for (const summary of list.journeys ?? []) {
    const detail = await page.request
      .get(`${BASE}/api/v1/journeys/${encodeURIComponent(summary.id)}`)
      .then((r) => (r.ok() ? r.json() : null));
    if (!detail) continue;
    const located = (detail.stops ?? []).filter(
      (s) => s.latitude !== null && s.longitude !== null,
    );
    if (located.length >= 2 && detail.note && detail.note.trim()) {
      return { journeyId: detail.id, placeId: located[0].place_id };
    }
  }
  throw new Error(
    "no journey with ≥2 located stops and a reconstruction note found — point at the LAN Concord " +
      "with the full curated journeys set, or adjust the discovery criteria.",
  );
}

// Switch the reader's translation via the in-reader dropdown (the reader reads translation from the
// profile, not the URL, so headings/NET shots must select it). Waits for the chapter to re-render.
async function selectTranslation(page, code) {
  await page.getByLabel("Translation").selectOption(code);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

// Viewport-framed shots (1440×900) read far better in the README than tall full-page strips.
// Framed in WEB (not the KJV default) so the v1.6 section headings show — the in-reader <h3>
// passage titles between verses — alongside the seeded open note on verse 16.
async function captureReader(page) {
  await page.goto(
    `${BASE}/read?book=${READER_BOOK}&chapter=${READER_CHAPTER}`,
    {
      waitUntil: "networkidle",
    },
  );
  await selectTranslation(page, HEADINGS_TRANSLATION);
  // A section heading renders as an <h3> between verses (level 2 is the chapter title) — wait for
  // one so the shot genuinely shows headings.
  await page
    .getByRole("heading", { level: 3 })
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() =>
      console.warn(
        "⚠ no section heading found — does this translation/chapter ship them?",
      ),
    );
  // Open the seeded note → the right-hand drawer shows it richly rendered. The note button lives on
  // verse 16's row (Playwright auto-scrolls to click it).
  await page
    .getByRole("button", { name: `View note on verse ${READER_VERSE}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save" })
    .waitFor({ state: "visible" });
  // The drawer is fixed on the right (stays open regardless of scroll), so scroll the reading column
  // back to the chapter top — where the section heading sits — so the shot frames the heading AND
  // the open note drawer together (verse 16 is too far below the lone top heading to share a frame).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/reader.png` });
  console.log("✓ reader.png");
}

// Sermon notes: open the seeded Psalm 23 sermon (a chapter-top passage, so no scroll is needed —
// the floating popover dismisses on any scroll) and frame the passage column with its popover.
// We clip to the reading column (the top toolbar carries a translator's-notes notice that only
// applies when Concord serves NET, which the stock v1.1.0 image does not — out of frame here).
async function captureSermon(page) {
  await page.goto(`${BASE}/read?book=PSA&chapter=23`, {
    waitUntil: "networkidle",
  });
  // The verse 1 sermon marker (▶) sits in the initial viewport — wait for it, then open in place.
  const marker = page.getByRole("button", { name: "Sermon on verse 1" });
  await marker.waitFor({ state: "visible", timeout: 15000 });
  await marker.click();
  // The popover shows the external sermon link — wait for it before framing the shot.
  await page
    .getByRole("link", { name: "▶ Watch the sermon" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  // Clip to the reading column: from just above verse 1 through the bottom of the popover, and
  // below the toolbar's translator's-notes notice (only meaningful when Concord serves NET, which
  // the stock v1.1.0 image doesn't) so the sermon popover is the subject.
  const verseBox = await page.locator("#v-1").boundingBox();
  const lastBox = await page.locator('[id^="v-"]').last().boundingBox();
  const popBox = await page.getByRole("dialog").boundingBox();
  // The notice is always present in the default stack (the stock v1.1.0 image has no NET) — wait for it so
  // its box is measured reliably, then start the clip just below it. Tolerate its absence (a future
  // Concord that serves NET) by falling back to just above verse 1.
  const notice = page.getByText("Translator", { exact: false }).first();
  const noticeVisible = await notice
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  const noticeBox = noticeVisible ? await notice.boundingBox() : null;
  const top = Math.max(
    0,
    noticeBox ? noticeBox.y + noticeBox.height + 10 : verseBox.y - 20,
  );
  // Extend through the whole (short) psalm and the popover so the shot is a full passage, not a strip.
  const bottom = Math.min(
    900,
    Math.max(lastBox.y + lastBox.height, popBox.y + popBox.height) + 24,
  );
  await page.screenshot({
    path: `${OUT}/sermon.png`,
    clip: { x: 0, y: top, width: 1440, height: bottom - top },
  });
  console.log("✓ sermon.png");
}

async function captureSearch(page) {
  await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
  await page.getByLabel("Search query").fill("anxiety");
  await page.getByRole("button", { name: "Search" }).click();
  // Wait for ranked Scripture results (a "score …" appears on each result).
  await page
    .getByText(/score \d/)
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/search.png` });
  console.log("✓ search.png");
}

async function capturePlaces(page) {
  await page.goto(`${BASE}/read?book=GEN&chapter=2`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Places in this chapter" }).click();
  // Wait for the place list, then expand the Euphrates row to reveal its verse chips. Scope to the
  // panel (<aside aria-label="Note panel">) — "Euphrates" also appears in the verse text, which sits
  // behind the open panel and would intercept the click.
  const panel = page.getByRole("complementary", { name: "Note panel" });
  await panel.getByText("Euphrates").first().waitFor({ state: "visible", timeout: 15000 });
  await panel.getByText("Euphrates").first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/places.png` });
  console.log("✓ places.png");
}

// Multi-translation keyword search (v1.3): switch to the Keyword tab (semantic is the default),
// search a common word with the scope left at "All translations", and frame the per-translation
// result snippets. A frequent word makes Concord return a match map across many translations, so
// the result list shows the labeled, one-snippet-per-translation rendering this shot is about.
async function captureKeywordSearch(page) {
  await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Keyword" }).click();
  await page.getByLabel("Search query").fill("shepherd");
  await page.getByRole("button", { name: "Search" }).click();
  // Wait for the Scripture results, then for a result that rendered ≥2 translation labels (the
  // multi-translation snippet shape). The labels are the translation-id chips inside a result.
  const scripture = page.getByRole("region", { name: "Scripture results" });
  await scripture
    .getByRole("listitem")
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/search-keyword.png` });
  console.log("✓ search-keyword.png");
}

// The places gazetteer (v1.4): the standalone /places route — the browsable, filterable list of
// every place Concord knows (distinct from the in-reader "Places in this chapter" overlay above).
async function capturePlacesGazetteer(page) {
  await page.goto(`${BASE}/places`, { waitUntil: "networkidle" });
  // Wait for the loaded list (the "N of M" count appears once the first page lands).
  await page
    .getByText(/\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/places-gazetteer.png` });
  console.log("✓ places-gazetteer.png");
}

// A place detail page (v1.4 + v1.6): a place that sits on a journey, so the shot shows the
// name/status/type, location honesty, the verse jump-links, AND the v1.6 "Journeys through here"
// section. The placeId is discovered from a journey's stop, so the section is guaranteed populated.
async function capturePlaceDetail(page, placeId) {
  await page.goto(`${BASE}/places/${encodeURIComponent(placeId)}`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { level: 1 })
    .waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByRole("heading", { name: /Verses/ })
    .waitFor({ state: "visible", timeout: 15000 });
  // The v1.6 reverse-lookup section + at least one journey link confirm this place is on a journey.
  await page
    .getByRole("heading", { name: "Journeys through here" })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/place-detail.png` });
  console.log("✓ place-detail.png");
}

// The note editor (right-hand drawer) showing rich-text formatting — open the seeded John 1:1 note
// (bold, italics, a bulleted list) so the editor's rendering is the subject.
async function captureNoteEditor(page) {
  await page.goto(`${BASE}/read?book=JHN&chapter=1`, {
    waitUntil: "networkidle",
  });
  await page.locator("#v-1").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "View note on verse 1", exact: true }).click();
  await page
    .getByRole("button", { name: "Save" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/note-editor.png` });
  console.log("✓ note-editor.png");
}

// Open a hover-revealed verse-row trigger (⇄ / ※ / ℵ) and wait for its SidePanel. Playwright's
// click() dispatches regardless of the opacity-0 hover state (the existing xref/sermon shots rely
// on this), so no real hover is needed.
async function openVersePanel(page, triggerName, headingRe) {
  await page.locator(`#v-${READER_VERSE}`).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: triggerName, exact: true }).click();
  await page
    .getByRole("heading", { name: headingRe })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
}

// The cross-references panel (⇄) open on John 3:16.
async function captureCrossReferences(page) {
  await page.goto(
    `${BASE}/read?book=${READER_BOOK}&chapter=${READER_CHAPTER}`,
    { waitUntil: "networkidle" },
  );
  await openVersePanel(
    page,
    `Cross-references for verse ${READER_VERSE}`,
    /Cross-references —/,
  );
  await page.screenshot({ path: `${OUT}/cross-references.png` });
  console.log("✓ cross-references.png");
}

// The topical-Bible reader panel (※): a verse's topics (level 1) and a topic's verses (level 2).
async function captureTopics(page) {
  await page.goto(
    `${BASE}/read?book=${READER_BOOK}&chapter=${READER_CHAPTER}`,
    { waitUntil: "networkidle" },
  );
  await openVersePanel(page, `Topics for verse ${READER_VERSE}`, /Topics —/);
  await page.screenshot({ path: `${OUT}/topics-verse.png` });
  console.log("✓ topics-verse.png");

  // Drill in: click the first topic row (a <li><button> in the panel) → its verses + a "← Topics"
  // back button. The panel is the SidePanel <aside aria-label="Note panel">.
  const panel = page.getByRole("complementary", { name: "Note panel" });
  await panel.getByRole("listitem").first().getByRole("button").click();
  await page
    .getByRole("button", { name: /← Topics/ })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/topics-drill.png` });
  console.log("✓ topics-drill.png");
}

// The Topics browse surface (/topics) and a topic detail (/topics/:id).
async function captureTopicsBrowse(page) {
  await page.goto(`${BASE}/topics`, { waitUntil: "networkidle" });
  await page
    .getByText(/\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/topics-browse.png` });
  console.log("✓ topics-browse.png");

  // Open the first topic → its detail (name heading + verses). Scope to the list rows (<li>) so we
  // click a topic link, not a nav link.
  await page
    .getByRole("main")
    .getByRole("listitem")
    .first()
    .getByRole("link")
    .click();
  await page
    .getByRole("heading", { level: 1 })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/topic-detail.png` });
  console.log("✓ topic-detail.png");
}

// The word-study reader panel (ℵ): the interlinear strip on an OT verse so Hebrew renders RTL,
// then a word's Strong's detail + concordance (the drill-in).
async function captureWordStudy(page) {
  await page.goto(`${BASE}/read?book=${OT_BOOK}&chapter=${OT_CHAPTER}`, {
    waitUntil: "networkidle",
  });
  await page.locator(`#v-${OT_VERSE}`).scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: `Original language for verse ${OT_VERSE}`, exact: true })
    .click();
  await page
    .getByRole("heading", { name: /Original language —/ })
    .waitFor({ state: "visible", timeout: 15000 });
  // The strip container carries dir="rtl" for Hebrew (detected from the H… Strong's prefix).
  await page
    .locator('[dir="rtl"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() =>
      console.warn("⚠ no rtl strip — does this verse have Hebrew tokens?"),
    );
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/word-study.png` });
  console.log("✓ word-study.png");

  // Drill into the first tagged token (a <button> inside the dir="rtl" strip) → its Strong's
  // definition + concordance.
  await page.locator('[dir="rtl"] button').first().click();
  await page
    .getByRole("button", { name: /← Words/ })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/word-study-strongs.png` });
  console.log("✓ word-study-strongs.png");
}

// The in-reader Geography side-panel ("Places in this chapter"): the places named in a chapter,
// each expandable to its verse chips. A places-rich chapter (Genesis 2) frames it well.
async function captureGeographyPanel(page) {
  await page.goto(`${BASE}/read?book=GEN&chapter=2`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Places in this chapter" }).click();
  // Scope to the panel — "Euphrates" also appears in the verse text behind it.
  const panel = page.getByRole("complementary", { name: "Note panel" });
  await panel.getByText("Euphrates").first().waitFor({ state: "visible", timeout: 15000 });
  await panel.getByText("Euphrates").first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/geography-panel.png` });
  console.log("✓ geography-panel.png");
}

// The Journeys list (/journeys) and a journey detail (/journeys/:id) — the route map, the ordered
// stops, and the one-reconstruction note callout. The journey is discovered (located stops + note).
async function captureJourneys(page, journeyId) {
  await page.goto(`${BASE}/journeys`, { waitUntil: "networkidle" });
  await page
    .getByText(/\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/journeys-list.png` });
  console.log("✓ journeys-list.png");

  await page.goto(`${BASE}/journeys/${encodeURIComponent(journeyId)}`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { level: 1 })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("note").waitFor({ state: "visible", timeout: 15000 }); // the reconstruction callout
  // The route map paints a relief basemap + GL route line; wait for the canvas and a numbered
  // marker, then settle for the line to draw.
  await page
    .getByTestId("journey-map-canvas")
    .waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByTestId("journey-marker")
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => console.warn("⚠ no journey marker — are the stops located?"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/journey-detail.png` });
  console.log("✓ journey-detail.png");
}

// Side-by-side compare (/compare) with three translations. The view opens seeded with two columns;
// add a third via the "Add translation" picker.
async function captureCompare(page) {
  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  const adder = page.getByLabel("Add translation");
  await adder.waitFor({ state: "visible", timeout: 15000 });
  // Pick the first real option (skip the "+ translation" placeholder) so a 3rd column appears.
  const values = await adder
    .locator("option")
    .evaluateAll((opts) => opts.map((o) => o.value).filter((v) => v));
  if (values[0]) await adder.selectOption(values[0]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/compare.png` });
  console.log("✓ compare.png");
}

// Browse notes filtered by a tag (/browse) — click a seeded tag in the "Filter by tag" section.
async function captureBrowse(page) {
  await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
  const tagFilter = page.getByRole("region", { name: "Tag filter" });
  await tagFilter.getByRole("button", { name: "grace" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/browse.png` });
  console.log("✓ browse.png");
}

// Searching your own notes (/search, Keyword mode) — a term that matches a seeded note surfaces
// the "Note results" section.
async function captureNotesSearch(page) {
  await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Keyword" }).click();
  await page.getByLabel("Search query").fill("worry");
  await page.getByRole("button", { name: "Search" }).click();
  await page
    .getByRole("region", { name: "Note results" })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/notes-search.png` });
  console.log("✓ notes-search.png");
}

// Translator's footnotes (NET): the inline study-note markers in the reading column. Requires a
// Concord that serves NET (the LAN stack) — the markers don't exist on the stock image.
async function captureTranslatorNotes(page) {
  await page.goto(
    `${BASE}/read?book=${READER_BOOK}&chapter=${READER_CHAPTER}`,
    { waitUntil: "networkidle" },
  );
  // NET only exists on a Concord that serves it (the LAN stack). If the dropdown has no NET option,
  // skip the shot rather than abort the batch.
  const hasNet = await page
    .getByLabel("Translation")
    .locator(`option[value="${NET_TRANSLATION}"]`)
    .count();
  if (hasNet === 0) {
    console.warn(
      "⚠ translator-notes.png skipped — no NET translation (point at the LAN Concord with NET).",
    );
    return;
  }
  await selectTranslation(page, NET_TRANSLATION);
  const marker = page
    .getByRole("button", { name: "Translator's note 1" })
    .first();
  const found = await marker
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!found) {
    console.warn(
      "⚠ translator-notes.png skipped — no NET translator markers (point at the LAN Concord with NET).",
    );
    return;
  }
  await marker.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/translator-notes.png` });
  console.log("✓ translator-notes.png");
}

// The sermon chooser: a verse with 2+ sermons (the seeded Romans 8:28 pair) shows a chooser popover
// when its ▶ marker is tapped.
async function captureSermonChooser(page) {
  await page.goto(`${BASE}/read?book=ROM&chapter=8`, {
    waitUntil: "networkidle",
  });
  const marker = page.getByRole("button", {
    name: "2 sermons on verse 28",
    exact: true,
  });
  await marker.scrollIntoViewIfNeeded();
  await marker.waitFor({ state: "visible", timeout: 15000 });
  await marker.click();
  await page
    .getByText(/Sermons · 2/)
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/sermon-chooser.png` });
  console.log("✓ sermon-chooser.png");
}

// The reader in dark mode — toggle the theme, capture, then toggle back (the choice persists to the
// profile, #60, so leaving it dark would darken every later shot). Run last among the reader shots.
async function captureReaderDark(page) {
  await page.goto(
    `${BASE}/read?book=${READER_BOOK}&chapter=${READER_CHAPTER}`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/reader-dark.png` });
  console.log("✓ reader-dark.png");
  // Restore light mode so subsequent runs/shots aren't dark.
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.waitForTimeout(300);
}

// The Welcome page (v1.5): the home route ("/", not "/?book=…") leads with the verse-of-the-day
// card — one random verse from Concord with a "show another" re-roll. The seeded notes give the
// page a populated recent-notes feed and library counts below the card.
async function captureWelcome(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // The card renders only when Concord returned a verse; wait for it, but tolerate its absence
  // (a Concord hiccup) so the run still produces a Welcome shot rather than failing the batch.
  await page
    .getByRole("region", { name: "Verse of the day" })
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() =>
      console.warn(
        "⚠ verse-of-the-day card not present — capturing Welcome without it",
      ),
    );
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/welcome.png` });
  console.log("✓ welcome.png");
}

// Open the map modal for the current passage and wait until it has rendered.
// Since the MapLibre rewrite (ADR 0003) place pins are GL circles with no DOM node, while the
// bundled physical features (seas, rivers, regions) render as DOM labels (data-testid="map-label").
// Waiting for a label confirms the relief raster + vector overlay painted; the settle then lets the
// GL place circles/clusters finish drawing before the shot.
async function openMap(page) {
  await page.getByRole("button", { name: "Show map" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByTestId("map-label")
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1500);
  return dialog;
}

// Locate the most isolated place pin and return the screen point to click.
// Post-MapLibre (ADR 0003) pins are GL circles with no DOM node, so we can't select one directly.
// But each unclustered pin now carries a place-name label (issue #86) — a DOM marker seated just
// right of its pin via anchor:"left", offset:[10,0]. So a label's box locates its pin: the pin
// center is ~10px left of the label's left edge, at the label's vertical middle. We click that
// point (labels are pointer-events-none, so the click lands on the GL circle and opens the card).
// Pick the pin whose neighbours are farthest off so an adjacent pin doesn't steal the click.
async function isolatedPinPoint(page) {
  const labels = await page.getByTestId("map-place-label").all();
  const located = (
    await Promise.all(
      labels.map(async (l) => ({
        name: (await l.textContent())?.trim(),
        box: await l.boundingBox(),
      })),
    )
  )
    .filter((b) => b.box)
    .map((b) => ({
      name: b.name,
      x: b.box.x - 10,
      y: b.box.y + b.box.height / 2,
    }));
  if (located.length === 0)
    throw new Error("no place-name labels found to locate a pin");
  let best = located[0];
  let bestDist = -1;
  for (const a of located) {
    let nearest = Infinity;
    for (const b of located) {
      if (b === a) continue;
      nearest = Math.min(nearest, Math.hypot(b.x - a.x, b.y - a.y));
    }
    if (nearest > bestDist) {
      bestDist = nearest;
      best = a;
    }
  }
  return best;
}

// Desktop (1440×900): the reader with the map modal open — pins on the basemap framed by the
// songbird chrome, matching the other README shots (a viewport, not a bare-modal, screenshot).
// Framed on Acts 27 (Paul's voyage to Rome): its places spread across the Mediterranean for a
// striking hero, and the Holy-Land corner shows the filled inland seas (Dead Sea, Sea of Galilee).
async function captureMapDesktop(page) {
  await page.goto(`${BASE}/read?book=ACT&chapter=27`, {
    waitUntil: "networkidle",
  });
  const dialog = await openMap(page);
  await page.screenshot({ path: `${OUT}/map-desktop.png` });
  console.log("✓ map-desktop.png");

  try {
    // Click an isolated pin → the selected-place card (name/status/confidence + jump chips).
    const pin = await isolatedPinPoint(page);
    await page.mouse.click(pin.x, pin.y);
    await page
      .getByTestId("place-card")
      .waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(300);
    await dialog.screenshot({ path: `${OUT}/map-desktop-card.png` });
    console.log(`✓ map-desktop-card.png (selected: ${pin.name})`);

    // Jump from the card → reader navigates and the modal closes (point 5).
    await page.getByTestId("place-card").getByRole("button").first().click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 8000 });
    console.log("✓ jump closes the modal");
  } catch (err) {
    console.warn(
      `⚠ desktop card/jump step skipped: ${err.message.split("\n")[0]}`,
    );
  }
}

// Mobile (390×844, touch — no hover): near-full-screen modal, finger-sized pins, tap-to-select.
// hasTouch enables .tap() (so selection is touch, not hover). We deliberately leave isMobile off:
// with a fixed deviceScaleFactor its meta-viewport emulation lays the page out at a width that
// doesn't match the requested viewport, so screenshots would frame at 390 while layout used ~484
// and look falsely clipped. innerWidth then equals 390 and the shot reflects a real phone.
async function captureMapMobile(browser, channel) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    ...(channel ? { channel } : {}),
  });
  const page = await context.newPage();
  try {
    await ensureSignedIn(page);
    await page.goto(`${BASE}/read?book=GEN&chapter=2`, {
      waitUntil: "networkidle",
    });
    await openMap(page);
    // Viewport (not element) screenshot — the honest "what the user sees" framing, which also
    // confirms the modal genuinely covers the small screen rather than sitting in a box.
    await page.screenshot({ path: `${OUT}/map-mobile.png` });
    console.log("✓ map-mobile.png");

    try {
      // Tap (not click) an isolated pin → card appears; confirms touch selection on mobile.
      const pin = await isolatedPinPoint(page);
      await page.touchscreen.tap(pin.x, pin.y);
      await page
        .getByTestId("place-card")
        .waitFor({ state: "visible", timeout: 8000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/map-mobile-card.png` });
      console.log(`✓ map-mobile-card.png (tapped: ${pin.name})`);
    } catch (err) {
      console.warn(`⚠ mobile tap step skipped: ${err.message.split("\n")[0]}`);
    }
  } finally {
    await context.close();
  }
}

async function main() {
  // Playwright ships no Chromium build for some newer distros; use the system Chrome when
  // present (set PLAYWRIGHT_CHROME_CHANNEL="" to force the bundled browser).
  const channel = process.env.PLAYWRIGHT_CHROME_CHANNEL ?? "chrome";
  // Map-only run (for live visual verification): MAP_ONLY=1 skips the README shots + note seeding.
  const mapOnly = process.env.MAP_ONLY === "1";
  const browser = await chromium.launch(channel ? { channel } : {});
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await ensureSignedIn(page);
    if (!mapOnly) {
      await seedNotes(page);
      await seedSermonNotes(page);
      // Reader cluster + the v1.6 reader panels (no journey dependency).
      await captureReader(page);
      await captureNoteEditor(page);
      await captureCrossReferences(page);
      await captureTopics(page);
      await captureTopicsBrowse(page);
      await captureWordStudy(page);
      await captureGeographyPanel(page);
      await captureSermon(page);
      await captureSermonChooser(page);
      await captureTranslatorNotes(page);
      // Top-nav surfaces.
      await captureCompare(page);
      await captureBrowse(page);
      await captureSearch(page);
      await captureKeywordSearch(page);
      await captureNotesSearch(page);
      await capturePlaces(page);
      await capturePlacesGazetteer(page);
      await captureWelcome(page);
      // Dark mode toggles + restores the theme; run it before the remaining light shots.
      await captureReaderDark(page);
      // Journey-dependent shots LAST: discovery throws on a data gap (surfacing it loudly), but by
      // here every other shot is already saved to disk.
      const { journeyId, placeId } = await discoverJourney(page);
      await captureJourneys(page, journeyId);
      await capturePlaceDetail(page, placeId);
    }
    await captureMapDesktop(page);
    await captureMapMobile(browser, channel);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
