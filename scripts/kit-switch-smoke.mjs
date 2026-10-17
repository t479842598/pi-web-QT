/**
 * Kit-switch smoke test.
 *
 * Verifying the switch by seeding `localStorage` in `addInitScript` does not
 * work. The app's own bootstrap script runs after it and rewrites
 * `html.dataset.uiKit` from the same keys, so a probe that seeds storage can
 * silently measure the *previous* kit — which is exactly how a working switch
 * got reported as broken for two rounds.
 *
 * The reliable path is the one a user takes: load the page, click the title-bar
 * switch, and read the DOM before and after in the same session.
 *
 * The assertions themselves live in `e2e/kit-switch.mjs` so this script and the
 * full e2e suite cannot drift apart.
 *
 * Usage: node scripts/kit-switch-smoke.mjs --port 30777 [--out work/e2e]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

import { flipToClaude, kitSwitchProblems, readKitSurface } from "../e2e/kit-switch.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const port = Number(arg("port", "30777"));
const outDir = arg("out", join(process.cwd(), "work/e2e"));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));

await page.addInitScript(() => {
  localStorage.setItem("pi-theme", "claude");
  localStorage.setItem("pi-theme-mode", "dark");
  localStorage.setItem("pi-ui-kit", "pi");
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
// Pin the list view: the sidebar remembers "groups" between loads, and the
// rows only exist in list view.
await page
  .waitForFunction(() => document.querySelectorAll(".session-row").length > 0, undefined, { timeout: 20000 })
  .catch(async () => {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button[aria-label]")].find((node) =>
        /切换侧边栏模式/.test(node.getAttribute("aria-label") ?? ""),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(2000);
  });

const before = await readKitSurface(page);
await page.screenshot({ path: join(outDir, "kit-smoke-pi.png") });

const flipped = await flipToClaude(page);
await page.waitForTimeout(3000);
const after = await readKitSurface(page);
await page.screenshot({ path: join(outDir, "kit-smoke-claude.png") });

await browser.close();

const problems = kitSwitchProblems(before, after, flipped);
if (errors.length) problems.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);

console.log(JSON.stringify({ before, after, flipped, problems }, null, 1));
process.exit(problems.length === 0 ? 0 : 1);
