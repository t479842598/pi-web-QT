import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { listThemeSets, resolveTheme } = await createJiti(import.meta.url).import("./theme.ts");

const builtinNames = ["gruvbox", "nord", "tokyo", "solarized", "onedark", "dracula", "catppuccin"];

test("lists the seven fixed QT themes before custom Pi JSON themes", () => {
  const themes = listThemeSets();
  assert.deepEqual(themes.slice(0, builtinNames.length).map((theme) => theme.name), builtinNames);
  assert.ok(themes.slice(0, builtinNames.length).every((theme) => theme.builtin && theme.hasDark && theme.hasLight));
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
