import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { clampPopoverPlacement } = await jiti.import("./popover-layout.ts");

test("panel spans the viewport minus side insets", () => {
  const p = clampPopoverPlacement(700, { width: 390, height: 844 });
  assert.equal(p.left, 8);
  assert.equal(p.right, 8);
  assert.equal(p.width, 374);
});

test("panel parks just above the anchor button", () => {
  const p = clampPopoverPlacement(700, { width: 390, height: 844 });
  assert.equal(p.bottom, 844 - 700 + 4);
});

test("anchor above the viewport keeps the panel fully on screen", () => {
  // A scrolled/clipped host must not push the panel off the bottom edge.
  const p = clampPopoverPlacement(-50, { width: 390, height: 844 });
  const panelTop = 844 - p.bottom - p.maxHeight;
  assert.ok(panelTop >= 0, `panel top ${panelTop} must stay inside the viewport`);
  assert.ok(p.maxHeight >= 120, "panel keeps a usable height");
});

test("maxHeight leaves room above the panel for the top inset", () => {
  const p = clampPopoverPlacement(700, { width: 390, height: 844 });
  assert.equal(p.maxHeight, 844 - p.bottom - 8);
  assert.ok(p.maxHeight > 0);
});

test("zero-size viewport degrades to zero without throwing", () => {
  const p = clampPopoverPlacement(0, { width: 0, height: 0 });
  assert.equal(p.width, 0);
  assert.equal(p.maxHeight, 0);
});
