/**
 * pi UI fidelity baseline — structural + computed-style + geometry fingerprints.
 *
 * The dual-kit refactor must leave the pi skin pixel-identical. Pixel diffing
 * would need new dependencies (pixelmatch/pngjs), so this module fingerprints
 * the *rendered* UI instead: normalised outerHTML with dynamic values stripped,
 * a fixed computed-style subset, and 0.5px-rounded bounding boxes per selector.
 *
 * Every surface is recorded per viewport, so one baseline covers the mobile and
 * desktop shells. The same module captures, compares, and (as a CLI) seeds the
 * e2e fixtures — which keeps a baseline and a later comparison apples-to-apples:
 *
 *   node e2e/kit-parity.mjs --capture   # writes e2e/baselines/pi-kit.json
 *   node e2e/kit-parity.mjs --check     # capture + compare against it
 *
 * checkKitParity(page, ...) is the hook used from e2e/run.mjs: it skips quietly
 * while no baseline exists, and fails only on a real drift.
 *
 * Determinism: timestamps, UUIDs, clock times, durations, relative times,
 * version strings, absolute temp paths and generated ids are replaced with
 * placeholders; animations and transitions are disabled while capturing; every
 * surface waits for its DOM to stop moving (fonts, scroll, virtualised item
 * count) before anything is read.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { filePanelFixture } from "./file-panel.mjs";

export const KIT_PARITY_VERSION = 1;

/** Where the pi-kit baseline lives, relative to the repository root. */
export const KIT_PARITY_BASELINE = "e2e/baselines/pi-kit.json";

/** Baseline viewports: narrow phone, phone, desktop. */
export const KIT_PARITY_VIEWPORTS = [
  { name: "320x844", width: 320, height: 844 },
  { name: "390x844", width: 390, height: 844 },
  { name: "1440x900", width: 1440, height: 900 },
];

/** Computed-style properties captured for every part. */
export const KIT_PARITY_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "border-radius",
  "font-size",
  "padding",
  "gap",
  "box-shadow",
  "display",
  "position",
];

/**
 * Session fixtures the surfaces resolve against. Ids and payloads mirror
 * e2e/run.mjs, so a check driven by that suite sees the same DOM as the
 * baseline. The subagent session only exists in the kit-parity fixture server.
 */
export const KIT_PARITY_SESSIONS = {
  long: "e2e-long-session",
  rich: "e2e-rich-session",
  subagent: "e2e-kit-subagent-session",
};

/** Project files the file-preview surfaces open (by basename). */
export const KIT_PARITY_FILES = {
  html: "preview.html",
  markdown: "notes.md",
};

/**
 * Browser state pinned before capture, so a themed, kit-switched, or resized
 * profile cannot masquerade as a parity diff.
 */
export const KIT_PARITY_STORAGE = {
  "pi-ui-kit": "pi",
  "pi-ui-kit-layout": "standard",
  "pi-ui-kit-sidebar-toggle": "sidebar",
  "pi-theme-mode": "dark",
  "pi-locale": "en",
  "pi-chat-content-width": "820",
  "pi-chat-content-font-size": "14",
  "pi-sidebar-width": "280",
  "pi-right-panel-width": "520",
};

/** Keys removed before capture so scope/slot overrides cannot leak in. */
export const KIT_PARITY_STORAGE_REMOVED = ["pi-ui-kit-scopes", "pi-ui-kit-slots"];

const NO_MOTION_CSS = [
  "*,*::before,*::after{",
  "animation-duration:0s!important;animation-delay:0s!important;",
  "transition-duration:0s!important;transition-delay:0s!important;",
  "scroll-behavior:auto!important;caret-color:transparent!important}",
].join("");

const BACKSLASH = String.fromCharCode(92);
const FENCE = String.fromCharCode(96).repeat(3);

// ─── Parts / surfaces ────────────────────────────────────────────────────────

const part = (name, selector, extra = {}) => ({ name, selector, ...extra });
const pathPart = (name, path, extra = {}) => ({ name, path, ...extra });

const SHELL_PARTS = [
  part("titleBar", ".app-title-bar"),
  // The whole app region is the sum of the parts below; record only its box and
  // style, which keeps the baseline small and the diffs focused.
  part("main", ".app-main-region", { html: false }),
];

/**
 * The composer's reasoning control renders a value the UI resolves from live
 * session state (it reads "auto" before a wrapper exists and the session's own
 * level afterwards), so it is a state readout like a timestamp, not skin. Both
 * the title attribute and the visible label are replaced; the word boundaries
 * leave neighbouring copy ("Edit automatically") untouched.
 */
const REASONING_LEVEL_REPLACEMENTS = [["\\b(?:auto|off|minimal|low|medium|high|xhigh|max)\\b", "<REASONING_LEVEL>"]];

const COMPOSER_PARTS = [
  part("composerShell", ".chat-input-shell", { replacements: REASONING_LEVEL_REPLACEMENTS }),
  part("composerEditor", ".chat-input-editor-row", { replacements: REASONING_LEVEL_REPLACEMENTS }),
  part("composerTextarea", ".chat-input-textarea"),
  part("composerToolbar", ".chat-input-toolbar", { replacements: REASONING_LEVEL_REPLACEMENTS }),
  part("composerSend", ".chat-input-send"),
  part("sessionInfoBar", ".session-info-bar"),
];

/**
 * Sidebar chrome. Session rows carry fixture text and therefore depend on how
 * many sessions the harness seeded; those parts are marked fixtureSensitive so
 * a caller driving a different fixture set (e2e/run.mjs) can skip their HTML
 * without losing the chrome comparison.
 */
const SIDEBAR_PARTS = [
  part("sidebar", "#session-sidebar", { html: false }),
  pathPart("sidebarActions", ["#session-sidebar", "> div", "> div", "> div"], { index: 0 }),
  part("sidebarFooter", ".sidebar-utility-bar"),
  // Project header plus every session row: fixture text, so fixtureSensitive.
  part("sidebarRows", ".scroll-overlay", { fixtureSensitive: true }),
];

const PROCESS_ITEM = "[data-item-key^='process-'] .group" + BACKSLASH + "/process";
const PROCESS_SUMMARY = "[data-item-key^='process-'] button.group" + BACKSLASH + "/summary";

