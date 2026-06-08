// Capture the README screenshots against a running stack:
//   reader, sermon, search (semantic), search-keyword (multi-translation), places (in-reader
//   overlay), places-gazetteer (/places), place-detail (/places/:id), welcome (verse of the day),
//   and the map shots (desktop/mobile, with cards).
//
//   1. start the stack:   docker compose up        (songbird at http://localhost:8077)
//   2. install once:      cd scripts/screenshots && npm install && npx playwright install chromium
//   3. capture:           npm run capture
//
// Everything runs through the real login-gated UI against real Concord data — no mocks.
// Notes are seeded via authenticated API calls that ride the browser's session cookie.
//
// Honesty note: there is intentionally NO study-notes screenshot. The "Study notes" search
// section renders only when Concord serves study notes, and the stock image ships zero
// (`/v1/notes/search` → total: 0), so against the default stack the section is correctly hidden.
// We document that (README + dev-notes) rather than fake a capture of it.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = process.env.SONGBIRD_URL ?? "http://localhost:8077";
const USERNAME = "reader";
const PASSWORD = "graceandpeace";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../docs/screenshots");

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
];

async function ensureSignedIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  // Register the first (owner) account. If it already exists, fall back to signing in.
  const registerToggle = page.getByRole("button", { name: "Need an account? Register" });
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
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 8000 });
  }
}

async function seedNotes(page) {
  for (const note of NOTES) {
    const res = await page.request.post(`${BASE}/api/v1/annotations`, { data: note });
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
    const res = await page.request.post(`${BASE}/api/v1/sermon-notes`, { data: note });
    if (!res.ok()) {
      throw new Error(`sermon seed failed (${res.status()}): ${await res.text()}`);
    }
  }
}

// Viewport-framed shots (1440×900) read far better in the README than tall full-page strips.
async function captureReader(page) {
  await page.goto(`${BASE}/read?book=JHN&chapter=3`, { waitUntil: "networkidle" });
  // Bring the annotated verse 16 into view (it carries the note dot + amber highlight)…
  await page.locator("#v-16").scrollIntoViewIfNeeded();
  // …then open the seeded note → the right-hand drawer shows it richly rendered.
  await page.getByRole("button", { name: "View note on verse 16" }).click();
  await page.getByRole("button", { name: "Save" }).waitFor({ state: "visible" });
  await page.locator("#v-16").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/reader.png` });
  console.log("✓ reader.png");
}

// Sermon notes: open the seeded Psalm 23 sermon (a chapter-top passage, so no scroll is needed —
// the floating popover dismisses on any scroll) and frame the passage column with its popover.
// We clip to the reading column (the top toolbar carries a translator's-notes notice that only
// applies when Concord serves NET, which the stock v1.1.0 image does not — out of frame here).
async function captureSermon(page) {
  await page.goto(`${BASE}/read?book=PSA&chapter=23`, { waitUntil: "networkidle" });
  // The verse 1 sermon marker (▶) sits in the initial viewport — wait for it, then open in place.
  const marker = page.getByRole("button", { name: "Sermon on verse 1" });
  await marker.waitFor({ state: "visible", timeout: 15000 });
  await marker.click();
  // The popover shows the external sermon link — wait for it before framing the shot.
  await page.getByRole("link", { name: "▶ Watch the sermon" }).waitFor({ state: "visible" });
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
  const top = Math.max(0, noticeBox ? noticeBox.y + noticeBox.height + 10 : verseBox.y - 20);
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
  await page.getByText(/score \d/).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/search.png` });
  console.log("✓ search.png");
}

async function capturePlaces(page) {
  await page.goto(`${BASE}/read?book=GEN&chapter=2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Places in this chapter" }).click();
  // Wait for the place list, then expand the Euphrates row to reveal its verse chips.
  await page.getByText("Euphrates").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Euphrates").first().click();
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
  await scripture.getByRole("listitem").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/search-keyword.png` });
  console.log("✓ search-keyword.png");
}

// The places gazetteer (v1.4): the standalone /places route — the browsable, filterable list of
// every place Concord knows (distinct from the in-reader "Places in this chapter" overlay above).
async function capturePlacesGazetteer(page) {
  await page.goto(`${BASE}/places`, { waitUntil: "networkidle" });
  // Wait for the loaded list (the "N of M" count appears once the first page lands).
  await page.getByText(/\d+ of \d+/).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/places-gazetteer.png` });
  console.log("✓ places-gazetteer.png");
}

// A place detail page (v1.4): search the gazetteer for a well-known, richly-attested place and open
// it, so the shot shows the name/status/type, location honesty, and the verse jump-links.
async function capturePlaceDetail(page) {
  await page.goto(`${BASE}/places`, { waitUntil: "networkidle" });
  await page.getByLabel("Search places by name").fill("Jerusalem");
  await page.getByRole("button", { name: "Search" }).click();
  const link = page.getByRole("link", { name: "Jerusalem", exact: true }).first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  await link.click();
  // On the detail page: wait for the heading and the verses list before framing.
  await page.getByRole("heading", { name: "Jerusalem", level: 1 }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("heading", { name: /Verses/ }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/place-detail.png` });
  console.log("✓ place-detail.png");
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
    .catch(() => console.warn("⚠ verse-of-the-day card not present — capturing Welcome without it"));
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
  await page.getByTestId("map-label").first().waitFor({ state: "visible", timeout: 15000 });
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
      labels.map(async (l) => ({ name: (await l.textContent())?.trim(), box: await l.boundingBox() })),
    )
  )
    .filter((b) => b.box)
    .map((b) => ({ name: b.name, x: b.box.x - 10, y: b.box.y + b.box.height / 2 }));
  if (located.length === 0) throw new Error("no place-name labels found to locate a pin");
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
  await page.goto(`${BASE}/read?book=ACT&chapter=27`, { waitUntil: "networkidle" });
  const dialog = await openMap(page);
  await page.screenshot({ path: `${OUT}/map-desktop.png` });
  console.log("✓ map-desktop.png");

  try {
    // Click an isolated pin → the selected-place card (name/status/confidence + jump chips).
    const pin = await isolatedPinPoint(page);
    await page.mouse.click(pin.x, pin.y);
    await page.getByTestId("place-card").waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(300);
    await dialog.screenshot({ path: `${OUT}/map-desktop-card.png` });
    console.log(`✓ map-desktop-card.png (selected: ${pin.name})`);

    // Jump from the card → reader navigates and the modal closes (point 5).
    await page.getByTestId("place-card").getByRole("button").first().click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 8000 });
    console.log("✓ jump closes the modal");
  } catch (err) {
    console.warn(`⚠ desktop card/jump step skipped: ${err.message.split("\n")[0]}`);
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
    await page.goto(`${BASE}/read?book=GEN&chapter=2`, { waitUntil: "networkidle" });
    await openMap(page);
    // Viewport (not element) screenshot — the honest "what the user sees" framing, which also
    // confirms the modal genuinely covers the small screen rather than sitting in a box.
    await page.screenshot({ path: `${OUT}/map-mobile.png` });
    console.log("✓ map-mobile.png");

    try {
      // Tap (not click) an isolated pin → card appears; confirms touch selection on mobile.
      const pin = await isolatedPinPoint(page);
      await page.touchscreen.tap(pin.x, pin.y);
      await page.getByTestId("place-card").waitFor({ state: "visible", timeout: 8000 });
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
      await captureReader(page);
      await captureSermon(page);
      await captureSearch(page);
      await captureKeywordSearch(page);
      await capturePlaces(page);
      await capturePlacesGazetteer(page);
      await capturePlaceDetail(page);
      await captureWelcome(page);
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
