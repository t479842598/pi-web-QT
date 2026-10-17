import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * Screenshot the live settings page.
 *
 * Points at a dev server that already runs this checkout (start your own on a
 * free port; the packaged app on 30141 serves built code and would show the
 * wrong thing). Authenticates with the operator's local password, read from
 * `PI_WEB_PASSWORD` or `~/.pi/agent/pi-web.env`, and never printed.
 *
 * Usage:
 *   PI_WEB_PASSWORD=… node scripts/settings-live-shot.mjs \
 *     --port 30777 --tabs display,ui-kit --widths 1440,900,390
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

/** SETTINGS_TABS order as the web build renders it (the "server" tab is desktop-only). */
const TAB_ORDER = [
  "display", "ui-kit", "chat", "models", "skills", "plugins",
  "proxy", "features", "logs", "snippets", "usage",
  "mcp", "subagents", "tools", "backup", "import",
];

const port = Number(arg("port", "30141"));
const tabs = arg("tabs", "display,ui-kit,chat,features,models,subagents").split(",");
const widths = arg("widths", "1440,900,390").split(",").map(Number);
const outDir = arg("out", join(process.cwd(), "work/shots"));
mkdirSync(outDir, { recursive: true });

function readPassword() {
  if (process.env.PI_WEB_PASSWORD) return process.env.PI_WEB_PASSWORD;
  try {
    const env = readFileSync(join(process.env.HOME ?? "", ".pi/agent/pi-web.env"), "utf8");
    const line = env.split("\n").find((row) => row.startsWith("PI_WEB_PASSWORD="));
    return line ? line.slice("PI_WEB_PASSWORD=".length).trim() : "";
  } catch {
    return "";
  }
}

const password = readPassword();
if (!password) {
  console.error("No PI_WEB_PASSWORD (env or ~/.pi/agent/pi-web.env).");
  process.exit(1);
}
const basic = "Basic " + Buffer.from(`pi:${password}`).toString("base64");

const browser = await chromium.launch();
const written = [];

for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: width < 640 ? 780 : 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    // `httpCredentials` (not a manual Authorization header): Playwright replays
    // Basic auth on every request the page makes, including the client-side
    // fetches to /api/sessions. A raw header only covers the navigation, so the
    // shell mounted empty and never rendered its Settings button.
    httpCredentials: { username: "pi", password },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("[pageerror]", error.message.split("\n")[0]));

  // Pin the theme and kit so the screenshot shows the Claude palette regardless
  // of what this browser profile last selected. A different theme is a separate
  // question ("how does it look in Gruvbox"), not this run's.
  await page.addInitScript(() => {
    localStorage.setItem("pi-theme", "claude");
    localStorage.setItem("pi-theme-mode", "dark");
    localStorage.setItem("pi-ui-kit", "claude");
    localStorage.setItem("pi-ui-kit-layout", "standard");
    localStorage.setItem("pi-ui-kit-sidebar-toggle", "sidebar");
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  // Fixed settle: this exact shape is what produced the working screenshots.
  // The shell mounts from /api/sessions and the SSE streams stay open, so a
  // network-idle wait never resolves; 6s is enough for a warm dev server.
  await page.waitForTimeout(6000);


  let first = true;
  for (const tab of tabs) {
    const index = TAB_ORDER.indexOf(tab);
    if (index < 0) {
      console.error(`[warn] unknown tab ${tab}`);
      continue;
    }

    if (first) {
      const opened = await page.evaluate(() => {
        const gear = document.querySelector('button[aria-label="Settings"]');
        if (!gear) return false;
        gear.click();
        return true;
      });
      if (!opened) {
        console.error("[warn] settings button not clickable");
        break;
      }
      first = false;
    }
    await page.waitForSelector(".settings-modal-nav-item", { timeout: 15000 });

    const picked = await page.evaluate((at) => {
      const items = [...document.querySelectorAll(".settings-modal-nav-item")];
      if (at >= items.length) return null;
      items[at].click();
      return items[at].textContent?.trim() ?? "?";
    }, index);
    if (picked === null) {
      console.error(`[warn] tab index ${index} out of range (${tab})`);
      continue;
    }

    // Let the section's async data land (the theme list comes from /api/themes).
    await page.waitForTimeout(400);
    await page
      .waitForFunction(
        () => !/加载主题中|Loading themes/i.test(document.querySelector(".settings-modal-main")?.innerText ?? ""),
        undefined,
        { timeout: 10000 },
      )
      .catch(() => console.error(`[warn] ${tab}: themes still loading`));

    const file = join(outDir, `live-${tab}-${width}.png`);
    await page.screenshot({ path: file });
    written.push(file);
    console.error(`[shot] ${tab} (idx ${index}) -> "${picked}" @${width}`);
  }

  await context.close();
}

await browser.close();
console.log(written.join("\n"));
