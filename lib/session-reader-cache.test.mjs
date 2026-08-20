import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const reader = await jiti.import("./session-reader.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolate(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-cache-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
  });
  return dir;
}

function writeSessionFile(dir, id = "11111111-2222-4333-8444-555555555555") {
  const file = join(dir, `${id}.jsonl`);
  const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: dir };
  writeFileSync(file, JSON.stringify(header) + "\n");
  return file;
}

test("openSessionCached returns the same manager for an unchanged file", (t) => {
  const dir = isolate(t);
  const file = writeSessionFile(dir);
  const first = reader.openSessionCached(file);
  const second = reader.openSessionCached(file);
  assert.equal(second, first, "unchanged file must be served from cache");
});

test("openSessionCached re-reads after the file grows (mtime/size invalidation)", (t) => {
  const dir = isolate(t);
  const file = writeSessionFile(dir);
  const first = reader.openSessionCached(file);
  // Append-only growth changes size (and usually mtime) — cache must miss.
  appendFileSync(file, JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } }) + "\n");
  const second = reader.openSessionCached(file);
  assert.notEqual(second, first, "appended file must be re-read");
  assert.equal(second.getEntries().length, 1, "new entry visible after re-read");
});

test("invalidateOpenSessionCache forces a re-read", (t) => {
  const dir = isolate(t);
  const file = writeSessionFile(dir);
  const first = reader.openSessionCached(file);
  reader.invalidateOpenSessionCache(file);
  const second = reader.openSessionCached(file);
  assert.notEqual(second, first);
});

test("openSessionCached on a missing file matches SessionManager.open semantics (in-memory empty session)", (t) => {
  const dir = isolate(t);
  const missing = join(dir, "does-not-exist.jsonl");
  // SDK behavior: open() on a missing path creates an unsaved in-memory
  // session rather than throwing — the cached path must not change that.
  const sm = reader.openSessionCached(missing);
  assert.equal(sm.getEntries().length, 0);
});

test("a file created after a failed stat is picked up (no stale negative cache)", (t) => {
  const dir = isolate(t);
  const file = join(dir, "later.jsonl");
  reader.openSessionCached(file); // missing at this point
  const header = { type: "session", version: 3, id: "11111111-2222-4333-8444-555555555555", timestamp: new Date().toISOString(), cwd: dir };
  writeFileSync(file, JSON.stringify(header) + "\n");
  appendFileSync(file, JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } }) + "\n");
  const sm = reader.openSessionCached(file);
  assert.equal(sm.getEntries().length, 1, "newly created file is read, not served from a stale cache");
});

test("cache evicts oldest entries beyond the cap", (t) => {
  const dir = isolate(t);
  reader.invalidateOpenSessionCache(); // clear for a clean count
  const files = [];
  for (let i = 0; i < 8; i++) {
    files.push(writeSessionFile(dir, `11111111-2222-4333-8444-55555555555${i}`));
  }
  for (const f of files) reader.openSessionCached(f);
  const cache = globalThis.__piSessionManagerCache;
  assert.ok(cache.size <= 6, `cache bounded at 6, got ${cache.size}`);
});
