import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC validates image arrays before sending prompt, steer, or follow-up commands", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(
    source.indexOf("  async send(command:"),
    source.indexOf("    switch (type) {", source.indexOf("  async send(command:")),
  );

  assert.match(sendSource, /type === "prompt" \|\| type === "steer" \|\| type === "follow_up"/);
  assert.match(sendSource, /validateAgentImages\(command\.images\)/);
});

test("queue item edits serialize rebuilds and reconcile from pi's live queue", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /private queueMutationTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /private async withQueueMutation<T>\(operation: \(\) => Promise<T>\)/);
  assert.match(source, /private async mutateLiveQueue<T>\(kind: QueueKind/);
  assert.match(source, /this\.reconcileQueue\(queues\.steering, queues\.followUp\)/);
  assert.match(source, /await this\.mutateLiveQueue\(kind/);
});

test("queue import, staging, and requeue validate attached images", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /type === "requeue_at"/);
  assert.match(source, /private validateQueueEntries\(entries: QueueEntryInput\[\]\)/);
  assert.match(source, /this\.validateQueueEntries\(entries\);/);
  assert.match(source, /const imageError = validateAgentImages\(entry\.images\)/);
});

test("custom extension UI receives the headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
  assert.match(customUiSource, /emitCustomUiRender/);
});

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC startup opens an existing session once and uses its canonical cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const commandRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventsRoute = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  assert.match(startupSource, /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/);
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.doesNotMatch(commandRoute, /SessionManager\.open\(/);
  assert.doesNotMatch(eventsRoute, /SessionManager\.open\(/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");

  assert.match(source, /void this\.shutdown\(\)\.catch/);
  assert.match(source, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("running state exposes snapshots and an SSE subscription route", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/agent/running/events/route.ts", import.meta.url), "utf8");
  assert.match(source, /export function getRunningRpcSessionSnapshots/);
  assert.match(source, /export function subscribeRunningSessions/);
  assert.match(source, /notifyRunningChange\(\)/);
  assert.match(route, /subscribeRunningSessions/);
  assert.match(route, /runningSessionIds/);
});

test("running-state broadcasts dedupe identical snapshots to avoid SSE flooding", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const notifySource = source.slice(
    source.indexOf("let lastRunningSnapshot = \"\""),
    source.indexOf("export function getRunningRpcSessionIds"),
  );
  assert.match(notifySource, /let lastRunningSnapshot = ""/);
  assert.match(notifySource, /const serialized = JSON\.stringify\(snapshots\)/);
  assert.match(notifySource, /if \(serialized === lastRunningSnapshot\) return/);
  assert.match(notifySource, /lastRunningSnapshot = ""/);
});

test("session bus exposes subscribe/unsubscribe and whitelist forwarding", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /export type SessionBusEvent =/);
  assert.match(source, /export function subscribeSessionBus/);
  assert.match(source, /export function getSessionBusListenersCount/);
  assert.match(source, /const SESSION_BUS_EVENT_TYPES = new Set\(/);
  // The wrapper's inner.subscribe callback forwards whitelisted events to the bus.
  const startSource = source.slice(
    source.indexOf("    this.unsubscribe = this.inner.subscribe("),
    source.indexOf("  loadQueueRecovery(): void"),
  );
  assert.match(startSource, /SESSION_BUS_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /broadcastSessionBusEvent\(event\.type, this\.sessionId, event\)/);
});

test("session bus is zero-cost without subscribers and coalesces message_update", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const busSource = source.slice(
    source.indexOf("// ─── Cross-client session event bus ───"),
    source.indexOf("/**\n * Get or create an AgentSession"),
  );

  // Zero cost: both publish helpers bail out before iterating when nobody listens.
  assert.match(busSource, /if \(!listeners \|\| listeners\.size === 0\) return/);
  // Whitelist gate sits before any delivery.
  assert.match(busSource, /if \(type !== "message_update"\)/);
  assert.match(busSource, /publishSessionBus\(\{ type, sessionId, payload \}\)/);
  // Streaming updates are coalesced per sessionId in a timer window.
  assert.match(busSource, /const busCoalesceState = new Map</);
  assert.match(busSource, /SESSION_BUS_COALESCE_MS/);
  assert.match(busSource, /clearTimeout\(existing\.timer\)/);
});

test("steer and follow_up clear the running phase on completion", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const steerSource = source.slice(
    source.indexOf('case "steer":'),
    source.indexOf('case "follow_up":'),
  );
  const followUpSource = source.slice(
    source.indexOf('case "follow_up":'),
    source.indexOf('case "get_tools":'),
  );
  // Phase set before the turn, cleared in finally so the spinner does not linger.
  assert.match(steerSource, /this\.promptPhase = "waiting_model"/);
  assert.match(steerSource, /this\.promptPhase = null/);
  assert.match(steerSource, /finally \{/);
  assert.match(followUpSource, /this\.promptPhase = "waiting_model"/);
  assert.match(followUpSource, /this\.promptPhase = null/);
  assert.match(followUpSource, /finally \{/);
});

test("session bus whitelist includes agent_start and message_start", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const whitelist = source.slice(
    source.indexOf("const SESSION_BUS_EVENT_TYPES = new Set(["),
    source.indexOf("]);", source.indexOf("const SESSION_BUS_EVENT_TYPES = new Set([")),
  );
  // Without agent_start, a remote client only consuming the bus never sets
  // agentRunningRef and silently drops every message_update/message_end.
  assert.match(whitelist, /"agent_start"/);
  assert.match(whitelist, /"message_start"/);
  assert.match(whitelist, /"message_update"/);
  assert.match(whitelist, /"message_end"/);
});

test("goal commands, server-side continuation, and sidecar persistence are wired", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  // Goal engine lives on the wrapper and is rehydrated from the sidecar.
  assert.match(source, /private readonly goalEngine = new GoalEngine\(\)/);
  assert.match(source, /loadGoalState\(inner\.sessionFile\)/);
  assert.match(source, /goalEngine\.hydrate\(restored\)/);
  assert.match(source, /saveGoalState\(this\.sessionFile, this\.goalEngine\.getState\(\)\)/);

  // Commands are dispatched through the existing RPC switch.
  assert.match(source, /case "goal_start"/);
  assert.match(source, /case "goal_pause"/);
  assert.match(source, /case "goal_resume"/);
  assert.match(source, /case "goal_stop"/);
  assert.match(source, /case "goal_edit"/);
  assert.match(source, /case "get_goal_state"/);

  // Agent settlement drives the continuation server-side.
  assert.match(source, /handleGoalSettled\(\)/);
  assert.match(source, /this\.inner\.followUp\(GOAL_CONTINUE_INSTRUCTION\)/);
  assert.match(source, /goalContinuationInFlight/);

  // Authoritative state is broadcast to clients.
  assert.match(source, /goal_state_changed/);

  // get_state exposes the goal state for reload-time recovery.
  assert.match(source, /goalState: this\.goalEngine\.getState\(\)/);
});

test("async bash tools are injected via customTools and cleaned up on destroy", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAsyncBashTools\(asyncBashManager\)/);
  assert.match(startupSource, /new AsyncProcessManager\(\)/);
  assert.match(startupSource, /customTools: asyncBashTools/);
  assert.match(startupSource, /cleanupAsyncBash\(\)/);
  assert.match(source, /from "\.\/async-bash"/);
});