const CONVERSATION_PARTS = [
  part("scroll", ".chat-scroll-fade"),
  part("messageList", ".virtualized-message-list", { html: false, childCount: true }),
  pathPart("firstItem", [".virtualized-message-list", "> *"], { index: 0 }),
  pathPart("lastItem", [".virtualized-message-list", "> *"], { index: -1 }),
  part("lastUserBubble", ".chat-user-bubble", { index: -1 }),
  part("lastAssistantContent", ".chat-assistant-content", { index: -1 }),
];

const TOOL_PARTS = [
  part("processGroup", PROCESS_ITEM, { index: 0 }),
  part("processSummary", PROCESS_SUMMARY, { index: 0 }),
  part("toolCard", ".tool-call-block.is-process", { index: 0 }),
  part("toolTab", ".process-tab", { index: 0 }),
];

const SUBAGENT_PARTS = [part("subagentRow", ".subagent-run-row", { index: 0 })];

const SETTINGS_PARTS = [
  // Box and style only: the dialog mounts every section, including hidden ones
  // whose async, environment-dependent content would make the hash unstable.
  part("dialog", "section.settings-modal[role='dialog']", { html: false }),
  part("rail", ".settings-modal-rail"),
  part("nav", ".settings-modal-nav"),
  part("heading", ".settings-modal-main .settings-modal-heading"),
  pathPart("displayPanel", [".settings-modal-page > div:has(.settings-content-title)"]),
  pathPart("themeSection", [".settings-modal-page > div:has(.settings-content-title)", ".settings-content-section"], {
    index: 0,
  }),
  pathPart("appearanceSection", [".settings-modal-page > div:has(.settings-content-title)", ".settings-content-section"], {
    index: 1,
  }),
  pathPart("languageSection", [".settings-modal-page > div:has(.settings-content-title)", ".settings-content-section"], {
    index: 2,
  }),
];

const FILE_PARTS = [
  part("filePanel", "#file-panel", { html: false }),
  part("tabBar", ".file-tab-bar"),
  part("tab", ".file-tab", { index: 0 }),
  part("statusBar", ".file-viewer-status-bar"),
];

const MARKDOWN_PARTS = [
  part("markdownPreview", "#file-panel .markdown-body.markdown-file-preview"),
];

const SHELL = [...SHELL_PARTS, ...SIDEBAR_PARTS, ...COMPOSER_PARTS];

/** The captured surfaces, in capture order. */
export const KIT_PARITY_SURFACES = [
  {
    name: "welcome",
    parts: SHELL,
    async prepare(page, ctx) {
      await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded" });
      await page.locator(".chat-input-textarea").waitFor();
    },
  },
  {
    name: "conversation-long",
    parts: [...SHELL_PARTS, ...SIDEBAR_PARTS, ...CONVERSATION_PARTS, ...COMPOSER_PARTS],
    async prepare(page, ctx) {
      await openSession(page, ctx, ctx.sessions.long);
      await ensureSidebar(page, true);
    },
  },
  {
    name: "conversation-tool",
    parts: [...SHELL_PARTS, ...CONVERSATION_PARTS, ...TOOL_PARTS, ...COMPOSER_PARTS],
    async prepare(page, ctx) {
      await openSession(page, ctx, ctx.sessions.rich);
      await expandProcessGroups(page);
    },
  },
  {
    name: "conversation-subagent",
    parts: [...SHELL_PARTS, ...CONVERSATION_PARTS, ...SUBAGENT_PARTS, ...COMPOSER_PARTS],
    async prepare(page, ctx) {
      if (!ctx.sessions.subagent) return { unavailable: "no subagent session configured" };
      await openSession(page, ctx, ctx.sessions.subagent);
      await page.locator(".subagent-run-row").first().waitFor({ timeout: 20000 });
    },
  },
  {
    name: "settings-display",
    parts: SETTINGS_PARTS,
    async prepare(page, ctx) {
      await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded" });
      await page.locator(".chat-input-textarea").waitFor();
      await ensureSidebar(page, true);
      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await page.locator("section.settings-modal[role='dialog']").waitFor();
      await page.locator(".settings-modal-nav-item", { hasText: "Display" }).first().click();
      await page.waitForFunction(() => {
        const panels = Array.from(document.querySelectorAll(".settings-modal-page > div"));
        return panels.some((panel) => panel.getClientRects().length > 0
          && panel.querySelector(".settings-content-title")?.textContent?.trim() === "Display");
      });
      // The theme swatch grid is fetched after the panel opens; capturing it
      // mid-load is the one thing that made this surface non-deterministic.
      await page.waitForFunction(() => {
        const panel = Array.from(document.querySelectorAll(".settings-modal-page > div"))
          .find((candidate) => candidate.getClientRects().length > 0);
        if (!panel) return false;
        const content = panel.innerText ?? "";
        return !/Loading themes|Loading…/.test(content);
      }, null, { timeout: 20000 }).catch(() => {});
    },
  },
  {
    name: "sidebar-expanded",
    parts: [...SHELL_PARTS, ...SIDEBAR_PARTS, ...COMPOSER_PARTS],
    async prepare(page, ctx) {
      await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded" });
      await page.locator(".chat-input-textarea").waitFor();
      await ensureSidebar(page, true);
    },
  },
  {
    name: "sidebar-collapsed",
    parts: [...SHELL_PARTS, ...SIDEBAR_PARTS, ...COMPOSER_PARTS],
    async prepare(page, ctx) {
      await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded" });
      await page.locator(".chat-input-textarea").waitFor();
      await ensureSidebar(page, false);
    },
  },
  {
    name: "file-preview-html",
    parts: [...SHELL_PARTS, ...FILE_PARTS],
    async prepare(page, ctx) {
      await openSession(page, ctx, ctx.sessions.long);
      return openProjectFile(page, ctx, ctx.files.html);
    },
  },
  {
    name: "file-preview-markdown",
    parts: [...SHELL_PARTS, ...FILE_PARTS, ...MARKDOWN_PARTS],
    async prepare(page, ctx) {
      await openSession(page, ctx, ctx.sessions.long);
      return openProjectFile(page, ctx, ctx.files.markdown, "#file-panel .markdown-body.markdown-file-preview");
    },
  },
];

// ─── Capture: driving the page ───────────────────────────────────────────────

