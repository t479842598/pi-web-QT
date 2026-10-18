import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "work/final-audit";
mkdirSync(OUT, { recursive: true });
const KITS = ["pi", "claude"];
const VPS = [
  { n: "desktop", w: 1440, h: 900 },
  { n: "laptop", w: 1280, h: 800 },
  { n: "phone", w: 390, h: 844 },
];
const SURFACES = [
  { id: "welcome", open: false },
  { id: "settings-display", open: true, nav: 0 },
  { id: "settings-ui-kit", open: true, nav: 1 },
  { id: "settings-models", open: true, nav: 3 },
];

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"] });
const report = [];

for (const kit of KITS) {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: "zh-CN", deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.addInitScript((k) => {
      localStorage.setItem("pi-theme", "claude");
      localStorage.setItem("pi-theme-mode", "dark");
      localStorage.setItem("pi-ui-kit", k);
    }, kit);

    await page.goto("http://127.0.0.1:30777/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);

    for (const s of SURFACES) {
      try {
        if (s.open) {
          const gear = await page.evaluate(() => {
            const n = [...document.querySelectorAll("button[aria-label]")].find((x) =>
              /^(设置|Settings)$/.test((x.getAttribute("aria-label") ?? "").trim()));
            if (!n) return false;
            n.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return true;
          });
          if (gear) {
            await page.waitForSelector(".settings-modal-nav-item", { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(1200);
            await page.evaluate((idx) => {
              const items = [...document.querySelectorAll(".settings-modal-nav-item")];
              items[idx]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }, s.nav ?? 0);
            await page.waitForTimeout(1400);
          }
        }
        const facts = await page.evaluate(() => {
          const doc = document.documentElement;
          const overflow = doc.scrollWidth - doc.clientWidth;
          const squareRings = [...document.querySelectorAll("input,textarea")].filter((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return r.width > 6 && cs.boxShadow !== "none" && parseFloat(cs.borderRadius) === 0;
          }).length;
          return { overflow, squareRings, kit: doc.dataset.uiKit };
        });
        report.push({ kit, vp: vp.n, surface: s.id, ...facts, errors: errors.slice(0, 2) });
        await page.screenshot({ path: `${OUT}/${kit}-${vp.n}-${s.id}.png` });
      } catch (error) {
        report.push({ kit, vp: vp.n, surface: s.id, failed: String(error.message).slice(0, 80) });
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
