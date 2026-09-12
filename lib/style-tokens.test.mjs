import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const COMPONENTS = new URL("../components/", import.meta.url);

async function componentSources(dir = COMPONENTS) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) out.push(...await componentSources(url));
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push({ name: entry.name, source: await readFile(url, "utf8") });
    }
  }
  return out;
}

test("text on an accent background uses the accent-fg token", async () => {
  // In the dark theme --accent is light (#64c1b6), so hard-coded white text on
  // it is unreadable. --accent-fg flips with the theme and is the correct token.
  for (const { name, source } of await componentSources()) {
    if (name === "provider-icons.tsx") continue;
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      if (!line.includes('color: "#fff"')) return;
      const context = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
      const onAccent = context.includes("background: \"var(--accent)\"")
        || context.includes("backgroundColor: \"var(--accent,")
        || context.includes("linear-gradient(135deg, var(--accent)");
      assert.ok(!onAccent, `${name}:${i + 1} uses #fff text on --accent; use var(--accent-fg)`);
    });
  }
});

test("theme-breaking hard-coded colors stay out of components", async () => {
  // These were all light-only literals that broke dark mode.
  const banned = ["#111827", "#fbbf24", "#f87171", "#3b82f6", "#fee2e2", "#dcfce7", "#fecaca", "#bbf7d0"];
  for (const { name, source } of await componentSources()) {
    if (name === "provider-icons.tsx") continue;
    for (const color of banned) {
      assert.ok(!source.includes(`"${color}"`), `${name} hard-codes ${color}; use a theme token`);
    }
  }
});
