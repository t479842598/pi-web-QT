import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Settings-page pin contract — the honest version.
 *
 * The settings page always renders the Claude ladder, whatever the global kit
 * says. That is NOT implemented in React: the KitScope component and the
 * "pinned" branches in UiKitProvider had no render site, so they were dead code
 * and are deleted. What actually pins the page is CSS:
 *
 *   1. the core .settings-row / .settings-panel / .settings-segmented rules in
 *      app/settings-claude.css carry no kit prefix, and
 *   2. every --cds-* token those rules read is also declared at :root (or in the
 *      kit-independent density presets) in app/globals.css — the kit-scoped block
 *      in app/ui-kit-claude.css only refines them for surfaces that opt in.
 *
 * SETTINGS_PINNED_KIT is the single declaration of the intent. This file is the
 * lock: prefix those rules with a kit selector, or move a token into the kit-only
 * block, and it fails.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, ROOT), "utf8");

const SETTINGS_CSS = read("app/settings-claude.css");
const GLOBALS_CSS = read("app/globals.css");
const UI_KIT_MODEL = read("lib/ui-kit.ts");

const KIT_PREFIX = /data-ui-kit|claude-surface-root/;

/** Leaf rule blocks; at-rule preludes are skipped, comments are stripped. */
function blocks(source) {
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const stack = [];
  let buffer = "";
  let selectorStart = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (char === "{") {
      stack.push(cleaned.slice(selectorStart, i).trim());
      buffer = "";
      selectorStart = i + 1;
    } else if (char === "}") {
      const selector = stack[stack.length - 1];
      stack.pop();
      if (selector && !selector.startsWith("@")) out.push({ selector, declarations: buffer });
      buffer = "";
      selectorStart = i + 1;
    } else if (stack.length > 0) {
      buffer += char;
    }
  }
  return out;
}

const SETTINGS_BLOCKS = blocks(SETTINGS_CSS);

/** Rules whose selector is the doubled hook for `name` with no kit prefix. */
function unPinnedBlocks(name) {
  return SETTINGS_BLOCKS.filter((block) => block.selector.split(",").some((part) => {
    const trimmed = part.trim();
    return trimmed.startsWith("." + name + "." + name) && !KIT_PREFIX.test(trimmed);
  }));
}

// The declarations that make the settings page look like the Claude design.
const REQUIRED_DECLARATIONS = {
  "settings-panel": ["border-radius", "background", "overflow"],
  "settings-row": ["padding", "gap", "border"],
  "settings-segmented": ["border-radius", "background", "padding"],
};

for (const [name, properties] of Object.entries(REQUIRED_DECLARATIONS)) {
  test("." + name + " keeps its Claude ladder un-prefixed in settings-claude.css", () => {
    const pinned = unPinnedBlocks(name);
    assert.ok(pinned.length > 0, "." + name + "." + name + " needs a kit-agnostic rule");
    for (const property of properties) {
      const pattern = new RegExp("(^|[;\\s])" + property + "\\s*:", "m");
      assert.ok(pinned.some((block) => pattern.test(block.declarations)),
        "." + name + " must keep " + property + ": in an un-prefixed rule, otherwise kit=pi restyles the settings page");
    }
  });
}

function declaredTokens(blocksIn) {
  const set = new Set();
  for (const block of blocksIn) {
    for (const match of block.declarations.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) set.add(match[1]);
  }
  return set;
}

// :root, the theme blocks that share its declarations, and the kit-independent
// density presets (html[data-ui-kit-layout] is written for every kit) form the
// layer the settings page can rely on.
const ROOT_TOKENS = declaredTokens(blocks(GLOBALS_CSS).filter((block) =>
  /(^|,)\s*(:root|\[data-theme|html\.dark|html\[data-ui-kit-layout)/.test(block.selector)));

test("the density ladder the settings page reads exists outside the kit layer", () => {
  for (const token of ["--cds-gap-1", "--cds-gap-2", "--cds-gap-3",
    "--cds-control-height", "--cds-control-height-lg", "--cds-dur-fast", "--cds-scroll-fade-size"]) {
    assert.ok(ROOT_TOKENS.has(token), token + " must be declared at :root or in a layout preset");
  }
});

test("every --cds-* token the core settings rules read resolves without the kit", () => {
  const referenced = new Set();
  for (const name of Object.keys(REQUIRED_DECLARATIONS)) {
    for (const block of unPinnedBlocks(name)) {
      for (const match of block.declarations.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) referenced.add(match[1]);
    }
  }
  assert.ok(referenced.size >= 5, "expected the core rules to read the token layer, saw " + referenced.size);
  const kitOnly = [...referenced].filter((token) => token.startsWith("--cds-") && !ROOT_TOKENS.has(token));
  assert.deepEqual(kitOnly, [],
    "a --cds-* token that only exists in app/ui-kit-claude.css collapses to its fallback under kit=pi");
});

// ─── The dead React-layer mechanism must not come back ──────────────────────

/** Code only: the honest history lives in comments, so prose must not trip the lock. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the React-layer pinning mechanism is gone, not merely unused", () => {
  const provider = code(read("components/ui-kit/UiKitProvider.tsx"));
  const index = code(read("components/ui-kit/index.ts"));
  for (const source of [provider, index]) {
    assert.doesNotMatch(source, /KitScope/, "KitScope was never rendered; it must not return");
    assert.doesNotMatch(source, /\bpinned\b/, "no pinned branch may reappear in the kit layer");
  }
  assert.doesNotMatch(code(UI_KIT_MODEL), /withPinnedKit/, "withPinnedKit had exactly one test consumer");
});

test("SETTINGS_PINNED_KIT is declared once and names the layer that honours it", () => {
  const declarations = UI_KIT_MODEL.match(/export const SETTINGS_PINNED_KIT: KitId = "claude";/g) ?? [];
  assert.equal(declarations.length, 1, "exactly one declaration of the pin");
  assert.match(UI_KIT_MODEL, /settings-claude\.css/, "the pin must point at the CSS that implements it");
  assert.match(UI_KIT_MODEL, /settings-page-pinned\.test\.mjs/, "and at the test that locks it");
});

test("SETTINGS_PINNED_KIT has a live consumer, not just a comment", () => {
  // The constant used to be read only by two *_PINNED exports that nothing
  // imported. It now drives the settings-panel copy, so the note cannot drift
  // from the declared pin.
  const panel = code(read("components/UiKitConfig.tsx"));
  assert.match(panel, /import \{[^}]*SETTINGS_PINNED_KIT[^}]*\} from "@\/lib\/ui-kit"/, "imported by the panel");
  assert.match(panel, /t\("uiKit\.settingsPinned", \{\s*kit: SETTINGS_PINNED_KIT === "claude"/, "and used to render the note");
  const en = read("lib/i18n/messages/en.ts");
  assert.match(en, /"uiKit\.settingsPinned": "[^"]*\{kit\}[^"]*"/, "the copy interpolates the pinned kit");
});

