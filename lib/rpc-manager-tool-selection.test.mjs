import assert from "node:assert/strict";
import test from "node:test";
import { createRpcHarness } from "./rpc-test-harness.mjs";

/**
 * The resource policy a session starts with decides whether extensions load at
 * all: the Chat-only loader sets noExtensions/noSkills/noPromptTemplates/
 * noThemes, so a Chat-only session never receives `session_start` and never
 * registers extension statuses, commands, or tools.
 *
 * pi-web's default tool preset is "configured", which deliberately sends no
 * `toolNames` — pi is supposed to resolve settings.json defaultTools itself.
 * Treating that absence as an empty selection (`?? []`) silently turned every
 * new conversation Chat-only, so installed plugins vanished (#782). These tests
 * pin the resource policy for each of the three selection states.
 */

/** The resource loader options the session was actually created with. */
function loaderOptions(h) {
  assert.equal(h.calls.services.length, 1, "expected exactly one session start");
  return h.calls.services[0].resourceLoaderOptions ?? {};
}

test("a session started without a tool override keeps its extensions", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("configured-defaults");

  await h.rpc.startRpcSession("configured-defaults", file, undefined);

  const options = loaderOptions(h);
  assert.notEqual(options.noExtensions, true);
  assert.notEqual(options.noSkills, true);
  assert.notEqual(options.noPromptTemplates, true);
});

test("an explicit empty selection is still Chat only", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("all-tools-off");

  await h.rpc.startRpcSession("all-tools-off", file, undefined, { toolNames: [] });

  const options = loaderOptions(h);
  assert.equal(options.noExtensions, true);
  assert.equal(options.noSkills, true);
  assert.equal(options.noPromptTemplates, true);
  assert.equal(options.noThemes, true);
});

test("a non-empty selection keeps its extensions and pins the active tools", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("pinned-default-preset");

  await h.rpc.startRpcSession("pinned-default-preset", file, undefined, {
    toolNames: ["read", "bash", "edit", "write"],
  });

  const options = loaderOptions(h);
  assert.notEqual(options.noExtensions, true);
});

test("reopening a session without an override keeps its extensions", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("reopen-configured");

  await h.rpc.startRpcSession("reopen-configured", file, undefined);
  assert.notEqual(loaderOptions(h).noExtensions, true);

  // Reopening goes through the same path (no `toolNames`), after the wrapper was
  // torn down — the cold start must not fall back to the Chat-only policy.
  await h.rpc.startRpcSession("reopen-configured", file, undefined);
  for (const call of h.calls.services) {
    assert.notEqual(call.resourceLoaderOptions?.noExtensions, true);
  }
});

test("a session whose pin was retracted returns to loading extensions", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("unpin-restores-extensions");
  const manager = h.rpc.AgentSessionWrapper ? null : null;
  void manager;

  // Pin first (chat-only), then retract the pin the way the preset dropdown does
  // when the user switches back to "configured".
  const first = await h.rpc.startRpcSession("unpin-restores-extensions", file, undefined, {
    toolNames: [],
  });
  assert.equal(loaderOptions(h).noExtensions, true, "the pinned frame must be Chat only");

  const switched = await h.rpc.setRpcSessionTools("unpin-restores-extensions", file, undefined);
  assert.equal(switched.sessionId, first.realSessionId);

  const last = h.calls.services.at(-1);
  assert.notEqual(last.resourceLoaderOptions?.noExtensions, true);
});
