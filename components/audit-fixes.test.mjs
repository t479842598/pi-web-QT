import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(join(root, relative), "utf8");

test("eslint ignores the reference and mobile trees", async () => {
  const config = await read("eslint.config.mjs");
  assert.match(config, /"\.reasonix\/\*\*"/);
  assert.match(config, /"mobile2\/\*\*"/);
});

test("tsconfig excludes .reasonix", async () => {
  const config = JSON.parse(await read("tsconfig.json"));
  assert.ok(config.exclude.includes(".reasonix"), `exclude: ${config.exclude.join(", ")}`);
});

test("the dead ThinkingIcon component is gone", () => {
  assert.equal(existsSync(join(root, "components/ThinkingIcon.tsx")), false);
});

test("the sidebar renders the server-side session search", async () => {
  const sidebar = await read("components/SessionSidebar.tsx");
  assert.match(sidebar, /import \{ SessionSearch \} from "\.\/SessionSearch"/);
  assert.match(sidebar, /<SessionSearch[\s>]/);
});

test("the markdown preview renders the frontmatter card", async () => {
  const viewer = await read("components/FileViewer.tsx");
  assert.match(viewer, /import \{ FrontmatterCard \} from "@\/components\/FrontmatterCard"/);
  assert.match(viewer, /<FrontmatterCard data=\{markdownFrontmatter\.data\} \/>/);
});

test("saved-pop and saved-check-draw are defined once across both stylesheets", async () => {
  const css = `${await read("app/globals.css")}\n${await read("app/settings.css")}`;
  for (const name of ["saved-pop", "saved-check-draw"]) {
    const definitions = css.match(new RegExp(`@keyframes\\s+${name}\\b`, "g")) ?? [];
    assert.equal(definitions.length, 1, `${name}: ${definitions.length} definitions`);
  }
});
