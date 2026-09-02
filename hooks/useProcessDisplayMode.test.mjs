import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./useProcessDisplayMode.ts", import.meta.url), "utf8");

test("process display mode is tab-local and defaults to tabs", () => {
  assert.match(source, /DEFAULT_MODE: ProcessDisplayMode = "tabs"/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(source, /localStorage\.getItem/);
  assert.doesNotMatch(source, /addEventListener\("storage"/);
});
