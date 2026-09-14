import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const sourceUrl = new URL("./useAgentSession.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const sourceFile = ts.createSourceFile(fileURLToPath(sourceUrl), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hook = sourceFile.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useAgentSession");
assert.ok(hook?.body, "useAgentSession must remain available for the callback behavior test");
const handleSend = hook.body.statements
  .filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations])
  .find((node) => ts.isIdentifier(node.name) && node.name.text === "handleSend");
assert.ok(handleSend?.initializer && ts.isCallExpression(handleSend.initializer));
const callback = handleSend.initializer.arguments[0];
assert.ok(ts.isArrowFunction(callback), "handleSend must provide a callback body");

// Execute the production callback and its actual module-level helpers, not a
// copied catch branch or a source regexp. Only React-owned closure state,
// transport and timers are injected. This is not a React lifecycle test.
const closureNames = [
  "agentRunningRef", "bashRunningRef", "sessionIdRef", "promptRunIdRef",
  "cancelEventStreamGrace", "resetStreamUpdates", "rpcPromptPendingRef",
  "collaborationModeRef", "tokenModeRef", "goalTextRef", "session",
  "injectedModeSignatureRef", "setMessages", "optimisticUserMessageKeyRef",
  "goalStateRef", "setGoalState", "goalLoopRunningRef", "setAgentRunning",
  "setAgentPhase", "dispatch", "pendingScrollToUserRef", "setPromptAnchorActive",
  "completionScrollAllowedRef", "isNew", "newSessionCwd", "newSessionModel",
  "ensuringNewSessionRef", "ensureNewSession", "promoteNewSession", "setPendingModel",
  "ensureEventsConnected", "waitForPromptSettlement", "closeEvents", "addNotice", "opts",
  "delay",
];
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const preamble = sourceFile.statements.filter((node) => node !== hook).map((node) => node.getText(sourceFile)).join("\n");
const { createHandleSend } = await jiti.evalModule(
  `${preamble}\nexport function createHandleSend({ ${closureNames.join(", ")} }) { return ${callback.getText(sourceFile)}; }`,
  { filename: fileURLToPath(sourceUrl) },
);
const { AgentCommandTimeoutError } = await jiti.import("../lib/agent-client.ts");

const image = Object.freeze({ data: "AQID", mimeType: "image/png", previewUrl: "blob:submitted-image" });
const wireImage = { type: "image", data: image.data, mimeType: image.mimeType };
const historyImage = { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
const originalMessage = Object.freeze({ role: "assistant", content: "earlier reply", timestamp: 1 });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rejectedResponse() {
  return response({ error: "Model does not support image input", code: "prompt_rejected", accepted: false }, 422);
}

function createHarness(t, options = {}) {
  const ref = (current) => ({ current });
  const state = {
    messages: [originalMessage],
    agentRunning: false,
    phase: null,
    streaming: false,
    restored: [],
    notices: [],
  };
  const requests = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/agent/test-session", "unexpected fetch must not reach the network");
    assert.equal(init?.method, "POST");
    requests.push(JSON.parse(init.body));
    return options.transport ? options.transport(requests.at(-1)) : response({ success: true, data: {} });
  });
  const setState = (key) => (value) => {
    state[key] = typeof value === "function" ? value(state[key]) : value;
  };
  const deps = {
    agentRunningRef: ref(false),
    bashRunningRef: ref(false),
    sessionIdRef: ref(options.isNew ? null : "test-session"),
    promptRunIdRef: ref(0),
    cancelEventStreamGrace: t.mock.fn(),
    resetStreamUpdates: t.mock.fn(),
    rpcPromptPendingRef: ref(false),
    collaborationModeRef: ref("normal"),
    tokenModeRef: ref("full"),
    goalTextRef: ref(null),
    session: options.isNew ? null : { id: "test-session", cwd: "/test/project" },
    injectedModeSignatureRef: ref({ sessionKey: "", signature: "" }),
    setMessages: setState("messages"),
    optimisticUserMessageKeyRef: ref(null),
    goalStateRef: ref({ status: "idle" }),
    setGoalState: t.mock.fn(),
    goalLoopRunningRef: ref(false),
    setAgentRunning: setState("agentRunning"),
    setAgentPhase: setState("phase"),
    dispatch: (action) => { state.streaming = action.type === "start"; },
    pendingScrollToUserRef: ref(false),
    setPromptAnchorActive: t.mock.fn(),
    completionScrollAllowedRef: ref(false),
    isNew: options.isNew ?? false,
    newSessionCwd: options.isNew ? "/test/project" : null,
    newSessionModel: null,
    ensuringNewSessionRef: ref(null),
    ensureNewSession: t.mock.fn(options.ensureNewSession ?? (async () => "test-session")),
    promoteNewSession: t.mock.fn(),
    setPendingModel: t.mock.fn(),
    ensureEventsConnected: t.mock.fn(async () => true),
    waitForPromptSettlement: t.mock.fn(async () => {}),
    closeEvents: t.mock.fn(),
    addNotice: (notice) => state.notices.push(notice),
    opts: {
      chatInputRef: {
        current: {
          ...(options.legacyInput ? {} : {
            restoreSubmission: t.mock.fn((message) => state.restored.push(message)),
          }),
          replaceMessage: t.mock.fn((message) => state.restored.push(message)),
        },
      },
    },
    // Leave the fallback pending: the mocked SSE handshake wins the race.
    // No 4-second timer, external connection, or background poll is created.
    delay: () => new Promise(() => {}),
  };
  return { state, deps, requests, send: createHandleSend(deps) };
}

