import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * Full-surface visual audit.
 *
 * Drives the running dev server through every page and state a reader can
 * reach, in both kits, and photographs each one. This is the pass that has to
 * happen *before* a human reviews the design: a screenshot set plus a machine
 * check of the things that are objectively wrong (horizontal overflow, console
 * errors, a surface that failed to mount).
 *
 * Usage:
 *   node scripts/visual-audit.mjs --port 30777 [--only chat,settings] [--kit pi]
 *
 * Exit code is non-zero when any page reports an error, so it can gate a
 * release instead of being just a pile of PNGs.
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const port = Number(arg("port", "30777"));
const only = arg("only", "");
const onlyKits = arg("kit", "claude,pi").split(",");
const onlyViewports = arg("viewport", "").split(",").filter(Boolean);
const outDir = arg("out", join(process.cwd(), "work/audit"));
mkdirSync(outDir, { recursive: true });

const BASE = `http://127.0.0.1:${port}`;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1100, height: 800 },
  { name: "tablet", width: 900, height: 820 },
  { name: "phone", width: 390, height: 844 },
];

/** Every surface the audit must cover. `action` runs after the page settles. */
const SURFACES = [
  {
    id: "welcome",
    prepare: () => {},
  },
  {
    id: "settings-display",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 0);
    },
  },
  {
    id: "settings-ui-kit",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 1);
    },
  },
  {
    id: "settings-chat",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 2);
    },
  },
  {
    id: "settings-models",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 3);
    },
  },
  {
    id: "settings-features",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 6);
    },
  },
  {
    id: "settings-tools",
    prepare: async (page) => {
      await openSettings(page);
      await clickNav(page, 13);
    },
  },
  {
    id: "palette",
    prepare: async (page) => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await page.waitForTimeout(600);
    },
  },
  {
    id: "sidebar-collapsed",
    prepare: async (page) => {
      const toggled = await page.evaluate(() => {
        // The collapse control is localised; match the intent, not the string.
        const nodes = [...document.querySelectorAll("button[aria-label]")];
        const button = nodes.find((node) => /^(隐藏侧边栏|显示侧边栏|Hide sidebar|Show sidebar)$/.test((node.getAttribute("aria-label") ?? "").trim()));
        if (!button) return false;
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      });
      if (!toggled) throw new Error("sidebar toggle not found");
      await page.waitForTimeout(700);
    },
  },
];

