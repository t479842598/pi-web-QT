import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-structure assertions for the remote/mobile resilience wiring
// (matches the convention used by useAgentSession.loadSession-retry.test.mjs:
// the hook body cannot be executed outside React, so the load-bearing wiring
// is asserted against the source instead).
const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

function slice(fromMarker, toMarker) {
  const start = source.indexOf(fromMarker);
  assert.ok(start !== -1, `marker not found: ${fromMarker}`);
  const end = toMarker ? source.indexOf(toMarker, start) : source.length;
  assert.ok(end !== -1, `marker not found: ${toMarker}`);
  return source.slice(start, end);
}

test("loadContext bounds the pagination fetch with a timeout and one retry", () => {
  const block = slice("const loadContext = useCallback", "const handleExtensionUiRequest = useCallback");

  assert.match(block, /setTimeout\(\(\) => timeoutController\.abort\(\), 30_000\)/);
  // First attempt's AbortError is swallowed and retried exactly once.
  assert.match(
    block,
    /if \(!\(e instanceof DOMException && e\.name === "AbortError"\)\) throw e;[\s\S]*?res = await fetchPage\(timeoutController\.signal\);/,
  );
  const fetchCalls = block.match(/await fetchPage\(timeoutController\.signal\)/g) ?? [];
  assert.equal(fetchCalls.length, 2, "initial attempt plus exactly one retry");
});

test("loadContext drops pages that straddle a full message reload", () => {
  const loadContext = slice("const loadContext = useCallback", "const handleExtensionUiRequest = useCallback");
  assert.match(loadContext, /const epoch = historyEpochRef\.current/);
  assert.match(
    loadContext,
    /historyEpochRef\.current !== epoch\) return;/,
    "stale epoch must drop the response",
  );

  // loadSession must bump the epoch wherever it replaces the tail window or
  // clears it on 404 — both invalidate any in-flight pagination page.
  const loadSession = slice("const loadSession = useCallback", "const addNotice = useCallback");
  const bumps = loadSession.match(/historyEpochRef\.current \+= 1/g) ?? [];
  assert.equal(bumps.length, 2, "epoch bumped on the tail-window swap and on the 404 clear");
});

test("loadContext surfaces pagination failures as a readable notice", () => {
  const block = slice("const loadContext = useCallback", "const handleExtensionUiRequest = useCallback");
  assert.match(block, /Failed to load earlier messages/);
  // The notice must not fire for a session the user already left.
  assert.match(block, /sessionIdRef\.current === sid && historyEpochRef\.current === epoch/);
});

test("direct SSE frames refresh the zombie detector timestamp", () => {
  const connect = slice("const connectEvents = useCallback", "const ensureEventsConnected = useCallback");
  // Connection start is treated as fresh; every received frame (heartbeats
  // included) refreshes the timestamp.
  assert.match(connect, /lastEventFrameAtRef\.current = Date\.now\(\)/);
  assert.match(connect, /es\.onmessage = \(e\) => \{\s*\n\s*lastEventFrameAtRef\.current = Date\.now\(\);/);
});

test("ensureEventsConnected rebuilds a half-open zombie connection", () => {
  const block = slice("const ensureEventsConnected = useCallback", "const respondToExtensionUi = useCallback");
  // An OPEN transport with no frame for ~3 heartbeat periods is rebuilt
  // instead of trusted.
  assert.match(block, /EVENT_STREAM_ZOMBIE_MS/);
  assert.match(block, /closeEvents\(\)/);
});

test("a per-tick zombie sweep rebuilds the stream mid-run", () => {
  const block = slice("// Half-open SSE sweep", "agentRunningRef.current = agentRunning;");
  assert.match(block, /source\.readyState !== EventSource\.OPEN\) return;/);
  assert.match(block, /EVENT_STREAM_ZOMBIE_MS/);
  assert.match(block, /void connectEvents\(sid\)/);
  assert.match(block, /AGENT_STATE_RECONCILE_MS/);
});

test("reconcile fetch is time-bounded and escalates after repeated failures", () => {
  const block = slice("const reconcileAgentState = useCallback", "// Recovery net for missed SSE events");
  assert.match(block, /RECONCILE_FETCH_TIMEOUT_MS/);
  assert.match(block, /reconcileFailuresRef\.current = 0/, "success resets the counter");
  assert.match(block, /reconcileFailuresRef\.current \+= 1/);
  assert.match(block, /RECONCILE_MAX_FAILURES/);
  assert.match(block, /Cannot reach the pi-web service/);
  assert.match(block, /settleUiStage\(\)/);
});

test("the reconcile net wakes on pageshow and focus in addition to visibility", () => {
  const block = slice("// Recovery net for missed SSE events", "// Half-open SSE sweep");
  assert.match(block, /addEventListener\("pageshow"/);
  assert.match(block, /addEventListener\("focus"/);
  assert.match(block, /removeEventListener\("pageshow"/);
  assert.match(block, /removeEventListener\("focus"/);
});

test("zombie threshold and reconcile constants are documented and bounded", () => {
  assert.match(source, /const EVENT_STREAM_ZOMBIE_MS = 95_000/);
  assert.match(source, /const RECONCILE_FETCH_TIMEOUT_MS = 10_000/);
  assert.match(source, /const RECONCILE_MAX_FAILURES = 3/);
});
