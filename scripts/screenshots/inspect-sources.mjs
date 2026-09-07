// Look at the Sermon sources page in every state it can be in, at desktop and phone width, in
// light and dark — the pass that issue #122 taught us not to skip.
//
// This is an INSPECTION harness, not a documentation one: nothing it produces is committed. Its
// sibling capture.mjs makes the README screenshots; this one makes throwaway PNGs whose only job
// is to be looked at by a person before a slice ships. Slices 4 and 5 add more states to this
// same page, so it lives in the repo rather than being rewritten each time.
//
//   1. install once:   cd scripts/screenshots && npm install && npx playwright install chromium
//   2. run:            node inspect-sources.mjs
//
// Two songbirds are needed, because "no key configured" is a state of the SERVER, not of the
// page: point SONGBIRD_URL at one that has a YouTube key and SONGBIRD_NOKEY_URL at one that
// doesn't. The no-key shots are skipped (loudly) if the second isn't set.
//
//   SONGBIRD_URL=http://127.0.0.1:8099 \
//   SONGBIRD_NOKEY_URL=http://127.0.0.1:8098 \
//   OUT_DIR=/tmp/sources-pass node inspect-sources.mjs
//
// Run it against a THROWAWAY songbird (a scratch DATA_DIR): it adds and removes real sources.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.SONGBIRD_URL ?? "http://localhost:8077";
const NOKEY_BASE = process.env.SONGBIRD_NOKEY_URL ?? "";
const OUT = process.env.OUT_DIR ?? "/tmp/sources-pass";
const USERNAME = "reader";
const PASSWORD = "graceandpeace";

// The real churches this feature exists for, plus one curated playlist — a channel-only page
// would hide how a long playlist title behaves, and that is exactly the kind of thing this pass
// is for.
const SOURCES = [
  { url: "https://www.youtube.com/@cornerstonechpl", tags: ["sunday"] },
  { url: "https://www.youtube.com/@CelebrationChurch_org", tags: ["sunday"] },
  { url: "https://www.youtube.com/@2819Church", tags: ["midweek"] },
  { url: "https://www.youtube.com/@majesticviewchurchlive407", tags: ["sunday", "livestream"] },
  {
    url: "https://www.youtube.com/playlist?list=PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t",
    tags: ["teaching"],
  },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

async function ensureSignedIn(page, base) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByLabel("Username").fill(USERNAME);
    await page.getByLabel("Password").fill(PASSWORD);
    // Sign in if the account exists, register if it doesn't. Trying sign-in FIRST and falling
    // back is the only order that works against both a used instance and a fresh one — and the
    // no-key instance is always fresh, which is how this was found.
    const signIn = page.getByRole("button", { name: /^(Sign in|Log in)$/ });
    if (await signIn.count()) await signIn.first().click();
    const landed = await page
      .waitForURL((url) => !url.pathname.includes("/login"), { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!landed) {
      const toggle = page.getByRole("button", { name: /Need an account\? Register/ });
      if (await toggle.count()) await toggle.first().click();
      await page.getByLabel("Username").fill(USERNAME);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^(Register|Create account)$/ }).first().click();
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });
    }
  }
}

/** Set the colour scheme through the app's own toggle, so it persists to the profile like a
 *  real user's choice would. */
async function setTheme(page, theme) {
  const wantDark = theme === "dark";
  const toggle = page.getByRole("button", {
    name: wantDark ? "Switch to dark mode" : "Switch to light mode",
  });
  if (await toggle.count()) await toggle.first().click();
  await page.waitForTimeout(200);
}

async function shot(page, name, { fullPage = true } = {}) {
  await page.waitForTimeout(250);
  // Dialog shots are viewport-framed: a fullPage shot of a fixed-position modal stitches the
  // page BEHIND it in below the fold, which is not what anybody sees. (capture.mjs frames its
  // modal shots the same way, for the same reason.)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`✓ ${name}.png`);
}

async function addSource(page, { url, tags }) {
  await page.getByRole("button", { name: "Add source", exact: true }).first().click();
  await page.getByLabel(/Channel or playlist link/).fill(url);
  for (const tag of tags) {
    await page.getByLabel("Add a tag").fill(tag);
    await page.keyboard.press("Enter");
  }
  // The form's own submit is the LAST "Add source" — the first is the disclosure that opened it.
  await page.getByRole("button", { name: "Add source", exact: true }).last().click();
  await page.getByText(/^Added /).waitFor({ timeout: 20000 });
  console.log(`  added ${url}`);
}

/** The page while a check is running (v1.7 slice 4a) — the state that only exists for a few
 *  seconds, and the one no unit test can show you. */
