import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentCommandError, AgentCommandTimeoutError, AGENT_COMMAND_DEFAULT_TIMEOUT_MS, isPromptRejectedError, resolveAgentCommandTimeoutMs, sendAgentCommand } = await jiti.import("./agent-client.ts");

test("agent command HTTP rejections are distinguishable from transport failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: "Authentication failed",
      code: "prompt_rejected",
      accepted: false,
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error instanceof AgentCommandError, true);
      assert.equal(error.status, 500);
      assert.equal(error.message, "Authentication failed");
      assert.equal(error.code, "prompt_rejected");
      assert.equal(error.accepted, false);
      assert.equal(isPromptRejectedError(error), true);
      return true;
    },
  );

  const transportError = new TypeError("connection reset");
  globalThis.fetch = async () => {
    throw transportError;
  };

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error, transportError);
      assert.equal(error instanceof AgentCommandError, false);
      assert.equal(isPromptRejectedError(error), false);
      return true;
    },
  );
});

test("only an explicit negative prompt acknowledgement is definitive", () => {
  assert.equal(
    isPromptRejectedError(new AgentCommandError("proxy failure", 502)),
    false,
  );
  assert.equal(
    isPromptRejectedError(new AgentCommandError("generic API failure", 500, "internal_error", false)),
    false,
  );
});

test("agent command timeout defaults to 30s and honors per-command overrides", () => {
  assert.equal(AGENT_COMMAND_DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(resolveAgentCommandTimeoutMs({ type: "get_tools" }, {}), 30_000);
  assert.equal(resolveAgentCommandTimeoutMs({}, {}), 30_000);
  assert.equal(resolveAgentCommandTimeoutMs({ type: "get_tools" }, { timeoutMs: 1234 }), 1234);
});

test("blocking commands (compact/bash) are unbounded by default", () => {
  assert.equal(resolveAgentCommandTimeoutMs({ type: "compact" }, {}), 0);
  assert.equal(resolveAgentCommandTimeoutMs({ type: "bash", command: "make" }, {}), 0);
  assert.equal(resolveAgentCommandTimeoutMs({ type: "abort" }, {}), 30_000, "aborts must stay bounded");
  // An explicit caller override always wins, even for unbounded commands.
  assert.equal(resolveAgentCommandTimeoutMs({ type: "compact" }, { timeoutMs: 5000 }), 5000);
});

test("agent command success returns body.data", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(
    JSON.stringify({ success: true, data: { tools: [] } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  const data = await sendAgentCommand("session-id", { type: "get_tools" });
  assert.deepEqual(data, { tools: [] });
});

test("agent command aborts the fetch and reports the command type on timeout", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let observedSignal = null;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    observedSignal = init.signal;
    init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
  });

  await assert.rejects(
    sendAgentCommand("session-id", { type: "get_session_stats" }, { timeoutMs: 20 }),
    (error) => {
      assert.equal(error instanceof AgentCommandTimeoutError, true);
      assert.equal(error.commandType, "get_session_stats");
      assert.equal(error.timeoutMs, 20);
      return true;
    },
  );
  assert.equal(observedSignal?.aborted, true, "fetch must receive an aborted signal");
});

test("unbounded commands never arm an abort timer", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let observedSignal = null;
  let resolveFetch;
  globalThis.fetch = (url, init) => new Promise((resolve) => {
    observedSignal = init.signal;
    resolveFetch = () => resolve(new Response(
      JSON.stringify({ success: true, data: "late" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  });

  const pending = sendAgentCommand("session-id", { type: "compact" }, { timeoutMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(observedSignal, undefined, "unbounded command must not pass an abort signal at all");
  resolveFetch();
  assert.equal(await pending, "late");
});
