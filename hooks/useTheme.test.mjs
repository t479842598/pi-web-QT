// D11 — "default theme" has exactly one truth.
//
// Before the fix there were two encodings of "default": the constant
// `DEFAULT_THEME` and the *absence* of the `pi-theme` key (the old "Default"
// card called `setTheme("")`, which removed the key, and `app/layout.tsx`'s
// inline bootstrap then re-materialised `claude` on the next reload). Same
// pixels, different provenance — nothing pinned the two together.
//
// These tests pin it: blank input folds onto `DEFAULT_THEME` on the read path,
// the write path stores a concrete value instead of removing the key, and the
// bootstrap literal is compared against the constant so neither can move
// without failing the other.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { DEFAULT_THEME, normalizeThemeName } = await jiti.import("./useTheme.ts");

const source = await readFile(new URL("./useTheme.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("the default theme is Claude and stays a concrete, switchable value", () => {
  assert.equal(DEFAULT_THEME, "claude", "product default must not drift silently");
  assert.equal(normalizeThemeName("gruvbox"), "gruvbox", "any other theme stays selectable");
});

test("blank or absent reads as DEFAULT_THEME — the single definition of \"default\"", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.equal(normalizeThemeName(value), DEFAULT_THEME, `normalizeThemeName(${JSON.stringify(value)})`);
  }
  assert.equal(normalizeThemeName(DEFAULT_THEME), DEFAULT_THEME);
});

test("a real theme name survives normalization untouched", () => {
  for (const name of ["gruvbox", "tokyonight", "vitesse-dark", "catppuccin"]) {
    assert.equal(normalizeThemeName(name), name);
  }
});

test("the write path never removes pi-theme to mean \"default\"", () => {
  // The contract in one line: clearing == DEFAULT_THEME, so clearing must store
  // the default rather than delete the key.
  const body = source.slice(
    source.indexOf("function writeThemeForMode"),
    source.indexOf("function readMode"),
  );
  assert.ok(body.length > 0, "writeThemeForMode is still present");
  assert.ok(
    body.includes("localStorage.setItem(KEY_THEME, normalizeThemeName(name))"),
    "a blank write must store the default, not the blank",
  );
  assert.ok(!body.includes("removeItem(KEY_THEME)"), "pi-theme must not be removed to encode default");
});

test("the read path folds an absent or blank pi-theme onto DEFAULT_THEME", () => {
  const body = source.slice(
    source.indexOf("function readThemeForMode"),
    source.indexOf("/** Write the theme for a resolved mode"),
  );
  assert.ok(body.includes("normalizeThemeName(v)"), "stored value normalized on read");
  assert.ok(body.includes("return DEFAULT_THEME"), "the fallback is the constant, not a literal");
});

test("data-theme is written, never deleted, so the DOM matches the store", () => {
  const body = source.slice(source.indexOf("const syncDOM = useCallback"), source.indexOf("// On mount:"));
  assert.ok(body.includes("el.dataset.theme = normalizeThemeName(t)"), "syncDOM always sets a concrete theme");
  assert.ok(!body.includes("delete el.dataset.theme"), "no second encoding in the DOM either");
});

test("the inline bootstrap and DEFAULT_THEME agree on the default literal", () => {
  // app/layout.tsx cannot import this module (it runs before the bundle), so the
  // literal is duplicated by necessity — this test is what keeps the duplication
  // honest instead of letting it become a second source of truth.
  const match = layout.match(/localStorage\.getItem\("pi-theme"\)\s*\|\|\s*"([^"]*)"/);
  assert.ok(match, "the bootstrap still reads pi-theme with a fallback");
  assert.equal(match[1], DEFAULT_THEME, "bootstrap fallback must equal DEFAULT_THEME");
});