/** Reject instead of hanging: a wedged surface must not stall the whole capture. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function openSession(page, ctx, sessionId) {
  if (!sessionId) throw new Error("session id not configured");
  // Materialise the session wrapper first. Without one the composer renders its
  // un-stated defaults ("auto", accent colour); with one it renders the values
  // restored from the transcript. Which of the two a run happens to see depends
  // on whether an earlier page already started the wrapper, so pin it here:
  // get_state creates the wrapper, and the page then renders the same state in
  // every harness and every run.
  await page.request
    .post(ctx.baseUrl + "/api/agent/" + encodeURIComponent(sessionId), { data: { type: "get_state" }, timeout: 60000 })
    .catch(() => {});
  // ChatWindow probes /api/sessions/<id>/state on mount and only then fills in
  // the composer's reasoning level, so capturing before that response lands is
  // a race. Wait for it before reading anything.
  const stateProbe = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/sessions/" + encodeURIComponent(sessionId) + "/state",
    { timeout: 20000 },
  ).catch(() => null);
  await page.goto(ctx.baseUrl + "/?session=" + encodeURIComponent(sessionId), { waitUntil: "domcontentloaded" });
  await page.locator(".chat-input-textarea").waitFor({ timeout: 30000 });
  await page.locator(".virtualized-message-list").first().waitFor({ timeout: 30000 });
  await stateProbe;
}

async function sidebarIsOpen(page) {
  return page.evaluate(() => Boolean(document.querySelector("#session-sidebar")?.classList.contains("sidebar-open")));
}

/** Force the sidebar into the requested state using whichever toggle is visible. */
async function ensureSidebar(page, open) {
  if ((await sidebarIsOpen(page)) === open) return;
  const label = open ? "Show sidebar" : "Hide sidebar";
  const buttons = page.getByRole("button", { name: label, exact: true });
  const count = await buttons.count();
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      await page.waitForFunction(
        (want) => Boolean(document.querySelector("#session-sidebar")?.classList.contains(want ? "sidebar-open" : "sidebar-closed")),
        open,
        { timeout: 10000 },
      );
      return;
    }
  }
  throw new Error('no visible "' + label + '" control');
}

/** Expand every collapsed process group so tool cards and thinking are in the DOM. */
async function expandProcessGroups(page) {
  const summaries = page.locator(PROCESS_SUMMARY);
  const count = await summaries.count();
  for (let index = 0; index < count; index++) {
    const summary = summaries.nth(index);
    if ((await summary.getAttribute("aria-expanded")) === "false") {
      await summary.click().catch(() => {});
      await delay(120);
    }
  }
  // Deferred thinking payloads arrive after the first paint.
  await page.waitForFunction(() => !document.body.innerText.includes("Loading thinking"), null, { timeout: 20000 }).catch(() => {});
}

/** Reveal the file explorer, open a project file, and wait for its preview. */
async function openProjectFile(page, ctx, fileName, readySelector) {
  if (!fileName) return { unavailable: "no file configured" };
  await ensureSidebar(page, true);
  const entry = page.locator('#session-sidebar [title$="/' + fileName + '"]').first();
  if (!(await entry.count())) {
    const viewFiles = page.getByTitle("View files", { exact: true });
    if (await viewFiles.count()) await viewFiles.first().click().catch(() => {});
  }
  try {
    await entry.waitFor({ timeout: 20000 });
  } catch {
    return { unavailable: "project file " + fileName + " not listed" };
  }
  await entry.click();
  if (readySelector) await page.locator(readySelector).first().waitFor({ timeout: 30000 });
  else await page.locator("#file-panel .file-viewer-status-bar").waitFor({ timeout: 30000 });
}

/** Block until the shell stops moving (fonts, scroll, virtualised item count). */
async function stabilize(page, ctx) {
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.evaluate((css) => {
    if (document.getElementById("kit-parity-no-motion")) return;
    const style = document.createElement("style");
    style.id = "kit-parity-no-motion";
    style.textContent = css;
    document.head.appendChild(style);
  }, NO_MOTION_CSS);
  await page.evaluate(async () => {
    const read = () => [
      document.querySelector(".chat-scroll-fade")?.scrollTop ?? 0,
      document.querySelector(".chat-scroll-fade")?.scrollHeight ?? 0,
      document.querySelector(".virtualized-message-list")?.children.length ?? 0,
      document.querySelector("#session-sidebar")?.className ?? "",
      (() => {
        // Async panels (theme grid) and file previews settle after first paint.
        const panel = Array.from(document.querySelectorAll(".settings-modal-page > div"))
          .find((candidate) => candidate.getClientRects().length > 0);
        return panel ? panel.scrollHeight + ":" + panel.querySelectorAll("*").length : "-";
      })(),
      document.querySelector("#file-panel")?.className ?? "",
      // The reasoning control resolves its level from a session/state fetch.
      document.querySelector(".chat-input-toolbar-thinking button")?.getAttribute("title") ?? "-",
    ].join("|");
    let last = read();
    let stable = 0;
    for (let index = 0; index < 40 && stable < 4; index++) {
      await new Promise((done) => setTimeout(done, 120));
      const now = read();
      if (now === last) stable += 1;
      else {
        stable = 0;
        last = now;
      }
    }
    return last;
  });
  await delay(ctx.settleMs);
}

// ─── Capture: in-page collector ──────────────────────────────────────────────

/**
 * Text normaliser. Its source is serialised into the page so the browser and
 * Node apply byte-identical rules to text nodes and path-bearing attributes.
 */