async function captureChecking(page, label) {
  const button = page.getByRole("button", { name: "Check all now" });
  if (!(await button.count())) return;
  await button.click();
  // Waited on by TEXT, not by role: the page has exactly one `role="status"` (the banner), and
  // this indicator deliberately isn't it — two live regions talk over each other for a screen
  // reader, which is what this pass found the first time it ran.
  const indicator = page.locator("span", { hasText: /^Checking your sources…$/ });
  // It appears on the first poll answer; if it never does, `scan_running` is being set inside
  // the background task instead of before the response, and polling never starts.
  try {
    await indicator.waitFor({ timeout: 5000 });
  } catch {
    console.warn(`  ⚠ ${label}: no "checking" indicator appeared — did the poll start?`);
    return;
  }
  await shot(page, `${label}-checking`, { fullPage: false });
  // And then it must go away on its own, with nobody touching the page.
  await indicator.waitFor({ state: "detached", timeout: 120000 });
  await page.waitForTimeout(400);
  await shot(page, `${label}-checked`);
}

/** The ledger's states (v1.7 slice 4a): what a check found, filtered, and paged. */
async function captureLedger(page, label) {
  const ledger = page.getByRole("region", { name: "What songbird found" });
  if (!(await ledger.count())) {
    console.warn(`  ⚠ no ledger at ${label} — has anything been checked?`);
    return;
  }
  await ledger.scrollIntoViewIfNeeded();
  await shot(page, `${label}-ledger`, { fullPage: false });

  // Skipped rows carry the longest reason text, which is where a phone width shows.
  await page.getByLabel("Filter by state").selectOption("skipped");
  await page.waitForTimeout(600);
  await ledger.scrollIntoViewIfNeeded();
  await shot(page, `${label}-ledger-skipped`, { fullPage: false });

  // A filter combination with nothing in it — the empty state a reader will actually hit.
  await page.getByLabel("Filter by state").selectOption("placed");
  await page.waitForTimeout(600);
  await ledger.scrollIntoViewIfNeeded();
  await shot(page, `${label}-ledger-empty`, { fullPage: false });
  await page.getByLabel("Filter by state").selectOption("all");
  await page.waitForTimeout(400);
}

/** Every state of the page, at one viewport and one theme. */
async function captureStates(page, label) {
  await page.goto(`${BASE}/sermon-sources`, { waitUntil: "networkidle" });
  await shot(page, `${label}-populated`);
  await captureChecking(page, label);
  await captureLedger(page, label);
  await page.goto(`${BASE}/sermon-sources`, { waitUntil: "networkidle" });

  // The add form, open and empty.
  await page.getByRole("button", { name: "Add source", exact: true }).first().click();
  await shot(page, `${label}-add-form`);
  await page.getByRole("button", { name: "Cancel" }).first().click();

  // Editing the first source.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await shot(page, `${label}-edit`);
  await page.getByRole("button", { name: "Cancel" }).first().click();

  // The two-step delete, paused on the question.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await shot(page, `${label}-delete-confirm`);
  await page.getByRole("button", { name: "Cancel" }).first().click();

  // The re-date preview, with real rows from real videos.
  await page.getByRole("button", { name: "Re-date YouTube sermons" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await shot(page, `${label}-redate`, { fullPage: false });
  // Scrolled to the bottom of the dialog: the not-found list and the Apply button live there,
  // and a full-page shot of a scrolling dialog shows neither.
  await page.getByRole("dialog").evaluate((el) => {
    const body = el.querySelector(".overflow-y-auto");
    if (body) body.scrollTop = body.scrollHeight;
  });
  await shot(page, `${label}-redate-bottom`, { fullPage: false });
  await page.getByRole("button", { name: "Close" }).click();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const channel = process.env.PLAYWRIGHT_CHROME_CHANNEL ?? "chrome";
  const browser = await chromium.launch(channel ? { channel } : {});

  try {
    // The empty state first, then fill the page up — the order the owner meets it in.
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        ...(channel ? { channel } : {}),
      });
      const page = await context.newPage();
      await ensureSignedIn(page, BASE);
      await page.goto(`${BASE}/sermon-sources`, { waitUntil: "networkidle" });

      const empty = await page.getByText(/No sources yet/).count();
      if (empty) {
        await shot(page, `${vp.name}-light-empty`);
        await setTheme(page, "dark");
        await shot(page, `${vp.name}-dark-empty`);
        await setTheme(page, "light");
        for (const source of SOURCES) await addSource(page, source);
      } else {
        console.log(`  (sources already present — skipping the empty shot at ${vp.name})`);
      }

      await captureStates(page, `${vp.name}-light`);
      await setTheme(page, "dark");
      await captureStates(page, `${vp.name}-dark`);
      await setTheme(page, "light");

      if (NOKEY_BASE) {
        await ensureSignedIn(page, NOKEY_BASE);
        await page.goto(`${NOKEY_BASE}/sermon-sources`, { waitUntil: "networkidle" });
        await shot(page, `${vp.name}-light-no-key`);
        await setTheme(page, "dark");
        await shot(page, `${vp.name}-dark-no-key`);
        await setTheme(page, "light");
      } else {
        console.warn("⚠ SONGBIRD_NOKEY_URL not set — the no-key state was NOT looked at");
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nShots are in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