async function openSettings(page) {
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("button")];
    const gear = nodes.find((node) => {
      const label = node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "";
      return /^(设置|Settings|偏好设置|Preferences)$/.test(label.trim());
    }) ?? nodes.find((node) => /settings|设置/i.test(node.getAttribute("aria-label") ?? ""));
    if (!gear) return false;
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  if (!opened) throw new Error("Settings entry not found");
  await page.waitForSelector(".settings-modal-nav-item", { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function clickNav(page, index) {
  const label = await page.evaluate((at) => {
    const items = [...document.querySelectorAll(".settings-modal-nav-item")];
    if (at >= items.length) return null;
    items[at].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return items[at].textContent?.trim() ?? "?";
  }, index);
  if (label === null) throw new Error(`nav index ${index} missing`);
  await page.waitForTimeout(1200);
  return label;
}

/** Objective problems only — taste is the human's job. */
async function inspect(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;
    // Only elements the reader can actually see count. A collapsed mobile
    // sidebar parks its children off-screen on purpose, and an element inside a
    // closed dialog has no box at all — neither is a layout bug.
    const onScreen = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (rect.bottom < 0 || rect.top > doc.clientHeight) return false;
      // `visibility`, `display`, and ancestor `overflow` all collapse into this.
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.opacity === "0") return false;
      // Inside a closed (aria-hidden / inert) subtree.
      if (el.closest('[aria-hidden="true"], [inert], dialog:not([open])') !== null) return false;
      // An element parked outside the viewport by a transform is intentional
      // (the mobile sidebar slides away). Walking up for a scroll container that
      // owns the overflow distinguishes that from a real escape.
      let node = el.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/auto|scroll|hidden/.test(style.overflowX)) return false;
        node = node.parentElement;
      }
      return true;
    };
    const clipped = [...document.querySelectorAll("button, code, h1, h2, span")]
      .filter((el) => onScreen(el))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > doc.clientWidth + 2 || rect.left < -2;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || "").trim().slice(0, 24)}`);
    const zeroSized = [...document.querySelectorAll(".settings-modal-nav-item")]
      .filter((el) => el.getBoundingClientRect().height === 0).length;
    return {
      overflowX,
      clipped,
      navItems: document.querySelectorAll(".settings-modal-nav-item").length,
      zeroSizedNav: zeroSized,
      kit: doc.dataset.uiKit ?? "pi",
      theme: doc.dataset.theme ?? "(default)",
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    };
  });
}

// A 2x device scale on a 1440-wide viewport repeatedly killed the renderer on
// this machine (compositor memory), and a dead context aborts the whole run.
// 1x keeps every geometry assertion honest — those are CSS pixels either way.
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
});
const report = [];
let failures = 0;

for (const kit of onlyKits) {
  for (const viewport of VIEWPORTS.filter((v) => onlyViewports.length === 0 || onlyViewports.includes(v.name))) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 160));
    });

    await page.addInitScript((chosenKit) => {
      localStorage.setItem("pi-theme", "claude");
      localStorage.setItem("pi-theme-mode", "dark");
      localStorage.setItem("pi-ui-kit", chosenKit);
      localStorage.setItem("pi-ui-kit-layout", "standard");
    }, kit);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // The shell mounts after /api/sessions; the SSE streams never settle, so poll.
    // The shell only renders the Settings entry once /api/sessions resolves; a
    // cold Next dev compile can take a while on the first viewport, so this gets
    // a generous budget instead of a 30s guess.
    // A Turbopack cold start can serve a shell-less first paint, and the very
    // first viewport of a run pays that cost. One reload separates a cold start
    // from a real mounting failure.
    // The label is localised (`设置` in zh-CN, `Settings` in en), so match either.
    // Hard-coding the English string is what made every first surface of a run
    // report "shell never mounted" while the page was in fact fully rendered.
    const findSettings = () => {
      const nodes = [...document.querySelectorAll("button[aria-label], button[title]")];
      return nodes.find((node) => {
        const label = `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""}`;
        return /^(设置|Settings|偏好设置|Preferences)$/.test(label.trim());
      }) ?? null;
    };
    const mounted = await page
      .waitForFunction(findSettings, undefined, { timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    if (!mounted) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .waitForFunction(findSettings, undefined, { timeout: 60000 })
        .catch(() => errors.push("shell never mounted"));
    }

    for (const surface of SURFACES) {
      if (only && !only.split(",").includes(surface.id)) continue;
      // Close whatever the previous surface left open instead of reloading.
      // Reloading tears down the shell's SSE streams each time and Chromium
      // eventually kills the context ("Target page ... has been closed").
      try {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
        await page.evaluate(() => {
          // Belt and braces: a dialog that ignores Escape still gets closed so
          // the next surface photographs a clean tree.
          document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((node) => {
            const close = node.querySelector('.settings-modal-close, [aria-label="Close"], [aria-label="关闭"]');
            if (close instanceof HTMLElement) close.click();
          });
        });
        await page.waitForTimeout(200);
      } catch {
        // Ignore: the surface prepare below reports anything that matters.
      }
      try {
        await surface.prepare(page);
      } catch (error) {
        errors.push(`${surface.id}: ${error.message.split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(400);
      const facts = await inspect(page);
      const file = join(outDir, `${kit}-${viewport.name}-${surface.id}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const bad = facts.overflowX > 2 || facts.clipped.length > 0 || facts.zeroSizedNav > 0;
      if (bad) failures += 1;
      report.push({ kit, viewport: viewport.name, surface: surface.id, file, ...facts, ok: !bad });
    }

    if (errors.length) {
      failures += 1;
      report.push({ kit, viewport: viewport.name, surface: "(page errors)", errors: errors.slice(0, 6), ok: false });
    }
    await context.close();
    } catch (error) {
      // A renderer that dies mid-run must not hang the whole audit: record it
      // and move on to the next viewport.
      failures += 1;
      report.push({ kit, viewport: viewport.name, surface: "(viewport aborted)", errors: [String(error.message).split(chr(10))[0]], ok: false });
      try { await context.close(); } catch {}
    }
  }
}

await browser.close();

const bad = report.filter((row) => row.ok === false);
console.log(JSON.stringify({ total: report.length, failed: bad.length, failures }, null, 1));
for (const row of bad) console.log("FAIL", JSON.stringify(row));
if (bad.length === 0) console.log("PASS: no overflow, no clipped text, no console errors");
process.exit(bad.length === 0 ? 0 : 1);
