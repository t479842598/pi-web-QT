import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const reader = await jiti.import("./session-reader.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolate(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-scan-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
  });
  return dir;
}

let nextSessionId = 0;
function writeSessionFile(agentDir, cwdLabel, extraLines = [], id = null) {
  const sessionsDir = join(agentDir, "sessions", cwdLabel);
  mkdirSync(sessionsDir, { recursive: true });
  const sessionId = id ?? `11111111-2222-4333-8444-${String(++nextSessionId).padStart(12, "0")}`;
  const file = join(sessionsDir, `${sessionId}.jsonl`);
  const header = { type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: `/tmp/${cwdLabel}` };
  const body = extraLines.map((line) => JSON.stringify(line) + "\n").join("");
  writeFileSync(file, JSON.stringify(header) + "\n" + body);
  return file;
}

function userMessage(text, timestamp = "2026-01-01T00:00:01.000Z") {
  return { type: "message", id: `m-${Math.random().toString(36).slice(2)}`, parentId: null, timestamp, message: { role: "user", content: text } };
}

function assistantMessage(text, timestamp = "2026-01-01T00:00:02.000Z") {
  return { type: "message", id: `a-${Math.random().toString(36).slice(2)}`, parentId: null, timestamp, message: { role: "assistant", provider: "t", model: "m", content: [{ type: "text", text }] } };
}

test("first scan parses every file and returns list metadata", async (t) => {
  const dir = isolate(t);
  const fileA = writeSessionFile(dir, "proj-a", [
    userMessage("first question"),
    assistantMessage("answer"),
  ]);
  const fileB = writeSessionFile(dir, "proj-b");

  const infos = await reader.scanSessionInfos();
  assert.equal(infos.length, 2);
  const a = infos.find((info) => info.path === fileA);
  const b = infos.find((info) => info.path === fileB);
  assert.ok(a && b);
  assert.equal(a.cwd, "/tmp/proj-a");
  assert.equal(a.messageCount, 2);
  assert.equal(a.firstMessage, "first question");
  assert.equal(typeof a.name, "undefined");
  assert.ok(a.created instanceof Date);
  assert.ok(b.messageCount === 0);
  assert.equal(b.firstMessage, "(no messages)");
});

test("unchanged files reuse the cached info object (no re-parse)", async (t) => {
  const dir = isolate(t);
  writeSessionFile(dir, "proj-a", [userMessage("hello")]);
  writeSessionFile(dir, "proj-b");

  const first = await reader.scanSessionInfos();
  const second = await reader.scanSessionInfos();
  assert.equal(first.length, second.length);
  for (const info of first) {
    const reused = second.find((candidate) => candidate.path === info.path);
    assert.equal(reused, info, "unchanged file must reuse the exact cached info reference");
  }
});

test("appended file (mtime/size change) is re-parsed and the map updated", async (t) => {
  const dir = isolate(t);
  const file = writeSessionFile(dir, "proj-a", [userMessage("before")]);

  const first = await reader.scanSessionInfos();
  const before = first.find((info) => info.path === file);
  assert.equal(before.messageCount, 1);

  appendFileSync(file, JSON.stringify(userMessage("after")) + "\n");
  const second = await reader.scanSessionInfos();
  const after = second.find((info) => info.path === file);
  assert.notEqual(after, before, "changed file must be re-parsed into a fresh info");
  assert.equal(after.messageCount, 2);
});

test("whole-file rewrite (same entry count, new content) is picked up", async (t) => {
  const dir = isolate(t);
  const file = writeSessionFile(dir, "proj-a", [userMessage("old content")]);

  await reader.scanSessionInfos();
  writeFileSync(file, [
    JSON.stringify({ type: "session", version: 3, id: "11111111-2222-4333-8444-000000000009", timestamp: "2026-02-01T00:00:00.000Z", cwd: "/tmp/proj-a" }),
    JSON.stringify(userMessage("rewritten content")),
    "",
  ].join("\n"));
  const second = await reader.scanSessionInfos();
  const after = second.find((info) => info.path === file);
  assert.equal(after.id, "11111111-2222-4333-8444-000000000009", "rewritten header id wins");
  assert.equal(after.firstMessage, "rewritten content");
});

test("new files are included and removed files are pruned", async (t) => {
  const dir = isolate(t);
  const kept = writeSessionFile(dir, "proj-a", [userMessage("kept")]);
  const removed = writeSessionFile(dir, "proj-b", [userMessage("gone")]);

  await reader.scanSessionInfos();
  rmSync(removed);
  const added = writeSessionFile(dir, "proj-c", [userMessage("newcomer")]);

  const second = await reader.scanSessionInfos();
  const paths = second.map((info) => info.path);
  assert.ok(paths.includes(kept));
  assert.ok(paths.includes(added), "newly created session file must appear");
  assert.ok(!paths.includes(removed), "deleted session file must be pruned from the map");
});

test("session_info name is latest-wins and firstMessage is the first non-empty user text", async (t) => {
  const dir = isolate(t);
  writeSessionFile(dir, "proj-a", [
    { type: "session_info", id: "s1", parentId: null, timestamp: "2026-01-01T00:00:00.500Z", name: "draft name" },
    // Empty text content is skipped (SDK parity: only falsy text is skipped).
    userMessage("", "2026-01-01T00:00:01.000Z"),
    userMessage("real first", "2026-01-01T00:00:01.500Z"),
    { type: "session_info", id: "s2", parentId: null, timestamp: "2026-01-01T00:00:02.000Z", name: "  final name  " },
  ]);

  const infos = await reader.scanSessionInfos();
  const info = infos.find((entry) => entry.cwd === "/tmp/proj-a");
  assert.equal(info.name, "final name");
  assert.equal(info.firstMessage, "real first");
});

test("corrupt files are skipped without blocking the rest of the scan", async (t) => {
  const dir = isolate(t);
  const good = writeSessionFile(dir, "proj-a", [userMessage("fine")]);
  const bad = writeSessionFile(dir, "proj-b");
  writeFileSync(bad, "{ this is not json at all\n");

  const infos = await reader.scanSessionInfos();
  const paths = infos.map((info) => info.path);
  assert.ok(paths.includes(good), "healthy file must survive a corrupt neighbour");
  assert.ok(!paths.includes(bad), "non-session file must be skipped");
});
