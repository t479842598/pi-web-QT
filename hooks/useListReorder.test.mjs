import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { reorderItem } = await jiti.import("./useListReorder.ts");

const letters = () => ["a", "b", "c", "d"];

test("dragging a later row above an earlier one lands it directly above", () => {
  assert.deepEqual(reorderItem(letters(), 2, 0, "above"), ["c", "a", "b", "d"]);
});

test("dragging an earlier row below a later one lands it directly below", () => {
  assert.deepEqual(reorderItem(letters(), 0, 2, "below"), ["b", "c", "a", "d"]);
});

test("dragging the first row below the last row moves it to the end", () => {
  assert.deepEqual(reorderItem(letters(), 0, 3, "below"), ["b", "c", "d", "a"]);
});

test("dragging the last row above the first row moves it to the front", () => {
  assert.deepEqual(reorderItem(letters(), 3, 0, "above"), ["d", "a", "b", "c"]);
});

test("dropping a row onto itself keeps the order and returns a copy", () => {
  const source = letters();
  const moved = reorderItem(source, 1, 1, "above");
  assert.deepEqual(moved, ["a", "b", "c", "d"]);
  assert.notEqual(moved, source, "a reorder never mutates or returns the caller's array");
});

test("an out-of-range index leaves the list unchanged", () => {
  assert.deepEqual(reorderItem(letters(), -1, 2, "above"), ["a", "b", "c", "d"]);
  assert.deepEqual(reorderItem(letters(), 0, 4, "below"), ["a", "b", "c", "d"]);
  assert.deepEqual(reorderItem(letters(), 9, 9, "above"), ["a", "b", "c", "d"]);
});

test("the source removal compensation is what makes 'above' shift left once", () => {
  // b above d: removing b first shifts d from 3 to 2, so the insert index of the
  // *shortened* array is target - 1. Without it the row lands after d.
  assert.deepEqual(reorderItem(letters(), 1, 3, "above"), ["a", "c", "b", "d"]);
  // b below c is a no-op in this list: it already sits there.
  assert.deepEqual(reorderItem(letters(), 1, 2, "above"), ["a", "b", "c", "d"]);
});

test("reordering never mutates the input array", () => {
  const source = letters();
  reorderItem(source, 3, 0, "below");
  assert.deepEqual(source, ["a", "b", "c", "d"]);
});
