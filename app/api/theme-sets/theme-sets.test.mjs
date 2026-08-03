import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The theme-set grouping logic (base name + -dark/-light suffix detection) is
// tested via a small mirror of app/api/theme-sets/route.ts, keeping the test
// free of Next.js runtime dependencies.

function groupThemeFiles(files) {
  const themeSets = new Map();
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const base = file.replace(/\.json$/i, "");
    let name = base;
    let variant = "base";
    const darkMatch = base.match(/^(.*)-dark$/i);
    const lightMatch = base.match(/^(.*)-light$/i);
    if (darkMatch) {
      name = darkMatch[1];
      variant = "dark";
    } else if (lightMatch) {
      name = lightMatch[1];
      variant = "light";
    }
    const set = themeSets.get(name) ?? { name, variants: [] };
    set.variants.push({ variant, file });
    themeSets.set(name, set);
  }
  const arr = [...themeSets.values()];
  arr.sort((a, b) => {
    const aSingle = a.variants.length === 1 && a.variants[0].variant === "base" ? 0 : 1;
    const bSingle = b.variants.length === 1 && b.variants[0].variant === "base" ? 0 : 1;
    if (aSingle !== bSingle) return aSingle - bSingle;
    return a.name.localeCompare(b.name);
  });
  return arr;
}

test("pairs gruvbox-dark.json and gruvbox-light.json into one set", () => {
  const sets = groupThemeFiles(["gruvbox-dark.json", "gruvbox-light.json", "nord.json"]);
  assert.equal(sets.length, 2);
  const gruvbox = sets.find((s) => s.name === "gruvbox");
  assert.ok(gruvbox);
  assert.deepEqual(
    gruvbox.variants.map((v) => v.variant).sort(),
    ["dark", "light"],
  );
});

test("single-file themes sort before paired sets", () => {
  const sets = groupThemeFiles(["gruvbox-dark.json", "gruvbox-light.json", "nord.json"]);
  assert.equal(sets[0].name, "nord");
});

test("ignores non-json files", () => {
  const sets = groupThemeFiles(["theme.txt", "readme.md", "solarized-dark.json"]);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].name, "solarized");
});

test("empty directory yields empty list", () => {
  assert.deepEqual(groupThemeFiles([]), []);
});

test("real temp dir round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "piweb-theme-"));
  try {
    writeFileSync(join(dir, "gruvbox-dark.json"), "{}");
    writeFileSync(join(dir, "gruvbox-light.json"), "{}");
    writeFileSync(join(dir, "ignore.txt"), "x");
    const files = ["gruvbox-dark.json", "gruvbox-light.json", "ignore.txt"];
    const sets = groupThemeFiles(files);
    assert.equal(sets.length, 1);
    assert.equal(sets[0].name, "gruvbox");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
