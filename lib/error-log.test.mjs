import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-error-log-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = testAgentDir;
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { recordErrorLog, getErrorLogs, clearErrorLogs } = await jiti.import("./error-log.ts");

test("redacts bearer, key, password, and proxy credentials from persisted log entries", () => {
  const entry = recordErrorLog({
    source: "test",
    message: "Bearer sk-secret-value password=hunter2 http://user:pass@proxy.example:8080",
  });
  assert.doesNotMatch(entry.message, /sk-secret-value|hunter2|user:pass/);
  assert.match(entry.message, /redacted/);
});

test("hides removed OpenCode Zen gateway sources by default", () => {
  clearErrorLogs();
  const zen = recordErrorLog({ source: "opencode-zen-external", level: "error", message: "网关转发失败" });
  const model = recordErrorLog({ source: "model-call", level: "info", message: "模型调用成功" });
  assert.equal(zen.source, "opencode-zen-external");
  // Default listing excludes gateway sources entirely.
  assert.deepEqual(getErrorLogs().map((e) => e.id), [model.id]);
  // An explicit zen source query still works (keeps the filtering contract).
  assert.equal(getErrorLogs({ source: "opencode-zen-external" }).length, 1);
});

test("purges gateway history once when the store loads from disk", async () => {
  clearErrorLogs();
  recordErrorLog({ source: "opencode-zen-sync", level: "warning", message: "同步失败" });
  // Reload the module so the disk store is re-read (fresh global state).
  const fresh = createJiti(import.meta.url, { moduleCache: false });
  const { getErrorLogs: freshGet } = await fresh.import("./error-log.ts");
  assert.deepEqual(freshGet(), []);
});

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});
