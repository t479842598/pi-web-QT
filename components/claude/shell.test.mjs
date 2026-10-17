import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

/**
 * W4 — shell slots.
 *
 * Seven files, one contract each. The assertions here are structural: they
 * pin the prop surface the registry binds to, the CDS-only colour rule, and the
 * one accessible name that must survive the reskin (the sidebar collapse
 * control). Behaviour lives in the pi components these wrap, so there is
 * nothing to re-test at this level.
 */

const DIR = new URL("./shell/", import.meta.url);

const SHELL_FILES = [
  "ClaudeTitleBar.tsx",
  "ClaudeSidebar.tsx",
  "ClaudeSessionRow.tsx",
  "ClaudeTabBar.tsx",
  "ClaudeComposerChrome.tsx",
  "ClaudeModelSwitcher.tsx",
  "ClaudeFileViewer.tsx",
];

const sources = Object.fromEntries(
  await Promise.all(SHELL_FILES.map(async (file) => [file, await readFile(new URL(file, DIR), "utf8")])),
);

/** Raw hex colours, rgb()/rgba() literals and framer-motion tags are all banned. */
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBA = /rgba?\(/;
const MOTION_TAG = /\bmotion\./;
const INLINE_FONT_SIZE = /fontSize\s*:/;

test("the shell slot directory holds exactly the seven declared components", async () => {
  const entries = await readdir(DIR);
  const tsx = entries.filter((name) => name.endsWith(".tsx")).sort();
  assert.deepEqual(tsx, [...SHELL_FILES].sort());
  for (const file of SHELL_FILES) assert.ok(sources[file].length > 0, file);
});

test("shell components use design tokens only", () => {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, RGBA, file + ": rgba() literal");
    assert.doesNotMatch(source, MOTION_TAG, file + ": framer-motion under LazyMotion strict");
    assert.doesNotMatch(source, INLINE_FONT_SIZE, file + ": inline fontSize");
    // Hex colours are banned, but a unicode escape (\\u2715 for the close glyph)
    // is not a colour; strip those before looking.
    assert.doesNotMatch(source.replace(/\\u[0-9a-fA-F]{4}/g, ""), RAW_HEX, file + ": raw hex colour");
  }
});

test("sidebar keeps the pi collapse labels and the placement switch", () => {
  const source = sources["ClaudeSidebar.tsx"];
  // Verbatim pi strings: a shell may look different, it may not read differently.
  assert.match(source, /desktop\.hideSidebar/);
  assert.match(source, /desktop\.showSidebar/);
  assert.match(source, /aria-label=\{collapseLabel\}/);
  assert.match(source, /useSidebarTogglePlacement\(\)/);
  assert.match(source, /placement === "sidebar"/);
  // The tree itself is pi's, never a copy.
  assert.match(source, /<SessionSidebar \{\.\.\.piProps\}/);
});

test("composer chrome exposes the four slots plus the overflow target", () => {
  const source = sources["ClaudeComposerChrome.tsx"];
  for (const slot of ["leading", "editor", "trailing", "footer"]) {
    assert.match(source, new RegExp(slot + "\\??: ReactNode"), "slot prop: " + slot);
  }
  assert.match(source, /claude-composer-chin/);
  assert.match(source, /claude-composer-left/);
  assert.match(source, /claude-composer-center/);
  assert.match(source, /claude-composer-right/);
});

test("title bar forwards the drag contract instead of inventing app-region", () => {
  const source = sources["ClaudeTitleBar.tsx"];
  assert.match(source, /desktopChrome\?\.dragRegionProps/);
  assert.match(source, /\{\.\.\.windowDrag\}/);
  assert.match(source, /app-no-drag/);
  assert.doesNotMatch(source, /app-region\s*:/);
});

test("wrapped pi components are rendered, never reimplemented", () => {
  assert.match(sources["ClaudeFileViewer.tsx"], /<FileViewer \{\.\.\.props\} \/>/);
  assert.match(sources["ClaudeTabBar.tsx"], /ComponentProps<typeof TabBar>/);
  assert.match(sources["ClaudeModelSwitcher.tsx"], /ComponentProps<typeof ModelSelector>/);
  assert.match(sources["ClaudeTitleBar.tsx"], /ComponentProps<typeof AppTitleBar>/);
  assert.match(sources["ClaudeSessionRow.tsx"], /SessionRowSlotProps/);
});