function normalizeTextInPage(value, rootPath) {
  let text = String(value ?? "");
  if (rootPath) text = text.split(rootPath).join("<ROOT>");
  text = text.replace(/(?:\/private)?\/var\/folders\/[^\s"'<>]+/g, "<TMPDIR>");
  text = text.replace(/(?:\/private)?\/tmp\/[^\s"'<>]+/g, "<TMPDIR>");
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>");
  text = text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<TIMESTAMP>");
  text = text.replace(/\bv?\s?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\b/g, "<VERSION>");
  text = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<CLOCK>");
  text = text.replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|m|h|d)\b/g, "<DURATION>");
  text = text.replace(/\b(?:just now|a moment ago|yesterday|today|\d+\s+(?:second|minute|hour|day)s?\s+ago|in\s+\d+\s+(?:second|minute|hour|day)s?)\b/gi, "<RELATIVE>");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Runs in the browser. Returns one record per part: normalised HTML, the fixed
 * computed-style subset, and a 0.5px-rounded bounding box.
 */
function collectPartsInPage(payload) {
  const { parts, styleProperties, htmlLimit, textLimit, rootPath, normalizeTextSource } = payload;

  // Compact FNV-1a: the full normalised string is hashed in-page, so only the
  // truncated excerpt travels back to Node while drift is still detected.
  const hash = (value) => {
    let result = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
      result ^= value.charCodeAt(index);
      result = (result + ((result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24))) >>> 0;
    }
    return result.toString(16).padStart(8, "0") + ":" + value.length.toString(16);
  };

  const normalizeText = new Function("value", "rootPath", "return (" + normalizeTextSource + ")(value, rootPath)");
  const round = (value) => Math.round(value * 2) / 2;
  const isVisible = (element) => {
    if (typeof element.getClientRects !== "function" || element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const ID_LIKE = /^[a-z][a-z0-9-]{0,40}$/i;
  const VOLATILE_ATTRIBUTES = new Set(["aria-controls", "aria-labelledby", "aria-describedby", "for", "aria-owns"]);
  const normalizeValue = (value) => normalizeText(value, rootPath);

  const cloneNormalized = (element, replacements) => {
    const clone = element.cloneNode(true);
    const source = [element];
    const target = [clone];
    while (source.length) {
      const from = source.pop();
      const to = target.pop();
      for (const name of Array.from(to.getAttributeNames())) {
        if (VOLATILE_ATTRIBUTES.has(name)) {
          to.setAttribute(name, "<ID>");
          continue;
        }
        if (name === "id") {
          const value = to.getAttribute(name) ?? "";
          to.setAttribute(name, ID_LIKE.test(value) ? value : "<ID>");
          continue;
        }
        if (name === "style" || name === "class") continue;
        if (name.startsWith("data-") || name === "title" || name === "href" || name === "src"
          || name === "aria-label" || name === "placeholder") {
          to.setAttribute(name, normalizeValue(to.getAttribute(name) ?? ""));
        }
      }
      for (let index = 0; index < from.childNodes.length; index++) {
        const childFrom = from.childNodes[index];
        const childTo = to.childNodes[index];
        if (!childTo) continue;
        if (childFrom.nodeType === 3) {
          childTo.textContent = normalizeText(childFrom.textContent ?? "", rootPath);
        } else if (childFrom.nodeType === 1) {
          source.push(childFrom);
          target.push(childTo);
        }
      }
    }
    let html = clone.outerHTML.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
    for (const [pattern, replacement] of replacements ?? []) {
      html = html.replace(new RegExp(pattern, "g"), replacement);
    }
    return html;
  };

  const resolve = (spec) => {
    const steps = spec.path ?? [spec.selector];
    let scope = [document];
    for (let step = 0; step < steps.length; step++) {
      // A leading combinator is a relative selector; anchor it at ":scope".
      const raw = steps[step];
      const selector = raw.startsWith(">") ? ":scope " + raw : raw;
      const next = [];
      for (const element of scope) {
        let found;
        try {
          found = Array.from(element.querySelectorAll(selector));
        } catch {
          found = [];
        }
        for (const candidate of found) {
          if (step === 0 && spec.visibleOnly !== false && !isVisible(candidate)) continue;
          next.push(candidate);
        }
      }
      scope = next;
      if (!scope.length) return [];
    }
    if (spec.visibleOnly !== false) scope = scope.filter(isVisible);
    return scope;
  };

  const records = {};
  for (const spec of parts) {
    const matches = resolve(spec);
    const matchCount = matches.length;
    if (!matchCount) {
      records[spec.name] = { found: false, matchCount: 0 };
      continue;
    }
    const index = spec.index === undefined ? 0 : (spec.index < 0 ? matchCount + spec.index : spec.index);
    const selected = spec.all ? matches : [matches[index]].filter(Boolean);
    if (!selected.length) {
      records[spec.name] = { found: false, matchCount };
      continue;
    }
    const element = selected[0];
    const record = { found: true, matchCount };
    if (spec.style !== false) {
      const computed = getComputedStyle(element);
      const style = {};
      for (const property of styleProperties) style[property] = computed.getPropertyValue(property);
      record.style = style;
    }
    if (spec.rect !== false) {
      const rect = element.getBoundingClientRect();
      record.rect = [round(rect.x), round(rect.y), round(rect.width), round(rect.height)];
    }
    if (spec.childCount) record.childCount = element.children.length;
    if (spec.text) record.text = normalizeText(element.innerText ?? "", rootPath).slice(0, textLimit);
    if (spec.html !== false) {
      const html = cloneNormalized(element, spec.replacements);
      const limit = spec.htmlLimit ?? htmlLimit;
      record.html = {
        text: html.slice(0, limit),
        length: html.length,
        hash: hash(html),
        truncated: html.length > limit,
      };
    }
    records[spec.name] = record;
  }
  return records;
}

// ─── Capture: options ────────────────────────────────────────────────────────

function normalizeOptions(options = {}) {
  const surfaces = options.surfaces?.length
    ? KIT_PARITY_SURFACES.filter((surface) => options.surfaces.includes(surface.name))
    : KIT_PARITY_SURFACES;
  return {
    baseUrl: (options.baseUrl ?? "http://127.0.0.1:3000").replace(/\/+$/, ""),
    viewports: options.viewports ?? KIT_PARITY_VIEWPORTS,
    surfaces,
    sessions: { ...KIT_PARITY_SESSIONS, ...(options.sessions ?? {}) },
    files: { ...KIT_PARITY_FILES, ...(options.files ?? {}) },
    rootPath: options.rootPath ?? repoRoot(),
    settleMs: options.settleMs ?? 500,
    htmlLimit: options.htmlLimit ?? 4000,
    textLimit: options.textLimit ?? 300,
    styleProperties: options.styleProperties ?? KIT_PARITY_STYLE_PROPERTIES,
  };
}

function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Capture every surface at every viewport.
 *
 * @param {import("playwright").Page} page
 * @param {{ baseUrl?: string, viewports?: object[], surfaces?: string[],
 *           sessions?: Record<string, string|null>, files?: Record<string, string>,
 *           htmlLimit?: number, settleMs?: number, rootPath?: string }} [options]
 */
export async function captureFingerprints(page, options = {}) {
  const ctx = normalizeOptions(options);
  const fingerprint = {
    version: KIT_PARITY_VERSION,
    kit: "pi",
    viewports: ctx.viewports.map((viewport) => ({ name: viewport.name, width: viewport.width, height: viewport.height })),
    surfaces: {},
    unavailable: {},
  };

  // One page per surface: a renderer that dies on a heavy surface (observed
  // after opening the file panel over the 5000-message fixture) must not take
  // the remaining surfaces down with it, and no state can leak between them.
  const browser = page.context().browser();
  const owned = [];
  let context = page.context();
  let active = page;

  async function renew(reason) {
    if (!browser || !browser.isConnected()) throw new Error("browser disconnected: " + reason);
    const fresh = await openKitContext(browser, ctx.viewports.at(-1));
    owned.push(fresh.context);
    context = fresh.context;
    active = fresh.page;
  }

  async function surfacePage(viewport) {
    if (active.isClosed() || context.isClosed?.()) await renew("page closed");
    const fresh = await context.newPage();
    fresh.setDefaultTimeout(30000);
    fresh.setDefaultNavigationTimeout(60000);
    fresh.on("crash", () => console.error("kit-parity: renderer crashed"));
    await fresh.setViewportSize({ width: viewport.width, height: viewport.height });
    return fresh;
  }

  try {
    for (const viewport of ctx.viewports) {
      for (const surface of ctx.surfaces) {
        const key = viewport.name + "|" + surface.name;
        let workPage = null;
        try {
          workPage = await surfacePage(viewport);
          const outcome = await withTimeout(surface.prepare(workPage, ctx), 90000, key + " prepare");
          if (outcome?.unavailable) {
            fingerprint.unavailable[key] = { viewport: viewport.name, surface: surface.name, reason: outcome.unavailable };
            continue;
          }
          await withTimeout(stabilize(workPage, ctx), 40000, key + " stabilize");
          const parts = await withTimeout(workPage.evaluate(collectPartsInPage, {
            parts: surface.parts,
            styleProperties: ctx.styleProperties,
            htmlLimit: ctx.htmlLimit,
            textLimit: ctx.textLimit,
            rootPath: ctx.rootPath,
            normalizeTextSource: String(normalizeTextInPage),
          }), 60000, key + " collect");
          fingerprint.surfaces[key] = {
            viewport: viewport.name,
            surface: surface.name,
            size: { width: viewport.width, height: viewport.height },
            parts,
          };
          if (process.env.KIT_PARITY_VERBOSE) console.log("  captured " + key);
        } catch (error) {
          fingerprint.unavailable[key] = {
            viewport: viewport.name,
            surface: surface.name,
            reason: String(error?.message ?? error).split("\n")[0].slice(0, 300),
          };
        } finally {
          if (workPage) await workPage.close().catch(() => {});
        }
      }
    }
  } finally {
    for (const extra of owned) await extra.close().catch(() => {});
  }
  return fingerprint;
}

// ─── Compare ─────────────────────────────────────────────────────────────────

function pushDiff(diffs, entry, maxDiffs) {
  if (diffs.length >= maxDiffs) return;
  diffs.push(entry);
}

function compareRect(diffs, base, current, key, partName, tolerance, maxDiffs) {
  const expected = base.rect;
  const actual = current.rect;
  if (!expected && !actual) return;
  if (!expected || !actual) {
    pushDiff(diffs, { key, part: partName, path: "rect", expected: expected ?? null, actual: actual ?? null, kind: "presence" }, maxDiffs);
    return;
  }
  const labels = ["x", "y", "width", "height"];
  for (let index = 0; index < 4; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (delta > tolerance) {
      pushDiff(diffs, {
        key,
        part: partName,
        path: "rect." + labels[index],
        expected: expected[index],
        actual: actual[index],
        delta: Math.round(delta * 100) / 100,
        kind: "geometry",
      }, maxDiffs);
    }
  }
}

function comparePart(diffs, key, base, current, partName, settings) {
  if (!base && !current) return;
  if (!base || !current) {
    pushDiff(diffs, {
      key, part: partName, path: "part",
      expected: base ? "present" : "absent",
      actual: current ? "present" : "absent",
      kind: "presence",
    }, settings.maxDiffs);
    return;
  }
  if (Boolean(base.found) !== Boolean(current.found)) {
    pushDiff(diffs, { key, part: partName, path: "found", expected: base.found, actual: current.found, kind: "presence" }, settings.maxDiffs);
    return;
  }
  if (!base.found) return;
  if (settings.compareStructure && base.matchCount !== current.matchCount) {
    pushDiff(diffs, { key, part: partName, path: "matchCount", expected: base.matchCount, actual: current.matchCount, kind: "presence" }, settings.maxDiffs);
  }
  if (base.childCount !== current.childCount) {
    pushDiff(diffs, { key, part: partName, path: "childCount", expected: base.childCount ?? null, actual: current.childCount ?? null, kind: "structure" }, settings.maxDiffs);
  }
  if (settings.compareText && base.text !== current.text) {
    pushDiff(diffs, { key, part: partName, path: "text", expected: base.text ?? null, actual: current.text ?? null, kind: "text" }, settings.maxDiffs);
  }
  if (base.style || current.style) {
    const properties = new Set([...Object.keys(base.style ?? {}), ...Object.keys(current.style ?? {})]);
    for (const property of properties) {
      const expected = base.style?.[property] ?? null;
      const actual = current.style?.[property] ?? null;
      if (expected !== actual) {
        pushDiff(diffs, { key, part: partName, path: "style." + property, expected, actual, kind: "style" }, settings.maxDiffs);
      }
    }
  }
  compareRect(diffs, base, current, key, partName, settings.geometryTolerance, settings.maxDiffs);
  if (settings.compareHtml && (base.html || current.html)) {
    const expectedHash = base.html?.hash ?? null;
    const actualHash = current.html?.hash ?? null;
    if (expectedHash !== actualHash) {
      const bothTruncated = Boolean(base.html?.truncated) && Boolean(current.html?.truncated);
      const expectedText = base.html?.text ?? "";
      const actualText = current.html?.text ?? "";
      let at = 0;
      while (at < expectedText.length && at < actualText.length && expectedText[at] === actualText[at]) at += 1;
      pushDiff(diffs, {
        key,
        part: partName,
        path: bothTruncated ? "html.hash" : "html",
        expected: expectedText,
        actual: actualText,
        kind: "html",
        at,
        expectedSnippet: expectedText.slice(Math.max(0, at - 100), at + 160),
        actualSnippet: actualText.slice(Math.max(0, at - 100), at + 160),
      }, settings.maxDiffs);
    }
  }
}

/**
 * Compare a captured fingerprint against a baseline.
 *
 * Geometry uses a tolerance (default 1px); styles and normalised HTML compare
 * exactly. Surfaces the current capture could not produce are reported under
 * "unavailable" instead of as diffs, so a harness that seeds fewer fixtures
 * stays usable.
 *
 * @param {object} baseline
 * @param {object} current
 * @param {{ geometryTolerance?: number, maxDiffs?: number, skipFixtureSensitive?: boolean }} [options]
 */
export function compareFingerprints(baseline, current, options = {}) {
  const settings = {
    geometryTolerance: options.geometryTolerance ?? 1,
    maxDiffs: options.maxDiffs ?? 300,
    skipFixtureSensitive: options.skipFixtureSensitive ?? false,
    compareHtml: true,
    compareText: true,
    compareStructure: true,
  };
  const diffs = [];
  const unavailable = [];
  const added = [];
  const fixtureSensitiveParts = new Set();
  for (const surface of KIT_PARITY_SURFACES) {
    for (const spec of surface.parts) if (spec.fixtureSensitive) fixtureSensitiveParts.add(surface.name + "|" + spec.name);
  }

  const baselineSurfaces = baseline?.surfaces ?? {};
  const currentSurfaces = current?.surfaces ?? {};
  let comparedSurfaces = 0;
  let comparedParts = 0;

  for (const [key, expected] of Object.entries(baselineSurfaces)) {
    const actual = currentSurfaces[key];
    if (!actual) {
      unavailable.push({
        key,
        surface: expected.surface,
        viewport: expected.viewport,
        reason: current?.unavailable?.[key]?.reason ?? "not captured",
      });
      continue;
    }
    comparedSurfaces += 1;
    const partNames = new Set([...Object.keys(expected.parts ?? {}), ...Object.keys(actual.parts ?? {})]);
    for (const partName of [...partNames].sort()) {
      const basePart = expected.parts?.[partName];
      const currentPart = actual.parts?.[partName];
      // Fixture text lives in these parts; keep geometry and styles only.
      const fixtureSensitive = settings.skipFixtureSensitive
        && fixtureSensitiveParts.has(expected.surface + "|" + partName);
      comparePart(diffs, key, basePart, currentPart, partName, fixtureSensitive
        ? { ...settings, compareHtml: false, compareText: false, compareStructure: false }
        : settings);
      comparedParts += 1;
    }
  }
  for (const key of Object.keys(currentSurfaces)) if (!baselineSurfaces[key]) added.push(key);

  return {
    ok: diffs.length === 0,
    diffs,
    unavailable,
    added,
    truncated: diffs.length >= settings.maxDiffs,
    stats: {
      baselineSurfaces: Object.keys(baselineSurfaces).length,
      comparedSurfaces,
      comparedParts,
      diffCount: diffs.length,
      unavailableCount: unavailable.length,
      addedCount: added.length,
    },
  };
}

function formatDiff(diff) {
  const where = diff.key + " · " + diff.part + " · " + diff.path;
  if (diff.kind === "geometry") return where + ": " + diff.expected + " -> " + diff.actual + " (Δ" + diff.delta + "px)";
  if (diff.kind === "html") {
    const size = String(diff.expected?.length ?? diff.expected ?? "").length + " -> " + String(diff.actual?.length ?? diff.actual ?? "").length;
    const context = diff.at === undefined ? ""
      : "\n      at char " + diff.at + "\n      baseline: …" + (diff.expectedSnippet ?? "").replace(/\s+/g, " ") + "…"
        + "\n      current : …" + (diff.actualSnippet ?? "").replace(/\s+/g, " ") + "…";
    return where + ": markup changed (" + size + " chars)" + context;
  }
  return where + ": " + JSON.stringify(diff.expected) + " -> " + JSON.stringify(diff.actual);
}

// ─── Kit context ─────────────────────────────────────────────────────────────

/** A browser context with every render-affecting preference pinned. */
async function openKitContext(browser, viewport = KIT_PARITY_VIEWPORTS.at(-1)) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: "en-US",
  });
  await context.addInitScript(({ storage, removed }) => {
    try {
      // Start every navigation from the same persisted state: unknown app
      // preferences (open file tabs, panel widths, view mode) are dropped before
      // the bundle reads them.
      for (const key of Object.keys(localStorage)) {
        if ((key.startsWith("pi-") || key.startsWith("pi-web:")) && !Object.hasOwn(storage, key)) {
          localStorage.removeItem(key);
        }
      }
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      for (const key of removed) localStorage.removeItem(key);
    } catch {
      /* storage is unavailable before the first navigation */
    }
  }, { storage: KIT_PARITY_STORAGE, removed: KIT_PARITY_STORAGE_REMOVED });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  return { context, page };
}

/**
 * Parity gate for e2e/run.mjs.
 *
 * Skips (never fails) while no baseline exists, so landing this cannot break a
 * suite that has not captured one yet. Once the baseline is captured, a surface
 * that drifted fails the run with the first concrete differences.
 *
 * @param {import("playwright").Page} page a page from the suite's browser
 * @param {{ baselinePath?: string, baseUrl?: string, sessions?: Record<string, string|null>,
 *           files?: Record<string, string>, surfaces?: string[], fixtureSensitive?: boolean }} [options]
 */
export async function checkKitParity(page, options = {}) {
  const baselinePath = resolve(options.baselinePath ?? join(repoRoot(), KIT_PARITY_BASELINE));
  if (!existsSync(baselinePath)) {
    console.log("SKIP: pi kit parity baseline missing (" + baselinePath + ")");
    return { skipped: true, reason: "missing-baseline" };
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const browser = page?.context?.().browser?.();
  if (!browser) throw new Error("checkKitParity needs a page from a real chromium browser");

  const baseUrl = options.baseUrl ?? new URL(page.url()).origin;
  const viewports = (baseline.viewports ?? KIT_PARITY_VIEWPORTS).map((viewport) => ({
    name: viewport.name,
    width: viewport.width,
    height: viewport.height,
  }));

  const { context, page: kitPage } = await openKitContext(browser, viewports[0]);
  let current;
  try {
    current = await captureFingerprints(kitPage, {
      baseUrl,
      viewports,
      sessions: options.sessions ?? { subagent: null },
      files: options.files ?? {},
      surfaces: options.surfaces,
    });
  } finally {
    await context.close().catch(() => {});
  }

  const result = compareFingerprints(baseline, current, {
    geometryTolerance: 1,
    skipFixtureSensitive: options.fixtureSensitive === false,
  });
  const summary = result.stats.comparedSurfaces + "/" + result.stats.baselineSurfaces
    + " surfaces, " + result.stats.comparedParts + " parts, " + result.stats.diffCount + " diffs";
  if (result.unavailable.length) {
    console.log("pi kit parity: skipped " + result.unavailable.length + " surface(s) not produced by this run: "
      + result.unavailable.map((entry) => entry.key).join(", "));
  }
  if (result.ok) {
    console.log("PASS: pi kit parity (" + summary + ")");
    return result;
  }
  const shown = result.diffs.slice(0, 12).map((diff) => "  " + formatDiff(diff)).join("\n");
  assert.fail("pi kit parity drift (" + summary + "):\n" + shown
    + (result.diffs.length > 12 ? "\n  … " + (result.diffs.length - 12) + " more" : ""));
}

// ─── CLI: fixtures + capture/check ───────────────────────────────────────────

/** Session fixtures, byte-identical to e2e/run.mjs so both harnesses agree. */
export function kitParityFixtures() {
  const timestamp = "2026-08-23T00:00:00.000Z";
  const text = (index) => "E2E message " + String(index).padStart(4, "0");
  const message = (id, parentId, role, content) => ({ type: "message", id, parentId, timestamp, message: { role, content } });
  const sessions = new Map();

  const longEntries = Array.from({ length: 5000 }, (_, index) =>
    message("e" + index, index ? "e" + (index - 1) : null, index % 2 ? "assistant" : "user", text(index)));
  longEntries.splice(1, 0, message("alternate", "e0", "user", "E2E alternate history branch"));
  sessions.set(KIT_PARITY_SESSIONS.long, longEntries);

  sessions.set("e2e-branch-session", [
    message("root", null, "user", "Branch root"),
    message("old", "root", "assistant", "Inactive branch answer"),
    message("new", "root", "assistant", "Active branch answer"),
  ]);

  const toolResult = message("result", "call", "toolResult", [{ type: "text", text: "E2E tool output" }]);
  Object.assign(toolResult.message, { toolCallId: "t1", toolName: "bash", isError: false });
  const richEntries = [
    message("user", null, "user", "Render **E2E markdown**"),
    message("call", "user", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E intermediate reasoning\nIntermediate thinking details." },
      { type: "text", text: "E2E process paragraph.\n\n".repeat(20) },
      { type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo E2E tool output" } },
    ]),
    toolResult,
    message("answer", "result", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E follow-up reasoning\nFollow-up thinking details." },
      { type: "text", text: "E2E process note" },
      { type: "thinking", thinking: "E2E final reasoning\nFinal thinking details." },
      { type: "text", text: "E2E final answer\n" + FENCE + "js\nconsole.log('E2E code');\n" + FENCE + "\n\n"
        + "E2E answer paragraph.\n\n".repeat(20)
        + "## E2E reading position\n\n"
        + "E2E answer paragraph.\n\n".repeat(20) },
    ]),
  ];
  Object.assign(richEntries.at(-1).message, { provider: "test", model: "E2E Model" });
  sessions.set(KIT_PARITY_SESSIONS.rich, richEntries);

  const compactedEntries = [
    message("user", null, "user", "E2E prompt outside the compacted page"),
    { type: "compaction", id: "compact", parentId: "user", timestamp, summary: "E2E compaction anchor", firstKeptEntryId: "user", tokensBefore: 100 },
  ];
  for (let index = 0; index < 48; index++) {
    compactedEntries.push(message("call" + index, compactedEntries.at(-1).id, "assistant", [
      { type: "toolCall", id: "t" + index, name: "bash", arguments: { command: "echo step" + index } },
    ]));
    const result = message("result" + index, "call" + index, "toolResult", [{ type: "text", text: "step" + index }]);
    Object.assign(result.message, { toolCallId: "t" + index, toolName: "bash", isError: false });
    compactedEntries.push(result);
  }
  compactedEntries.push(message("answer", "result47", "assistant", [{ type: "text", text:
    "E2E compacted answer paragraph.\n\n".repeat(20)
    + "## E2E compacted heading\n\n"
    + "E2E compacted answer paragraph.\n\n".repeat(20) }]));
  sessions.set("e2e-compacted-session", compactedEntries);

  sessions.set("e2e-external-append-session", [
    message("root", null, "user", "E2E wrapper root"),
    message("reply", "root", "assistant", "E2E wrapper reply"),
  ]);

  // The only kit-parity-only fixture: a completed subagent run. It is seeded in
  // its own file, so its sidebar row is the one thing a different harness
  // (e2e/run.mjs) cannot reproduce — hence the fixtureSensitive sidebar parts.
  const subagentResult = message("subagent-result", "subagent-call", "toolResult", [{ type: "text", text: "E2E subagent report" }]);
  Object.assign(subagentResult.message, {
    toolCallId: "t9",
    toolName: "Agent",
    isError: false,
    details: {
      kind: "pi-web-subagent",
      sessionId: "e2e-kit-subagent-run",
      profile: "general-purpose",
      description: "E2E subagent run",
      status: "completed",
      runInBackground: false,
      createdAt: timestamp,
      completedAt: "2026-08-23T00:00:42.000Z",
    },
  });
  sessions.set(KIT_PARITY_SESSIONS.subagent, [
    message("prompt", null, "user", "E2E subagent turn"),
    message("subagent-call", "prompt", "assistant", [
      { type: "toolCall", id: "t9", name: "Agent", arguments: { subagent_type: "general-purpose", description: "E2E subagent run", prompt: "Do E2E subagent work" } },
    ]),
    subagentResult,
    message("subagent-answer", "subagent-result", "assistant", [{ type: "text", text: "E2E subagent turn answer" }]),
  ]);
  return sessions;
}

/** Seed an isolated agent dir + project, mirroring e2e/run.mjs. */
export function seedKitParityFixtures(agentDir) {
  const project = join(agentDir, "project");
  const sessionDir = join(agentDir, "sessions", "e2e");
  mkdirSync(project, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(join(project, KIT_PARITY_FILES.html), filePanelFixture);
  writeFileSync(join(project, KIT_PARITY_FILES.markdown),
    "# E2E markdown preview\n\nMarkdown preview body text.\n\n- item one\n- item two\n");
  const timestamp = "2026-08-23T00:00:00.000Z";
  for (const [id, entries] of kitParityFixtures()) {
    const header = { type: "session", version: 3, id, timestamp, cwd: project };
    writeFileSync(join(sessionDir, "2026-08-23T00-00-00-000Z_" + id + ".jsonl"),
      [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  }
  return { project, sessionDir };
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((done, fail) => probe.close((error) => (error ? fail(error) : done())));
  return port;
}

/** Spawn a dev server with the kit fixtures; resolves once every session is listed. */
async function startFixtureServer(root, logPath) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-parity-"));
  seedKitParityFixtures(agentDir);
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const log = createWriteStream(logPath, { flags: "a" });
  const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  const expected = new Set(kitParityFixtures().keys());
  const deadline = Date.now() + 240000;
  for (;;) {
    if (server.exitCode !== null) throw new Error("dev server exited; see " + logPath);
    const response = await fetch(baseUrl + "/api/sessions", { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      if ([...expected].every((id) => sessions.some((session) => session.id === id))) break;
    }
    if (Date.now() > deadline) throw new Error("dev server readiness timed out; see " + logPath);
    await delay(300);
  }
  // Warm the first Turbopack compile so surface waits are not compile waits.
  await fetch(baseUrl, { signal: AbortSignal.timeout(300000) }).catch(() => {});
  return {
    agentDir,
    baseUrl,
    logPath,
    async stop() {
      server.kill("SIGTERM");
      const force = setTimeout(() => server.kill("SIGKILL"), 10000);
      await once(server, "exit").catch(() => {});
      clearTimeout(force);
      log.end();
      rmSync(agentDir, { recursive: true, force: true });
    },
  };
}

function parseArgs(argv) {
  const options = { mode: null, root: repoRoot(), baseline: null, out: null, reuse: null, only: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--capture" || arg === "--check") options.mode = arg.slice(2);
    else if (arg === "--root") options.root = resolve(argv[++index]);
    else if (arg === "--baseline") options.baseline = resolve(argv[++index]);
    else if (arg === "--out") options.out = resolve(argv[++index]);
    else if (arg === "--reuse") options.reuse = argv[++index].replace(/\/+$/, "");
    else if (arg === "--only") options.only = argv[++index].split(",").map((name) => name.trim()).filter(Boolean);
    else if (arg === "--help" || arg === "-h") options.mode = "help";
    else throw new Error("unknown argument: " + arg);
  }
  return options;
}

function readHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.mode || options.mode === "help") {
    console.log([
      "pi kit parity — structural + style + geometry fingerprint baseline",
      "",
      "  node e2e/kit-parity.mjs --capture [--root DIR] [--out FILE] [--only surface,...]",
      "  node e2e/kit-parity.mjs --check   [--root DIR] [--baseline FILE] [--only surface,...]",
      "  node e2e/kit-parity.mjs --capture --reuse http://127.0.0.1:PORT",
      "",
      "surfaces: " + KIT_PARITY_SURFACES.map((surface) => surface.name).join(", "),
      "viewports: " + KIT_PARITY_VIEWPORTS.map((viewport) => viewport.name).join(", "),
    ].join("\n"));
    return 0;
  }

  const baselinePath = options.baseline ?? join(options.root, KIT_PARITY_BASELINE);
  const outPath = options.out ?? baselinePath;
  const logPath = join(options.root, "test-results/kit-parity/server.log");
  mkdirSync(dirname(logPath), { recursive: true });

  let server = null;
  if (!options.reuse) server = await startFixtureServer(options.root, logPath);
  const baseUrl = options.reuse ?? server.baseUrl;
  if (server) console.log("server " + baseUrl + " (log " + logPath + ")");

  const browser = await chromium.launch();
  let fingerprint;
  try {
    const { context, page } = await openKitContext(browser);
    try {
      fingerprint = await captureFingerprints(page, {
        baseUrl,
        surfaces: options.only,
        rootPath: options.root,
      });
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    await server?.stop();
  }

  const surfaceKeys = Object.keys(fingerprint.surfaces);
  const unavailableKeys = Object.keys(fingerprint.unavailable);
  const partCount = surfaceKeys.reduce((total, key) => total + Object.keys(fingerprint.surfaces[key].parts).length, 0);
  console.log("captured " + surfaceKeys.length + " surface snapshots / " + partCount + " part records across "
    + fingerprint.viewports.length + " viewports");
  if (unavailableKeys.length) {
    console.log("unavailable: " + unavailableKeys.map((key) => key + " (" + fingerprint.unavailable[key].reason + ")").join("; "));
  }

  if (options.mode === "capture") {
    fingerprint.capturedFrom = {
      root: options.root,
      head: readHead(options.root),
      baseUrl,
      capturedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(fingerprint, null, 1) + "\n");
    const bytes = readFileSync(outPath).length;
    console.log("wrote " + outPath + " (" + (bytes / 1024).toFixed(1) + " KiB)");
    return 0;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const result = compareFingerprints(baseline, fingerprint, { geometryTolerance: 1 });
  console.log("baseline " + baselinePath);
  console.log("compared " + result.stats.comparedSurfaces + "/" + result.stats.baselineSurfaces
    + " surfaces, " + result.stats.comparedParts + " parts");
  if (result.unavailable.length) console.log("unavailable: " + result.unavailable.map((entry) => entry.key).join(", "));
  if (result.added.length) console.log("new surfaces (not in baseline): " + result.added.join(", "));
  if (result.ok) {
    console.log("PASS: pi kit parity — 0 diffs");
    return 0;
  }
  console.log("FAIL: " + result.diffs.length + " diff(s)" + (result.truncated ? " (truncated)" : ""));
  for (const diff of result.diffs.slice(0, 40)) console.log("  " + formatDiff(diff));
  return 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
