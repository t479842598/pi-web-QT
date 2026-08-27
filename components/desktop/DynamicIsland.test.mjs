import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { clampIslandPosition } = await jiti.import("./DynamicIsland.tsx");

test("clamp keeps an in-bounds position unchanged", () => {
  assert.deepEqual(clampIslandPosition(20, 30, 800, 600, 152, 42), { x: 20, y: 30 });
});

test("clamp pushes negative coordinates to the viewport edge", () => {
  assert.deepEqual(clampIslandPosition(-40, -10, 800, 600, 152, 42), { x: 0, y: 0 });
});

test("clamp pulls overflowing coordinates inside the viewport", () => {
  assert.deepEqual(clampIslandPosition(900, 620, 800, 600, 152, 42), { x: 648, y: 558 });
});

test("clamp collapses to 0 when the viewport is smaller than the island", () => {
  assert.deepEqual(clampIslandPosition(10, 10, 100, 30, 152, 42), { x: 0, y: 0 });
});

test("clamp keeps exact edge positions", () => {
  assert.deepEqual(clampIslandPosition(0, 0, 800, 600, 152, 42), { x: 0, y: 0 });
  assert.deepEqual(clampIslandPosition(648, 558, 800, 600, 152, 42), { x: 648, y: 558 });
});
