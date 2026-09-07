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
    // Register-or-sign-in: whichever this account needs.
    const register = page.getByRole("button", { name: /Create account|Register/ });
    const signIn = page.getByRole("button", { name: /Sign in|Log in/ });
    if (await signIn.count()) await signIn.first().click();
    else await register.first().click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });
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

/** Every state of the page, at one viewport and one theme. */
async function captureStates(page, label) {
  await page.goto(`${BASE}/sermon-sources`, { waitUntil: "networkidle" });
  await shot(page, `${label}-populated`);

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
