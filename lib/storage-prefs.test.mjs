import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * `lib/storage-prefs.ts` is the single place allowed to touch localStorage.
 *
 * It exists because eleven components read storage inline — five of them during
 * render or in a state initializer — which is exactly how a server/client
 * hydration mismatch starts. These tests pin the two properties that make the
 * centralisation worth having: it never throws, and an absent/unparseable value
 * always resolves to the caller's fallback rather than to `undefined`.
 */

const prefs = await createJiti(import.meta.url).import("./storage-prefs.ts");

/** Minimal Storage stand-in; `fail` simulates private mode / quota errors. */
function installStorage({ fail = false } = {}) {
  const map = new Map();
  const deny = () => {
    throw new Error("denied");
  };
  const store = {
    getItem: (key) => (fail ? deny() : map.has(key) ? map.get(key) : null),
    setItem: (key, value) => (fail ? deny() : map.set(key, String(value))),
    removeItem: (key) => (fail ? deny() : map.delete(key)),
  };
  globalThis.window = { localStorage: store, sessionStorage: store };
  return map;
}

test("an absent value returns the fallback, not undefined", () => {
  installStorage();
  assert.equal(prefs.readPreference("missing"), null);
  assert.equal(prefs.readBooleanPreference("missing", true), true);
  assert.equal(prefs.readNumberPreference("missing", 7, (n) => n), 7);
  assert.deepEqual(prefs.readParsedPreference("missing", JSON.parse, { a: 1 }), { a: 1 });
});

test("values round-trip through the same key", () => {
  installStorage();
  assert.equal(prefs.writePreference("k", "v"), true);
  assert.equal(prefs.readPreference("k"), "v");
  assert.equal(prefs.writeBooleanPreference("b", false), true);
  assert.equal(prefs.readBooleanPreference("b", true), false, "stored false beats the fallback");
});

test("an empty write clears the key instead of storing an empty string", () => {
  const map = installStorage();
  prefs.writePreference("k", "v");
  prefs.writePreference("k", "");
  assert.equal(map.has("k"), false);
  prefs.writePreference("k", "v");
  prefs.clearPreference("k");
  assert.equal(map.has("k"), false);
});

test("unparseable JSON falls back instead of throwing", () => {
  installStorage();
  prefs.writePreference("bad", "{not json");
  assert.deepEqual(prefs.readParsedPreference("bad", JSON.parse, { safe: true }), { safe: true });
  prefs.writePreference("nan", "abc");
  assert.equal(prefs.readNumberPreference("nan", 5, (n) => n), 5);
});

test("the clamp runs on a real number", () => {
  installStorage();
  prefs.writePreference("n", "999");
  assert.equal(prefs.readNumberPreference("n", 5, (n) => Math.min(10, n)), 10);
});

test("storage that throws degrades to fallbacks and a false write", () => {
  installStorage({ fail: true });
  assert.equal(prefs.readPreference("k"), null);
  assert.equal(prefs.writePreference("k", "v"), false);
  assert.equal(prefs.readBooleanPreference("k", true), true);
  // Must not throw: a denied storage has to be survivable everywhere.
  prefs.clearPreference("k");
});

test("no window (server render) is silent", () => {
  delete globalThis.window;
  assert.equal(prefs.readPreference("k"), null);
  assert.equal(prefs.writePreference("k", "v"), false);
  assert.deepEqual(prefs.readDataset(["uiKit"]), {});
  assert.equal(typeof prefs.subscribeToStorage("pi-", () => {}), "function");
});