test("should_send_plain_text_when_prompt_is_accepted", async (t) => {
  const h = createHarness(t);
  await h.send("hello");
  assert.deepEqual(h.requests, [{ type: "prompt", message: "hello" }]);
});

test("should_send_images_in_api_shape_when_prompt_is_accepted", async (t) => {
  const h = createHarness(t);
  await h.send("inspect", [image]);
  assert.deepEqual(h.requests, [{ type: "prompt", message: "inspect", images: [wireImage] }]);
});

test("should_ignore_empty_submission_when_text_and_images_are_absent", async (t) => {
  const h = createHarness(t);
  await h.send("  ", []);
  assert.deepEqual(h.requests, []);
});

test("should_not_poll_settlement_when_server_explicitly_rejects_prompt", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.equal(h.deps.waitForPromptSettlement.mock.callCount(), 0);
});

test("should_restore_original_text_and_images_when_server_rejects_prompt", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.restored.map(({ role, content }) => ({ role, content })), [{
    role: "user",
    content: [{ type: "text", text: "inspect" }, historyImage],
  }]);
});

test("should_prefer_merge_restore_handle_when_composer_supports_submission_recovery", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.deepEqual({
    mergeCalls: h.deps.opts.chatInputRef.current.restoreSubmission.mock.callCount(),
    replaceCalls: h.deps.opts.chatInputRef.current.replaceMessage.mock.callCount(),
  }, { mergeCalls: 1, replaceCalls: 0 });
});

test("should_fall_back_to_replace_message_when_composer_has_a_legacy_handle", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse, legacyInput: true });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.restored.map(({ content }) => content), [[{ type: "text", text: "inspect" }, historyImage]]);
});

test("should_restore_plain_text_when_server_rejects_prompt_without_images", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect");
  assert.deepEqual(h.state.restored.map(({ content }) => content), ["inspect"]);
});

test("should_restore_image_only_submission_when_server_rejects_prompt", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("", [image]);
  assert.deepEqual(h.state.restored.map(({ content }) => content), [[historyImage]]);
});

test("should_remove_only_the_optimistic_message_when_server_rejects_prompt", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.messages, [originalMessage]);
});

test("should_release_running_state_when_server_rejects_prompt", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.deepEqual({
    pending: h.deps.rpcPromptPendingRef.current,
    running: h.deps.agentRunningRef.current,
    visibleRunning: h.state.agentRunning,
    streaming: h.state.streaming,
    phase: h.state.phase,
  }, { pending: false, running: false, visibleRunning: false, streaming: false, phase: null });
});

test("should_surface_server_reason_when_prompt_is_explicitly_rejected", async (t) => {
  const h = createHarness(t, { transport: rejectedResponse });
  await h.send("inspect", [image]);
  assert.equal(h.state.notices.some((notice) => notice.type === "error" && notice.message.includes("Model does not support image input")), true);
});

for (const [label, transport] of [
  ["network_failure", () => { throw new TypeError("Failed to fetch"); }],
  ["timeout", () => { throw new AgentCommandTimeoutError("Timed out", "prompt", 30_000); }],
  ["unclassified_http_failure", () => response({ error: "upstream unavailable" }, 503)],
  ["accepted_error", () => response({ error: "response lost", code: "prompt_rejected", accepted: true }, 502)],
  ["missing_acceptance_flag", () => response({ error: "ambiguous", code: "prompt_rejected" }, 502)],
]) {
  test(`should_preserve_settlement_poll_when_delivery_has_${label}`, async (t) => {
    const h = createHarness(t, { transport });
    await h.send("inspect", [image]);
    assert.deepEqual(h.deps.waitForPromptSettlement.mock.calls.map(({ arguments: args }) => args), [["test-session", 1]]);
  });
}

test("should_not_restore_submission_when_network_failure_leaves_delivery_uncertain", async (t) => {
  const h = createHarness(t, { transport: () => { throw new TypeError("Failed to fetch"); } });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.restored, []);
});

test("should_keep_optimistic_message_when_network_failure_leaves_delivery_uncertain", async (t) => {
  const h = createHarness(t, { transport: () => { throw new TypeError("Failed to fetch"); } });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.messages.map(({ role, content }) => ({ role, content })), [
    { role: "assistant", content: "earlier reply" },
    { role: "user", content: [{ type: "text", text: "inspect" }, historyImage] },
  ]);
});

test("should_restore_submission_when_session_creation_fails_before_prompt_post", async (t) => {
  const h = createHarness(t, {
    isNew: true,
    ensureNewSession: async () => { throw new Error("session creation failed"); },
  });
  await h.send("inspect", [image]);
  assert.deepEqual(h.state.restored.map(({ content }) => content), [[{ type: "text", text: "inspect" }, historyImage]]);
});

test("should_skip_settlement_poll_when_session_creation_fails_before_prompt_post", async (t) => {
  const h = createHarness(t, {
    isNew: true,
    ensureNewSession: async () => { throw new Error("session creation failed"); },
  });
  await h.send("inspect", [image]);
  assert.equal(h.deps.waitForPromptSettlement.mock.callCount(), 0);
});
