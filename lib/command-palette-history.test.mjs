import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  HISTORY_LIMIT,
  historyStorageKey,
  isRememberableQuery,
  parseHistory,
  upsertHistory,
} = await createJiti(import.meta.url).import("./command-palette-history.ts");

test("historyStorageKey namespaces by project and falls back for an empty key", () => {
  assert.equal(historyStorageKey("/repo/a"), "pi-command-center-search-history:/repo/a");
  assert.equal(historyStorageKey(""), "pi-command-center-search-history:default");
});

test("isRememberableQuery rejects empty strings and bare scope prefixes", () => {
  assert.equal(isRememberableQuery(""), false);
  assert.equal(isRememberableQuery("   "), false);
  assert.equal(isRememberableQuery(">"), false);
  assert.equal(isRememberableQuery("#"), false);
  assert.equal(isRememberableQuery("@"), false);
  assert.equal(isRememberableQuery("> fix"), true);
  assert.equal(isRememberableQuery("typescript"), true);
});

test("parseHistory tolerates malformed storage", () => {
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory("not json"), []);
  assert.deepEqual(parseHistory('{"query":"x"}'), []);
  // Entries with a bad scope keep the query but fall back to "all".
  assert.deepEqual(parseHistory('[{"query":"keep me","scope":"nope","updatedAt":5}]'), [
    { query: "keep me", scope: "all", updatedAt: 5 },
  ]);
  // Non-rememberable entries are dropped on read.
  assert.deepEqual(parseHistory('[{"query":">","scope":"commands","updatedAt":1}]'), []);
});

test("upsertHistory promotes duplicates case-insensitively and trims", () => {
  const first = upsertHistory([], "  Fix Bug  ", "all", 1);
  assert.deepEqual(first, [{ query: "Fix Bug", scope: "all", updatedAt: 1 }]);

  const promoted = upsertHistory(first, "fix bug", "sessions", 2);
  assert.equal(promoted.length, 1);
  assert.deepEqual(promoted[0], { query: "fix bug", scope: "sessions", updatedAt: 2 });
});

test("upsertHistory keeps the newest first and caps the list", () => {
  let entries = [];
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    entries = upsertHistory(entries, `query ${i}`, "all", i);
  }
  assert.equal(entries.length, HISTORY_LIMIT);
  assert.equal(entries[0].query, `query ${HISTORY_LIMIT + 4}`);
  assert.equal(entries[entries.length - 1].query, "query 5");
});

test("upsertHistory ignores entries that are not rememberable", () => {
  const entries = upsertHistory([], "real", "all", 1);
  assert.deepEqual(upsertHistory(entries, "  ", "files", 2), entries);
  assert.deepEqual(upsertHistory(entries, "@", "files", 3), entries);
});
