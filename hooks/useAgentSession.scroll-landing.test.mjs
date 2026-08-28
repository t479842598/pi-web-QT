import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-structure assertions for the opened-session scroll landing fix
// (hook internals are asserted against source, see useAgentSession.test.mjs).
const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("settle poll is stopped only by a real user gesture, not by programmatic drift", () => {
  const start = source.indexOf("// Settle correction: virtual-list rows measure asynchronously");
  const end = source.indexOf("// Load model list", start);
  const settle = source.slice(start, end);

  assert.equal(
    /agentRunningRef\.current/.test(settle),
    false,
    "the agentRunning early exit is gone: the /state probe sets it before messages commit",
  );
  assert.equal(
    /isNearBottomRef\.current/.test(settle) || /completionScrollAllowedRef\.current/.test(settle),
    false,
    "the flag gate is gone: programmatic echoes poison those flags and killed the poll at its first tick",
  );
  // Intent-window + latch: a real gesture while away from the bottom stops
  // the landing for good; drift without a gesture does not.
  assert.match(settle, /let userInterrupted = false;/);
  assert.match(settle, /Date\.now\(\) < userScrollIntentUntilRef\.current/);
  assert.match(settle, /userInterrupted = true;/);
  assert.match(settle, /scrollToBottom\("instant"\)/);
});

test("settle keeps re-anchoring while growth continues (growth-driven exit)", () => {
  assert.match(source, /const OPEN_SETTLE_MAX_MS = 30_000/);
  const start = source.indexOf("// Settle correction: virtual-list rows measure asynchronously");
  const end = source.indexOf("// Load model list", start);
  const settle = source.slice(start, end);

  assert.match(settle, /stableRuns >= 4/, "2s without growth (4×500ms) is a real landing");
  assert.match(settle, /Date\.now\(\) - startedAt >= OPEN_SETTLE_MAX_MS/, "hard cap bounds the poll");
  assert.match(settle, /setTimeout\(tick, stableRuns > 0 \? 500 : 250\)/);
  // The poll must survive incoming messages: no messages.length dep, keyed per session.
  assert.match(settle, /settleStartedForRef\.current = settleKey;/);
  assert.doesNotMatch(settle, /\[loading, messages\.length/);
});

test("pointerdown outside the chat scroller does not arm the scroll-intent window", () => {
  const start = source.indexOf("const markUserScrollIntent = useCallback");
  const end = source.indexOf("const handleScrollPositionChange", start);
  const intent = source.slice(start, end);

  assert.match(intent, /event instanceof PointerEvent/);
  assert.match(intent, /!container\.contains\(event\.target\)/);
});
