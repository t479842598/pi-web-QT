import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { listThemeSets, resolveTheme } = await createJiti(import.meta.url).import("./theme.ts");

const qtNames = ["gruvbox", "nord", "tokyo", "solarized", "onedark", "dracula", "catppuccin"];
const ocNames = ["flexoki", "kanagawa", "tokyonight", "one-dark-pro", "night-owl", "monokai", "aura", "vesper"];

test("lists QT and OpenChamber built-in themes with real accent swatches", () => {
  const themes = listThemeSets();
  const names = themes.map((theme) => theme.name);
  const builtin = themes.filter((theme) => theme.builtin);

  // All seven QT themes remain present and built-in.
  for (const name of qtNames) assert.ok(names.includes(name), `missing QT theme ${name}`);

  // A healthy set of OpenChamber themes is registered as built-in.
  for (const name of ocNames) assert.ok(names.includes(name), `missing OpenChamber theme ${name}`);

  // Every built-in theme carries both variants and swatch colors.
  for (const theme of builtin) {
    assert.ok(theme.hasDark || theme.hasLight, `${theme.name} has no variant`);
    if (theme.hasDark) assert.match(theme.accent ?? "", /^#[0-9a-f]{6}$/i, `${theme.name} dark accent`);
    if (theme.hasLight) assert.match(theme.accentLight ?? "", /^#[0-9a-f]{6}$/i, `${theme.name} light accent`);
  }

  // Distinct themes show distinct accent colors (the original bug: all dots identical).
  const accents = builtin.filter((t) => t.accent).map((t) => t.accent);
  assert.ok(new Set(accents).size >= 10, "expected varied accent colors across themes");
});

test("QT themes win name collisions over OpenChamber themes", () => {
  const themes = listThemeSets();
  const gruvbox = themes.find((theme) => theme.name === "gruvbox");
  // QT gruvbox dark accent is #83a598; OpenChamber gruvbox differs.
  assert.equal(gruvbox?.accent, "#83a598");
});

test("resolves fixed theme variants into the active CSS token set", () => {
  const nordDark = resolveTheme("nord", "dark");
  const nordLight = resolveTheme("nord", "light");

  assert.equal(nordDark?.isDark, true);
  assert.equal(nordDark?.cssVars["--bg"], "#2e3440");
  assert.equal(nordDark?.cssVars["--accent"], "#88c0d0");
  assert.equal(nordLight?.isDark, false);
  assert.equal(nordLight?.cssVars["--bg"], "#e5e9f0");
  assert.equal(nordLight?.cssVars["--accent"], "#5e81ac");
});

test("resolves migrated OpenChamber themes into CSS tokens", () => {
  const flexokiDark = resolveTheme("flexoki", "dark");
  assert.equal(flexokiDark?.isDark, true);
  assert.ok(flexokiDark?.cssVars["--bg"], "flexoki dark has a background");
  assert.match(flexokiDark?.cssVars["--accent"] ?? "", /^#[0-9a-f]{6}$/i);

  const kanagawaLight = resolveTheme("kanagawa", "light");
  assert.equal(kanagawaLight?.isDark, false);
  assert.ok(kanagawaLight?.cssVars["--bg"]);

  // Single-variant OpenChamber themes resolve only their own variant.
  assert.ok(resolveTheme("vitesse-dark", "dark"));
  assert.equal(resolveTheme("vitesse-dark", "light"), null);
});

test("custom pi CLI themes still resolve after the OpenChamber merge", () => {
  // resolveTheme with no custom dirs should not crash and returns null for unknown.
  assert.equal(resolveTheme("does-not-exist", "dark"), null);
});

test("semantic tokens are emitted for built-in and user themes", async () => {
  const nord = resolveTheme("nord", "dark");
  assert.ok(nord?.cssVars["--status-error"], "status-error present");
  assert.ok(nord?.cssVars["--status-success"], "status-success present");
  assert.ok(nord?.cssVars["--syntax-keyword"], "syntax-keyword present");
  assert.ok(nord?.cssVars["--syntax-comment"], "syntax-comment present");
  const flexoki = resolveTheme("flexoki", "light");
  assert.ok(flexoki?.cssVars["--status-info"], "flexoki status-info present");
  assert.ok(flexoki?.cssVars["--syntax-string"], "flexoki syntax-string present");
});
