// One-off: capture README screenshots of the running app via headless Chromium.
// Requires a dev server on :3000 and `npx playwright install chromium`.
//   npm run dev &  &&  node scripts/capture-screens.mjs
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = join(process.cwd(), "docs", "screenshots");
const SAMPLES = join(process.cwd(), "sample-labels");
const all = [
  "old-tom-bourbon_compliant.png",
  "old-tom-bourbon_glare-angle.jpg",
  "old-tom-bourbon_missing-warning.png",
  "old-tom-bourbon_altered-warning.png",
  "chateau-exemple_import-wine_compliant.png",
].map((f) => join(SAMPLES, f));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

// ---- Single label ----
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"]', join(SAMPLES, "old-tom-bourbon_compliant.png"));
await page.getByRole("button", { name: "Verify label" }).click();
await page.getByText("TTB required elements").waitFor({ timeout: 90000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "single.png"), fullPage: true });
console.log("captured single.png");

// ---- Batch ----
await page.getByRole("button", { name: "Batch" }).click();
await page.setInputFiles('input[type="file"]', all);
await page.getByRole("button", { name: /Verify \d+ labels/ }).click();
await page.waitForFunction(
  () => {
    const t = document.body.innerText;
    return !t.includes("Analyzing") && (t.includes("Compliant") || t.includes("Not compliant"));
  },
  { timeout: 180000 },
);
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "batch.png"), fullPage: true });
console.log("captured batch.png");

await browser.close();
