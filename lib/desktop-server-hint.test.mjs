import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  shouldShowServerHint,
  markServerHintSeen,
  DESKTOP_SERVER_HINT_KEY,
} = await createJiti(import.meta.url).import("./desktop-server-hint.ts");

/** 最小 localStorage 替身（与 sidebar-projects-view.test.mjs 同一思路） */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

test("shows the hint on a fresh install", () => {
  assert.equal(shouldShowServerHint(fakeStorage()), true);
});

test("stays hidden once marked seen", () => {
  const storage = fakeStorage();
  assert.equal(shouldShowServerHint(storage), true);
  markServerHintSeen(storage);
  assert.equal(storage.data[DESKTOP_SERVER_HINT_KEY], "1");
  assert.equal(shouldShowServerHint(storage), false);
});

test("persists across storage instances via the same key", () => {
  const first = fakeStorage();
  markServerHintSeen(first);
  const second = fakeStorage({ ...first.data });
  assert.equal(shouldShowServerHint(second), false);
});

test("no storage (SSR / private mode) never shows the hint", () => {
  assert.equal(shouldShowServerHint(null), false);
  // 标记也不应抛错
  assert.doesNotThrow(() => markServerHintSeen(null));
});

test("swallows storage exceptions instead of breaking the UI", () => {
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.equal(shouldShowServerHint(throwing), false);
  assert.doesNotThrow(() => markServerHintSeen(throwing));
});
