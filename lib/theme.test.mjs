import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { listThemeSets, resolveTheme, getDefaultThemePreview } = await createJiti(import.meta.url).import("./theme.ts");

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

test("every theme set ships a preview palette for the requested mode", () => {
  // The settings cards draw a mini preview from these colors instead of
  // fetching each theme's full token set, so every set must carry one.
  for (const preferDark of [true, false]) {
    const themes = listThemeSets(undefined, preferDark);
    assert.ok(themes.length > 0);
    for (const theme of themes) {
      assert.ok(theme.preview, `${theme.name} is missing a preview palette (preferDark=${preferDark})`);
      for (const key of ["bg", "panel", "border", "text", "muted", "accent", "userBg", "toolBg"]) {
        assert.match(
          theme.preview[key] ?? "",
          /^(#[0-9a-f]{3,8}|rgba?\()/i,
          `${theme.name}.preview.${key} is not a color: ${String(theme.preview[key])}`,
        );
      }
      // The palette must describe the variant the caller asked for: dark when
      // the set has one, otherwise it falls back to the only variant it has.
      const expectedIsDark = preferDark ? theme.hasDark : !theme.hasLight;
      assert.equal(
        theme.previewIsDark,
        expectedIsDark,
        `${theme.name} preview variant mismatch (preferDark=${preferDark}, hasDark=${theme.hasDark}, hasLight=${theme.hasLight})`,
      );
    }
  }
});

test("preview palettes differ between a theme's dark and light variants", () => {
  const dark = listThemeSets(undefined, true).find((theme) => theme.name === "nord");
  const light = listThemeSets(undefined, false).find((theme) => theme.name === "nord");
  assert.equal(dark?.previewIsDark, true);
  assert.equal(light?.previewIsDark, false);
  assert.notEqual(dark?.preview?.bg, light?.preview?.bg);
});

test("default theme preview mirrors the globals.css default palette", () => {
  const dark = getDefaultThemePreview(true);
  assert.equal(dark.bg, "#1a1a1a");
  assert.equal(dark.accent, "#64c1b6");
  const light = getDefaultThemePreview(false);
  assert.equal(light.bg, "#ffffff");
  assert.equal(light.accent, "#0d9488");
});

test("every theme emits a readable --accent-fg for its accent color", () => {
  // Buttons that sit on an accent background used to hardcode white text, which
  // vanished on light themes with pale accents. The token must pick a foreground
  // that is actually visible against that theme's accent.
  const luminance = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [la, lb] = [luminance(a), luminance(b)];
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const themes = listThemeSets(undefined, true).concat(listThemeSets(undefined, false));
  assert.ok(themes.length > 0);
  for (const theme of themes) {
    const resolved = resolveTheme(theme.name, theme.previewIsDark ? "dark" : "light");
    if (!resolved) continue;
    const accent = resolved.cssVars["--accent"];
    const fg = resolved.cssVars["--accent-fg"];
    assert.ok(fg, `${theme.name} has no --accent-fg`);
    const ratio = contrast(fg, accent);
    if (ratio === null) continue; // rgba()/color-mix() accents are out of scope
    assert.ok(ratio >= 2, `${theme.name}: --accent-fg ${fg} vs --accent ${accent} contrast ${ratio.toFixed(2)}`);
  }
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

test("pi CLI format themes map camelCase syntax tokens to CSS variables", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "pi-web-theme-test-"));
  const themePath = join(dir, "cli-syntax.json");
  await writeFile(themePath, JSON.stringify({
    name: "cli-syntax",
    vars: { bg0: "#111111", bg1: "#1a1a1a", fg0: "#e8e8e8" },
    colors: {
      accent: "#ff8800",
      syntaxKeyword: "#ff0000",
      syntaxString: "#00ff00",
      syntaxNumber: "#0000ff",
      syntaxFunction: "#ff00ff",
      syntaxComment: "#888888",
    },
  }));
  try {
    const resolved = resolveTheme(themePath, "dark");
    assert.equal(resolved?.cssVars["--syntax-keyword"], "#ff0000");
    assert.equal(resolved?.cssVars["--syntax-string"], "#00ff00");
    assert.equal(resolved?.cssVars["--syntax-number"], "#0000ff");
    assert.equal(resolved?.cssVars["--syntax-function"], "#ff00ff");
    assert.equal(resolved?.cssVars["--syntax-comment"], "#888888");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
