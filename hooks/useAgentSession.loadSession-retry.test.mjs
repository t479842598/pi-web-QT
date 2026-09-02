import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-structure assertions for the mount-time running-state detection
// (matches the convention used by useAgentSession.test.mjs for hook internals:
// the hook body cannot be executed outside React, so the load-bearing wiring
// is asserted against the source instead).
const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("loadSession retries the message fetch once after a timeout abort", () => {
  const start = source.indexOf("const loadSession = useCallback");
  const end = source.indexOf("const loadContext = useCallback");
  const loadSessionSource = source.slice(start, end);

  assert.match(loadSessionSource, /const fetchSessionData = async/);
  assert.match(loadSessionSource, /setTimeout\(\(\) => \w+Controller\.abort\(\), 30000\)/);
  // First attempt's AbortError is swallowed and retried exactly once.
  assert.match(
    loadSessionSource,
    /if \(!\(e instanceof DOMException && e\.name === "AbortError"\)\) throw e;[\s\S]*?res = await fetchSessionData\(\);/,
  );
  // The retry must not loop: only one re-call of fetchSessionData exists.
  const retryCalls = loadSessionSource.match(/await fetchSessionData\(\)/g) ?? [];
  assert.equal(retryCalls.length, 2, "initial attempt plus exactly one retry");
});

test("mount effect probes running state in parallel with the message load", () => {
  const start = source.indexOf("// Load session on mount");
  const end = source.indexOf("// eslint-disable-next-line react-hooks/exhaustive-deps", start);
  const mountSource = source.slice(start, end);

  const probeStart = mountSource.indexOf("// 并行运行态探测");
  const probeEnd = mountSource.indexOf("loadSession(session.id, true, true)");
  assert.ok(probeStart !== -1 && probeEnd !== -1, "probe block must exist before loadSession");
  const probeSource = mountSource.slice(probeStart, probeEnd);
  assert.match(probeSource, /\/state/, "probe hits the state endpoint");
  assert.match(probeSource, /restoreRunning\(agentState\.state\)/);

  // restoreRunning applies exactly once per opened session.
  assert.match(mountSource, /if \(runningRestoredRef\.current\) return;/);
});

test("idle fallback retries are bounded (5 attempts, 2s apart)", () => {
  const start = source.indexOf("// 入口对账 + 自愈");
  const end = source.indexOf("return () => {", start);
  const fallbackSource = source.slice(start, end);

  assert.match(fallbackSource, /attempt < 5/);
  assert.match(fallbackSource, /setTimeout\(resolve, 2000\)/);
  assert.match(fallbackSource, /if \(agentRunningRef\.current\) return;/, "stop as soon as running");
  assert.match(fallbackSource, /restoreRunning\(snapshot\.state\)/);
});

test("loading mask has a hard finite watchdog independent of auxiliary state", () => {
  const start = source.indexOf("// Hard UI safety net");
  const end = source.indexOf("const loadContext = useCallback", start);
  const block = source.slice(start, end);
  assert.match(block, /setTimeout\(\(\) =>/);
  assert.match(block, /setLoading\(false\)/);
  assert.match(block, /Timed out loading this conversation/);
  assert.match(block, /sessionDetailsControllerRef\.current\?\.abort/);
});
