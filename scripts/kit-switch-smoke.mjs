/**
 * Kit switch smoke test.
 *
 * The reason this exists as a script: verifying the switch by seeding
 * `localStorage` in `addInitScript` does not work. The app's own bootstrap
 * script runs after it and rewrites `html.dataset.uiKit` from the same keys, so
 * a probe that seeds storage can silently measure the *previous* kit — which is
 * exactly how a working switch got reported as broken for two rounds.
 *
 * The reliable path is the one a user takes: load the page, click the title-bar
 * switch, and read the DOM before and after in the same session.
 *
 * Usage: node scripts/kit-switch-smoke.mjs --port 30777 [--out work/e2e]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

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

const read = () =>
  page.evaluate(() => {
    const row = document.querySelector(".session-row");
    const sidebar = document.querySelector(".claude-sidebar");
    return {
      kit: document.documentElement.dataset.uiKit,
      rows: document.querySelectorAll(".session-row").length,
      rowRadius: row ? getComputedStyle(row).borderRadius : null,
      claudeSidebar: Boolean(sidebar),
      claudeTabBar: document.querySelectorAll(".claude-tab-bar").length,
    };
  });

const before = await read();
await page.screenshot({ path: join(outDir, "kit-smoke-pi.png") });

// Flip through the real control the user clicks, never through storage.
const flipped = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find(
    (node) => (node.textContent ?? "").trim() === "Claude",
  );
  if (!button) return false;
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
});
await page.waitForTimeout(3000);
const after = await read();
await page.screenshot({ path: join(outDir, "kit-smoke-claude.png") });

await browser.close();

const problems = [];
if (!flipped) problems.push("the Claude switch was not found in the title bar");
if (before.kit !== "pi") problems.push(`expected the page to start on pi, saw ${before.kit}`);
if (after.kit !== "claude") problems.push(`clicking the switch did not change the kit (saw ${after.kit})`);
if (!after.claudeSidebar) problems.push("the claude sidebar did not mount");
if (after.rows < 1) problems.push("no session rows rendered");
if (after.rowRadius === before.rowRadius) {
  problems.push(`session rows did not change between kits (both ${before.rowRadius})`);
}
if (errors.length) problems.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);

console.log(JSON.stringify({ before, after, flipped, problems }, null, 1));
process.exit(problems.length === 0 ? 0 : 1);
