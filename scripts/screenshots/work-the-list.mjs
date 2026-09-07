// Work the review list for real, the way its owner will (v1.7 slice 5 acceptance).
// Throwaway: run against a SCRATCH songbird with real data, then delete. Not committed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.SONGBIRD_URL ?? "http://127.0.0.1:8099";
const OUT = process.env.OUT_DIR ?? "/tmp/review-pass";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const shot = async (page, name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").fill("reader");
  await page.getByLabel("Password").fill("graceandpeace");
  await page.getByRole("button", { name: /Sign in|Log in/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

const t0 = Date.now();
const mark = (what) => log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${what}`);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROME_CHANNEL ?? "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("  !! page error:", e.message));
page.on("console", (m) => m.type() === "error" && log("  !! console:", m.text().slice(0, 160)));

await signIn(page);
await page.goto(`${BASE}/sermon-sources`);
const ledger = page.getByRole("region", { name: "What songbird found" });
await ledger.waitFor({ timeout: 15000 });
mark("review list on screen");
await shot(page, "01-arrived");

// 1. Narrow to the work.
await page.getByLabel("Filter by state").selectOption("needs_passage");
await page.getByRole("list", { name: "Videos" }).waitFor();
mark(`bulk button offered on a state filter alone: ${await page.getByRole("button", { name: /Dismiss all/ }).count() > 0}`);
mark(`filtered to needs a passage — ${await ledger.locator("p", { hasText: /^\d+ of \d+$/ }).first().innerText()}`);
await shot(page, "02-needs-passage");

// 2. Place a few from their own suggestions.
const withChips = page.getByRole("list", { name: "Possible passages" });
const chipRows = await withChips.count();
log(`  rows with suggestions on this page: ${chipRows}`);
let placed = 0;
// The card is found by TITLE each time: a Playwright locator re-resolves lazily, so "the first row
// with chips" points somewhere else the moment a row is placed.
const cardTitled = (title) =>
  page.getByRole("list", { name: "Videos" }).locator("li").filter({ hasText: title }).first();

for (let i = 0; i < 3; i++) {
  const chips = withChips.first();
  if (!(await chips.count())) break;
  const title = (await chips.locator("xpath=ancestor::li[1]").locator("p").first().innerText()).trim();
  const first = chips.getByRole("button").first();
  const ref = await first.innerText();
  await first.click();
  if (i === 0) await shot(page, "03-chip-selected");
  const card = cardTitled(title);
  await card.getByRole("button", { name: "Place" }).click();
  await card.getByRole("button", { name: "Wrong passage" }).waitFor({ timeout: 15000 });
  placed++;
  mark(`placed "${ref}" on ${title.slice(0, 62)}`);
  if (i === 0) await shot(page, "04-placed-in-place");
}

// 3. Type one by hand on a row with no suggestions at all.
const bare = page.getByLabel("Which passage was it?");
if (await bare.count()) {
  const title = (await bare.first().locator("xpath=ancestor::li[1]").locator("p").first().innerText()).trim();
  const card = cardTitled(title);
  await bare.first().fill("Jhon 3:16");
  await card.getByRole("button", { name: "Place" }).click();
  await page.waitForTimeout(1500);
  const err = await card.locator("p.text-red-600").first().innerText().catch(() => "(no message shown)");
  mark(`typed a misspelling — message: ${err}`);
  await shot(page, "05-place-error");
  await card.getByLabel("Which passage was it?").fill("John 3:16");
  await card.getByRole("button", { name: "Place" }).click();
  await card.getByRole("button", { name: "Wrong passage" }).waitFor({ timeout: 15000 });
  mark("corrected it and placed");
} else {
  log("  (every row on this page carries suggestions — no bare typing case here)");
}

// 4. Sweep a stretch by date.
await page.getByRole("button", { name: /More filters/ }).click();
await page.getByLabel("Published on or before").fill("2021-12-31");
await page.waitForTimeout(900);
const bulk = page.getByRole("button", { name: /Dismiss all \d+ matching/ });
if (await bulk.count()) {
  mark(`bulk button offers: "${await bulk.first().innerText()}"`);
  await bulk.first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  mark(`confirm heads: ${JSON.stringify(await dialog.getByRole("heading").allInnerTexts())}`);
  await shot(page, "06-bulk-confirm");
  await dialog.getByRole("button", { name: /^Dismiss \d+$/ }).click();
  await page.getByRole("status").waitFor({ timeout: 20000 });
  mark(`swept: ${await page.getByRole("status").first().innerText()}`);
  await shot(page, "07-after-sweep");
} else {
  log("  !! no bulk button offered for that date range");
}
await page.getByLabel("Published on or before").fill("");
await page.getByRole("button", { name: /Fewer filters/ }).click();

// 5. The known-wrong anchor: reopen it and check the reader.
await page.getByLabel("Filter by state").selectOption("placed");
await page.getByRole("button", { name: /More filters/ }).click();
await page.getByLabel("Search titles").fill("Pastor John");
await page.getByRole("button", { name: "Search" }).click();
await page.waitForTimeout(1200);
const john = page.getByRole("list", { name: "Videos" }).locator("li").first();
mark(`found: ${(await john.locator("p").first().innerText()).slice(0, 70)}`);
mark(`noted on: ${await john.getByRole("link").allInnerTexts()}`);
await shot(page, "08-wrong-anchor");
await john.getByRole("button", { name: "Wrong passage" }).click();
mark(`confirm reads: "${await john.locator("span", { hasText: /put it back/ }).first().innerText()}"`);
await shot(page, "09-reopen-confirm");
await john.getByRole("button", { name: "Remove" }).click();
await page.waitForTimeout(1500);
mark(`row now: ${(await john.innerText()).split("\n").slice(0, 3).join(" | ")}`);
await shot(page, "10-reopened");

await page.goto(`${BASE}/read?book=JHN&chapter=6`);
await page.waitForTimeout(2500);
const body = await page.locator("main").innerText();
mark(`reader JHN 6 still mentions "Pastor John": ${body.includes("Pastor John")}`);
await shot(page, "11-reader-after-reopen");

// 6. Phone width, the state most of the catalogue sits in.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p2 = await phone.newPage();
await signIn(p2);
await p2.goto(`${BASE}/sermon-sources`);
await p2.getByRole("region", { name: "What songbird found" }).waitFor({ timeout: 15000 });
await p2.getByLabel("Filter by state").selectOption("needs_passage");
await p2.waitForTimeout(1200);
await shot(p2, "12-phone-needs-passage");
const w = await p2.evaluate(() => document.documentElement.scrollWidth);
mark(`phone document scrollWidth: ${w} (390 = nothing overflows)`);

await browser.close();
log(`\nplaced ${placed} by chip; screenshots in ${OUT}`);
