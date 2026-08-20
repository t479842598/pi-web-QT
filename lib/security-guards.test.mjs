import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-level guards for the P0 security hardening (project convention for
// route tests: assert the protective code paths exist — see
// provider-api-key-route.test.mjs).

test("task settings PUT gates command registration behind allowed roots + project trust", async () => {
  const source = await readFile(new URL("../app/api/tasks/settings/route.ts", import.meta.url), "utf8");

  assert.match(source, /getAllowedFileRoots\(\)/, "must resolve allowed roots");
  assert.match(source, /isFilePathAllowed\(body\.projectRoot, allowedRoots\)/, "unknown roots rejected");
  assert.match(source, /getProjectTrustStatus\(body\.projectRoot/, "command registration requires trust");
  assert.match(source, /initCommand/, "initCommand covered");
  assert.match(source, /preflightCommand/, "preflightCommand covered");
});

test("task engine never builds git commands as shell strings", async () => {
  const source = await readFile(new URL("../lib/task-engine.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /runShellIn\([^)]*`git /, "no shell-built git invocation (runShellIn)");
  assert.doesNotMatch(source, /runShellCapture\([^)]*`git /, "no shell-built git invocation (runShellCapture)");
  assert.match(source, /spawn\("git", args/, "git runs via array-arg spawn");
  // initCommand / preflightCommand remain shell-by-design (user-configured).
  assert.match(source, /runShellIn\(worktreePath, settings\.initCommand\)/);
});

test("proxy skips dev basic-auth only for loopback hosts", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.match(source, /isLoopbackHost/, "loopback host detection exists");
  assert.match(source, /skipAuth = isDev && isLoopbackHost/, "dev skip requires loopback");
});

test("agent SSE routes guard every controller write behind try/catch", async () => {
  const events = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  const running = await readFile(new URL("../app/api/agent/running/events/route.ts", import.meta.url), "utf8");

  // The main event path must not be able to throw into wrapper.emit() —
  // unguarded enqueue previously starved other listeners and could skip
  // message persistence in the SDK dispatch path.
  assert.match(events, /try \{ encode\(clientEvent\); \} catch/, "clientEvent encode guarded");
  assert.match(events, /try \{ encode\(pendingUpdate\); \} catch/, "coalesced update encode guarded");
  assert.match(events, /try \{ controller\.close\(\); \} catch/, "cleanup close guarded");
  assert.match(running, /try \{ encode\(\{ type: "running"/, "running snapshot encode guarded");
});

test("rpc-manager isolates event listeners from each other", async () => {
  const source = await readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8");
  const emitBody = source.match(/private emit\(event: AgentEvent\): void \{[\s\S]*?\n  \}/);
  assert.ok(emitBody, "emit() exists");
  assert.match(emitBody[0], /try \{/, "per-listener try/catch isolation");
});

test("useDeepSeekBalance keeps the refresh callback referentially stable", async () => {
  const source = await readFile(new URL("../hooks/useDeepSeekBalance.ts", import.meta.url), "utf8");

  assert.match(source, /balanceRef = useRef/, "balance read through a ref");
  assert.match(source, /\}, \[\]\);/, "refresh useCallback has empty deps");
  assert.match(source, /sameDeepSeekBalance/, "field-level comparison gates setState");
});

test("failed queue sends roll back the optimistic running flag", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

  assert.match(source, /rollbackFailedQueueSend/, "rollback helper exists");
  const steerBody = source.match(/const handleSteer = useCallback[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(steerBody && /void rollbackFailedQueueSend\(sid\)/.test(steerBody[0]), "steer failure rolls back");
});
