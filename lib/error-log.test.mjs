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
const { recordErrorLog } = await jiti.import("./error-log.ts");

test("redacts bearer, key, password, and proxy credentials from persisted log entries", () => {
  const entry = recordErrorLog({
    source: "test",
    message: "Bearer sk-secret-value password=hunter2 http://user:pass@proxy.example:8080",
  });
  assert.doesNotMatch(entry.message, /sk-secret-value|hunter2|user:pass/);
  assert.match(entry.message, /redacted/);
});

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});
