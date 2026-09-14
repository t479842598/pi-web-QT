import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { Virtualizer } from "@tanstack/virtual-core";

const jiti = createJiti(import.meta.url);
const { measureMessageRow, measureCommittedMessageRows } = await jiti.import("./virtualized-message-layout.ts");
const source = await readFile(new URL("../components/VirtualizedMessageList.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function row(index, key, height) {
  return {
    isConnected: true,
    getAttribute: (name) => ({ "data-index": String(index), "data-item-key": key })[name] ?? null,
    getBoundingClientRect: () => ({ height }),
  };
}

function container(children) {
  return { isConnected: true, getClientRects: () => [{}], children };
}

test("measures the current border box and rounds up instead of reusing a stale observer value", () => {
  assert.equal(measureMessageRow(row(0, "a", 120.25)), 121);
  assert.equal(measureMessageRow(row(0, "a", 700)), 700);
});

test("ignores disconnected rows and rows belonging to an uncommitted item order", () => {
  const disconnected = { ...row(1, "b", 900), isConnected: false };
  assert.deepEqual(measureCommittedMessageRows(container([
    row(0, "a", 70), disconnected, row(2, "old-key", 300), row(99, "z", 1), row(-1, "a", 2),
  ]), ["a", "b", "c"]), [{ index: 0, size: 70 }]);
});

test("does not replace useful cached sizes with zero while the whole list is hidden", () => {
  assert.deepEqual(measureCommittedMessageRows({ ...container([row(0, "a", 0)]), getClientRects: () => [] }, ["a"]), []);
});

test("repairs affected row offsets without clearing offscreen measurements or moving scrollTop", () => {
  const keys = ["a", "b", "c"];
  let scrollCalls = 0;
  const virtualizer = new Virtualizer({
    count: keys.length,
    getItemKey: (index) => keys[index],
    estimateSize: () => 120,
    getScrollElement: () => null,
    observeElementRect: () => {},
    observeElementOffset: () => {},
    scrollToFn: () => { scrollCalls += 1; },
    initialRect: { height: 600, width: 900 },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  virtualizer.getTotalSize();
  virtualizer.resizeItem(2, 800);
  for (const { index, size } of measureCommittedMessageRows(container([row(0, "a", 500.5), row(1, "b", 90.2)]), keys)) {
    virtualizer.resizeItem(index, size);
  }
  virtualizer.getTotalSize();
  const rows = virtualizer.measurementsCache;
  assert.equal(rows[1].start, 501);
  assert.equal(rows[2].start, 592);
  assert.equal(virtualizer.itemSizeCache.get("c"), 800);
  assert.equal(scrollCalls, 0);
});

test("row positions subtract the extension header already included in scrollMargin", () => {
  assert.match(source, /item\.start - headerHeight/);
});

test("virtual rows opt out of inner content-visibility placeholders", () => {
  assert.match(source, /className="virtualized-message-list"/);
  assert.match(css, /\.virtualized-message-list[\s\S]*?content-visibility: visible;[\s\S]*?contain-intrinsic-size: none;/);
});

test("committed content updates trigger local measurement without dropping the entire cache", () => {
  assert.match(source, /useLayoutEffect\(/);
  assert.match(source, /measureCommittedMessageRows/);
  assert.match(source, /data-item-key=\{item\.key\}/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /record\.target\.parentNode !== list/);
  assert.doesNotMatch(source, /^\s*virtualizer\.measure\(\)/m);
});

// Execute the production callback: using only the helper would miss the guard
// between committed DOM measurement and index-based cache writes.
const { default: ts } = await import("typescript");
const parsed = ts.createSourceFile("VirtualizedMessageList.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mountedCallback;
function findCallback(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "measureMountedRows") {
    mountedCallback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, findCallback);
}
findCallback(parsed);
assert.ok(mountedCallback && ts.isArrowFunction(mountedCallback));
const { createMeasureMountedRows } = await jiti.evalModule(`
export function createMeasureMountedRows(listRef, committedKeysRef, virtualizer, measureCommittedMessageRows) {
  return ${mountedCallback.getText(parsed)};
}`, { filename: jiti.resolve("./virtualized-message-layout.ts") });

function measurementHarness(t, committedKeys = ["a", "b"], renderedKeys = committedKeys) {
  const virtualizer = new Virtualizer({
    count: renderedKeys.length,
    getItemKey: (index) => renderedKeys[index],
    estimateSize: () => 120,
    getScrollElement: () => null,
    observeElementRect: () => {},
    observeElementOffset: () => {},
    scrollToFn: () => {},
    initialRect: { height: 600, width: 900 },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  virtualizer.getTotalSize();
  const listRef = { current: container(committedKeys.map((key, index) => row(index, key, 500.25 + index))) };
  const committedKeysRef = { current: committedKeys };
  const resize = t.mock.method(virtualizer, "resizeItem");
  const measure = createMeasureMountedRows(listRef, committedKeysRef, virtualizer, measureCommittedMessageRows);
  return { virtualizer, listRef, committedKeysRef, resize, measure };
}

test("should_update_real_cache_when_dom_committed_keys_and_options_match", (t) => {
  const h = measurementHarness(t);
  h.measure();
  assert.deepEqual([...h.virtualizer.itemSizeCache], [["a", 501], ["b", 502]]);
});

test("should_skip_cache_writes_when_uncommitted_prepend_changes_index_identity", (t) => {
  const h = measurementHarness(t, ["a", "b"], ["prepended", "a", "b"]);
  h.measure();
  assert.equal(h.resize.mock.callCount(), 0);
});

test("should_preserve_new_key_cache_when_old_dom_still_occupies_its_index", (t) => {
  const h = measurementHarness(t, ["old"], ["new"]);
  h.virtualizer.resizeItem(0, 777);
  h.measure();
  assert.equal(h.virtualizer.itemSizeCache.get("new"), 777);
});

test("should_measure_matching_rows_when_only_some_indices_changed_identity", (t) => {
  const h = measurementHarness(t, ["a", "b"], ["a", "replacement"]);
  h.measure();
  assert.deepEqual([...h.virtualizer.itemSizeCache], [["a", 501]]);
});

test("should_resume_measurement_when_new_dom_order_has_committed", (t) => {
  const h = measurementHarness(t, ["old"], ["new"]);
  h.measure();
  h.committedKeysRef.current = ["new"];
  h.listRef.current = container([row(0, "new", 700.75)]);
  h.measure();
  assert.equal(h.virtualizer.itemSizeCache.get("new"), 701);
});

test("should_not_notify_again_when_repeated_measurement_has_identical_height", (t) => {
  const h = measurementHarness(t);
  const onChange = t.mock.fn();
  h.virtualizer.setOptions({ ...h.virtualizer.options, onChange });
  h.measure();
  const notifications = onChange.mock.callCount();
  h.measure();
  assert.equal(onChange.mock.callCount(), notifications);
});

test("should_leave_cache_unchanged_when_list_was_unmounted_before_callback", (t) => {
  const h = measurementHarness(t);
  h.listRef.current = null;
  h.measure();
  assert.equal(h.resize.mock.callCount(), 0);
});
