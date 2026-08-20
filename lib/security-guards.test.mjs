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

// ─── P2 server robustness guards ────────────────────────────────────────────

test("session DELETE reparents children atomically after shutting down their wrappers", async () => {
  const source = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");

  const deleteBody = source.match(/export async function DELETE[\s\S]*$/);
  assert.ok(deleteBody, "DELETE handler exists");
  const body = deleteBody[0];
  // Wrapper shutdown must happen BEFORE the rewrite so late appends are not lost.
  assert.ok(
    body.indexOf("getRpcSession(preview.id)?.shutdown()") < body.indexOf("readFileSync(childPath"),
    "child wrapper shutdown precedes the file rewrite",
  );
  assert.match(body, /renameSync\(tmpPath, childPath\)/, "atomic tmp+rename rewrite");
  assert.match(body, /invalidateOpenSessionCache\(childPath\)/, "child cache invalidated");
  assert.match(body, /listAllSessions\(\)/, "cross-directory children discovered via session list");
});

test("files GET applies realpath containment for root-allowed paths", async () => {
  const source = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");

  assert.match(source, /function isRealpathContained\(/, "helper exists");
  assert.match(source, /allowedByRoot && !isRealpathContained\(filePath, allowedRoots\)/, "GET enforces containment");
  assert.match(source, /fs\.realpathSync\(filePath\)/, "target resolved");
});

test("rpc-manager send() refuses commands on a dead wrapper and startup reuses no mid-shutdown wrapper", async () => {
  const source = await readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /if \(!this\._alive\) throw new Error\("Session is shutting down"\)/, "send() alive guard");
  assert.match(source, /isAlive\(\) && !existing\.isShuttingDown\(\)/, "fast path is shutdown-aware");
  assert.match(source, /await existing\.whenShutdown\(\)/, "waits out in-progress shutdown");
  assert.match(source, /try \{ inner\.dispose\(\); \} catch/, "startup error path disposes inner session");
});

test("task engine periodic reconcile cannot crash the process", async () => {
  const source = await readFile(new URL("../lib/task-engine.ts", import.meta.url), "utf8");
  const timerBody = source.match(/reconcileTimer = setInterval\(\(\) => \{[\s\S]*?\}, 30_000\)/);
  assert.ok(timerBody, "reconcile timer exists");
  assert.match(timerBody[0], /\.catch\(/, "rejection caught");
});

test("usage route caches per-session summaries keyed by file stat", async () => {
  const source = await readFile(new URL("../app/api/usage/route.ts", import.meta.url), "utf8");

  assert.match(source, /__piUsageSummaryCache/, "global cache exists");
  assert.match(source, /hit\.mtimeMs === mtimeMs && hit\.size === size/, "stat-keyed invalidation");
});

// ─── P3 consistency guards ──────────────────────────────────────────────────

test("state_sync only dispatches start on the idle→running transition", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const block = source.match(/case "state_sync": \{[\s\S]*?break;\n      \}/);
  assert.ok(block, "state_sync handler exists");
  assert.match(block[0], /const wasRunning = agentRunningRef\.current;/, "captures prior running state");
  assert.match(block[0], /if \(!wasRunning\) dispatch\(\{ type: "start" \}\)/, "start guarded by transition");
});

test("completion notification is deduped across chained runs", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

  assert.match(source, /stageNotifiedRef = useRef\(false\)/, "stage flag exists");
  const settled = source.match(/case "agent_settled": \{[\s\S]*?break;\n      \}/);
  assert.ok(settled, "agent_settled handler exists");
  assert.match(settled[0], /if \(wasRunning && !stageNotifiedRef\.current\) onAgentEnd\?\.\(\)/, "agent_settled respects the flag");
  const agentStart = source.match(/case "agent_start":[\s\S]*?break;/);
  assert.ok(agentStart && /if \(!agentRunningRef\.current\) stageNotifiedRef\.current = false;/.test(agentStart[0]), "agent_start arms a fresh stage only from idle");
});

test("agent_end state fetch is guarded against newer runs", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const block = source.match(/case "agent_end": \{[\s\S]*?break;\n      \}/);
  assert.ok(block, "agent_end handler exists");
  assert.match(block[0], /runIdAtEnd = promptRunIdRef\.current/, "captures run id");
  assert.match(block[0], /if \(promptRunIdRef\.current !== runIdAtEnd\) return;/, "drops stale snapshots");
});

test("all queue-mutating commands run under the mutation lock", async () => {
  const source = await readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8");
  for (const command of ["clear_queue", "resolve_recovery", "import_queue", "stage_recovery"]) {
    const block = source.match(new RegExp(`case "${command}": \\{[\\s\\S]*?\\n      \\}`));
    assert.ok(block, `${command} handler exists`);
    assert.match(block[0], /withQueueMutation/, `${command} must hold the queue lock`);
  }
});

test("ChatWindow unregisters the global abort handler on unmount", async () => {
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const block = source.match(/Register the abort handler[\s\S]*?\}\);/);
  assert.ok(block, "abort registration effect exists");
  assert.match(block[0], /return \(\) => registerAbortHandler\(null\)/, "cleanup clears the handler");
});

test("proxy matches every path and scopes the static shortcut to development", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /matcher: \["\/:path\*"\]/, "matcher covers all paths");
  assert.match(source, /NODE_ENV === "development"\s*&&\s*request\.nextUrl\.pathname\.startsWith\("\/_next\/static\/"\)/, "static shortcut dev-only");
});

test("export timeout scales with session file size", async () => {
  const source = await readFile(new URL("../app/api/sessions/[id]/export/route.ts", import.meta.url), "utf8");
  assert.match(source, /statSync\(filePath\)\.size/, "reads file size");
  assert.match(source, /Math\.min\(300_000, 60_000/, "bounded scaled timeout");
});

test("worktree removal revokes the file-access allow-root", async () => {
  const source = await readFile(new URL("../lib/worktree.ts", import.meta.url), "utf8");
  assert.match(source, /disallowFileRoot\(worktreePath\)/, "removeWorktree revokes the root");
  const roots = await readFile(new URL("../lib/allowed-roots.ts", import.meta.url), "utf8");
  assert.match(roots, /export function disallowFileRoot/, "disallowFileRoot exists");
});
