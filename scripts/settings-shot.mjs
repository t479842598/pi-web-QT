import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Screenshot the real settings modal offline.
 *
 * The app's dev server requires the web password, so this harness bundles the
 * real `SettingsModal` (and therefore the real section components) with esbuild,
 * serves it from a throwaway port, fakes every `/api/*` the sections touch, and
 * photographs the result. Nothing about the app's own server or its auth state
 * is touched.
 *
 * Usage: node scripts/settings-shot.mjs [--tabs display,chat,ui-kit] [--widths 1440,900,390]
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "work/shots");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const tabs = arg("tabs", "display,ui-kit,chat,features,models,subagents").split(",");
const widths = arg("widths", "1440,900,390").split(",").map(Number);

// ─── Bundle ────────────────────────────────────────────────────────────────

const { outputFiles } = await build({
  absWorkingDir: root,
  entryPoints: ["e2e/settings-shell-fixture.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  // A few shared modules import Node built-ins on code paths the browser never
  // takes (`lib/paths.ts` is server-only but reachable through a barrel import).
  // Marking them *external* makes esbuild emit `require("path")`, which throws in
  // a browser. Resolving them to an empty stub keeps the import harmless.
  plugins: [
    {
      name: "node-builtin-stub",
      setup(build) {
        const builtins = /^(node:)?(fs|path|os|crypto|stream|util|events|url|zlib|child_process|module|assert)$/;
        build.onResolve({ filter: builtins }, (args) => ({ path: args.path, namespace: "node-stub" }));
        build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => ({
          contents:
            `const noop = () => { throw new Error("${args.path} is not available in the browser (settings screenshot fixture)"); };` +
            `const handler = { get: () => noop, apply: noop };` +
            `export default new Proxy(function () {}, handler);` +
            `export const join = noop, resolve = noop, dirname = noop, basename = noop, sep = "/", extname = noop, relative = noop, isAbsolute = noop, normalize = noop;` +
            `export const readFileSync = noop, writeFileSync = noop, existsSync = () => false, statSync = noop, mkdirSync = noop, readdirSync = () => [];`,
          loader: "js",
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "@": root },
  logLevel: "error",
});
const script = outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";

// Tailwind is compiled through the project's own config so the utilities the
// settings CSS relies on exist.
const postcss = (await import("postcss")).default;
const tailwind = (await import("@tailwindcss/postcss")).default;
const { readFile } = await import("node:fs/promises");
const globalsSrc = (await readFile(join(root, "app/globals.css"), "utf8")).replace(/@import "@xterm[^\n]*\n/, "");
const compiled = await postcss([tailwind()]).process(globalsSrc, { from: join(root, "app/globals.css") });
const settingsCss = await readFile(join(root, "app/settings.css"), "utf8");
const kitCss = await readFile(join(root, "app/ui-kit-claude.css"), "utf8");
const shellCss = await readFile(join(root, "app/settings-claude.css"), "utf8");

const html = `<!doctype html>
<html lang="zh-CN" class="dark" data-theme="claude" data-ui-kit="claude" data-ui-kit-layout="standard">
<head><meta charset="utf-8">
<style>${compiled.css}</style>
<style>${settingsCss}</style>
<style>${kitCss}</style>
<style>${shellCss}</style>
<style>html,body,#root{height:100%;margin:0}</style>
<script>
  window.__fixtureErrors = [];
  window.addEventListener("error", (event) => {
    window.__fixtureErrors.push(String(event.message) + " @ " + (event.filename || "") + ":" + event.lineno);
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__fixtureErrors.push("rejection: " + String(event.reason && event.reason.message || event.reason));
  });
</script>
</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;

// ─── Fake API ──────────────────────────────────────────────────────────────

const nowIso = new Date("2026-10-17T12:00:00Z").toISOString();
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const routes = {
  "/api/web-auth": () => json({ enabled: true, authenticated: true }),
  "/api/themes": () => json({
    sets: [
      { name: "claude", displayName: "Claude", hasDark: true, hasLight: true, builtin: false, accent: "#d97757" },
      { name: "gruvbox", displayName: "Gruvbox", hasDark: true, hasLight: true, builtin: false, accent: "#d79921" },
      { name: "nord", displayName: "Nord", hasDark: true, hasLight: true, builtin: false, accent: "#88c0d0" },
      { name: "tokyo", displayName: "Tokyo Night", hasDark: true, hasLight: false, builtin: false, accent: "#7aa2f7" },
    ],
    current: "claude",
  }),
  "/api/settings/appearance": () => json({ fontScale: 1 }),
  "/api/features": () => json({ tasksBoard: true, subagents: true, builtInSubagents: false, profiles: [], disabledBuiltIns: [] }),
  "/api/modes": () => json({ collaborationMode: "normal", toolApprovalMode: "ask" }),
  "/api/snippets": () => json({ snippets: [
    { id: "s1", name: "审阅改动", body: "请审阅当前改动并给出风险点。" },
    { id: "s2", name: "写测试", body: "为这段逻辑补单测。" },
  ] }),
  "/api/tools/settings": () => json({ shell: "bash", powershell: false }),
  "/api/tools/extension-tools": () => json({ tools: [] }),
  "/api/models": () => json({
    models: [{ provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
    modelList: [{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  }),
  "/api/models/enabled": () => json({ enabled: ["anthropic/*"], settingsPath: "~/.pi/agent/settings.json", total: 1, scope: "global" }),
  "/api/subagents/settings": () => json({ builtInEnabled: false, profiles: [], disabledBuiltIns: [] }),
  "/api/sessions": () => json({ sessions: [] }),
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (url.pathname === "/fixture.js") {
    // Served as its own resource: a 12 MB inline script is silently dropped by
    // some parsers, which looked exactly like "React never mounted".
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(script);
    return;
  }
  const handler = Object.entries(routes).find(([path]) => url.pathname === path)?.[1];
  const result = handler ? handler() : json({});
  res.writeHead(result.status, { "content-type": result.contentType });
  res.end(result.body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// ─── Shoot ─────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const written = [];
for (const width of widths) {
  for (const tab of tabs) {
    const context = await browser.newContext({
      viewport: { width, height: width < 640 ? 780 : 900 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("[pageerror]", error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.error(`[console.${message.type()}]`, message.text().slice(0, 400));
      }
    });
    await page.goto(`http://127.0.0.1:${port}/?tab=${tab}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const mounted = await page.evaluate(() => ({
      rootChildren: document.getElementById("root")?.childElementCount ?? -1,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      navItems: document.querySelectorAll(".settings-modal-nav-item").length,
      bodyText: (document.body.innerText || "").slice(0, 160),
      errs: (window.__fixtureErrors ?? []).slice(0, 3),
      booted: document.getElementById("root")?.dataset.fixtureBooted ?? "NO",
      rendered: document.getElementById("root")?.dataset.fixtureRendered ?? "NO",
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
    }));
    console.error("[mounted]", JSON.stringify(mounted));
    const file = join(outDir, `settings-${tab}-${width}.png`);
    await page.screenshot({ path: file });
    written.push(file);
    await context.close();
  }
}
await browser.close();
server.close();
writeFileSync(join(outDir, "index.json"), JSON.stringify(written, null, 1));
console.log(written.join("\n"));
