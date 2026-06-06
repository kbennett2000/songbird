// Capture the three README screenshots against a running songbird stack.
//
//   1. start the stack:   docker compose up        (songbird at http://localhost:8077)
//   2. install once:      cd scripts/screenshots && npm install && npx playwright install chromium
//   3. capture:           npm run capture
//
// Everything runs through the real login-gated UI against real Concord data — no mocks.
// Notes are seeded via authenticated API calls that ride the browser's session cookie.

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

// Viewport-framed shots (1440×900) read far better in the README than tall full-page strips.
async function captureReader(page) {
  await page.goto(`${BASE}/?book=JHN&chapter=3`, { waitUntil: "networkidle" });
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
  await page.goto(`${BASE}/?book=GEN&chapter=2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Places in this chapter" }).click();
  // Wait for the place list, then expand the Euphrates row to reveal its verse chips.
  await page.getByText("Euphrates").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Euphrates").first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/places.png` });
  console.log("✓ places.png");
}

// Open the map modal for the current passage and wait until it has plotted its pins.
async function openMap(page, knownPin) {
  await page.getByRole("button", { name: "Show map" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: knownPin }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  return dialog;
}

// Pick the most isolated pin (largest nearest-neighbour distance) so the click isn't stolen by
// an overlapping neighbour — the Mesopotamian rivers sit almost on top of each other.
async function isolatedPin(page) {
  const pins = await page.getByTestId("map-pin").all();
  const boxes = await Promise.all(
    pins.map(async (p) => ({ p, box: await p.boundingBox(), name: await p.getAttribute("aria-label") })),
  );
  const valid = boxes.filter((b) => b.box);
  let best = valid[0];
  let bestDist = -1;
  for (const a of valid) {
    const ax = a.box.x + a.box.width / 2;
    const ay = a.box.y + a.box.height / 2;
    let nearest = Infinity;
    for (const b of valid) {
      if (b === a) continue;
      const dx = b.box.x + b.box.width / 2 - ax;
      const dy = b.box.y + b.box.height / 2 - ay;
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    if (nearest > bestDist) {
      bestDist = nearest;
      best = a;
    }
  }
  return best;
}

// Desktop (1440×900): the whole modal — pins on the basemap + the honesty lists below it.
async function captureMapDesktop(page) {
  await page.goto(`${BASE}/?book=GEN&chapter=2`, { waitUntil: "networkidle" });
  const dialog = await openMap(page, "Euphrates");
  await dialog.screenshot({ path: `${OUT}/map-desktop.png` });
  console.log("✓ map-desktop.png");

  try {
    // Tap an isolated pin → the selected-place card (name/status/confidence + jump chips).
    const pin = await isolatedPin(page);
    await pin.p.click();
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
    await page.goto(`${BASE}/?book=GEN&chapter=2`, { waitUntil: "networkidle" });
    await openMap(page, "Euphrates");
    // Viewport (not element) screenshot — the honest "what the user sees" framing, which also
    // confirms the modal genuinely covers the small screen rather than sitting in a box.
    await page.screenshot({ path: `${OUT}/map-mobile.png` });
    console.log("✓ map-mobile.png");

    try {
      // Tap (not hover) an isolated pin → card appears; confirms touch selection on mobile.
      const pin = await isolatedPin(page);
      await pin.p.tap();
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
      await captureReader(page);
      await captureSearch(page);
      await capturePlaces(page);
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
