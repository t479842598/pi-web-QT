import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { filterDirectoryEntries } = await createJiti(import.meta.url).import(new URL("./directory-picker-filter.ts", import.meta.url).href);

const entries = [
  { name: "src", path: "/a/src" },
  { name: "SRC_private", path: "/a/SRC_private" },
  { name: "docs", path: "/a/docs" },
  { name: "node_modules", path: "/a/node_modules" },
  { name: "src-legacy", path: "/a/src-legacy" },
];

test("null or empty filter returns all entries", () => {
  assert.equal(filterDirectoryEntries(entries, null).length, 5);
  assert.equal(filterDirectoryEntries(entries, "").length, 5);
  assert.equal(filterDirectoryEntries(entries, "   ").length, 5);
});

test("case-insensitive substring match", () => {
  const matched = filterDirectoryEntries(entries, "SRC");
  assert.deepEqual(matched.map((e) => e.name), ["src", "SRC_private", "src-legacy"]);
});

test("filter does not mutate the source array", () => {
  const before = entries.length;
  filterDirectoryEntries(entries, "src");
  assert.equal(entries.length, before);
});

test("no matches yields an empty array", () => {
  assert.deepEqual(filterDirectoryEntries(entries, "zzz"), []);
});

test("works with any { name } shaped entry", () => {
  const drives = [{ name: "C:\\" }, { name: "D:\\" }];
  assert.deepEqual(filterDirectoryEntries(drives, "d").map((d) => d.name), ["D:\\"]);
});
