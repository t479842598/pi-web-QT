import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sameIdSet } = await jiti.import("./id-set.ts");

test("equal sets are equal regardless of insertion order", () => {
  assert.equal(sameIdSet(new Set(["a", "b", "c"]), new Set(["c", "b", "a"])), true);
});

test("different sizes are not equal", () => {
  assert.equal(sameIdSet(new Set(["a"]), new Set(["a", "b"])), false);
  assert.equal(sameIdSet(new Set(["a", "b"]), new Set(["a"])), false);
});

test("same size but different members are not equal", () => {
  assert.equal(sameIdSet(new Set(["a", "x"]), new Set(["a", "b"])), false);
});

test("empty sets are equal", () => {
  assert.equal(sameIdSet(new Set(), new Set()), true);
});

test("bail-out usage: identical contents allow keeping the previous reference", () => {
  const prev = new Set(["s1", "s2"]);
  const next = new Set(["s2", "s1"]);
  const resolved = sameIdSet(prev, next) ? prev : next;
  assert.equal(resolved, prev, "caller keeps the old Set so React skips the re-render");
});
