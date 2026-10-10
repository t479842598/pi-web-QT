import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-approval-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { policyFromStrings } = await jiti.import("./permission.ts");
after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

function setup(t, policy = {}) {
  const forwarded = [];
  const originalResult = { block: false };
  const inner = {
    sessionId: "approval-fixture",
    isStreaming: false, isCompacting: false, isBashRunning: false,
    sessionManager: { getCwd: () => agentDir },
    agent: { state: {}, beforeToolCall: async (context) => {
      forwarded.push(context);
      return originalResult;
    } },
    subscribe: () => () => {},
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.setApprovalMode("ask");
  wrapper.setApprovalPolicy(policyFromStrings(policy));
  wrapper.start();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, inner, events, forwarded, originalResult };
}

for (const tool of ["bash", "powershell"]) {
  test(`${tool} waits for approval and rejection never reaches the downstream hook`, async (t) => {
    const { wrapper, inner, events, forwarded } = setup(t);
    const pending = inner.agent.beforeToolCall({ toolCall: { name: tool }, args: { command: "ls" } });
    const request = events.find((event) => event.type === "tool_approval_request");
    assert.ok(request);
    assert.equal(request.toolName, tool);
    assert.equal(forwarded.length, 0);
    assert.equal(wrapper.getPendingApprovals().length, 1);
    assert.deepEqual(await wrapper.send({ type: "resolve_approval", id: request.id, approve: false }), { resolved: true });
    assert.equal((await pending).block, true);
    assert.equal(forwarded.length, 0);
    assert.equal(wrapper.getPendingApprovals().length, 0);
  });
}

test("approval releases exactly one original call and duplicate replies do not replay it", async (t) => {
  const { wrapper, inner, events, forwarded, originalResult } = setup(t);
  const context = { toolCall: { name: "bash" }, args: { command: "git status" } };
  const pending = inner.agent.beforeToolCall(context);
  const request = events.find((event) => event.type === "tool_approval_request");
  assert.ok(request);
  assert.equal(forwarded.length, 0);
  await wrapper.send({ type: "resolve_approval", id: request.id, approve: true });
  assert.equal(await pending, originalResult);
  assert.deepEqual(forwarded, [context]);
  assert.deepEqual(await wrapper.send({ type: "resolve_approval", id: request.id, approve: true }), { resolved: false });
  assert.equal(forwarded.length, 1);
});

test("overlapping ask and allow still suspend the wrapper; deny bypasses neither", async (t) => {
  const { wrapper, inner, events, forwarded } = setup(t, { allow: ["bash"], ask: ["bash"] });
  wrapper.setApprovalMode("yolo");
  const context = { toolCall: { name: "bash" }, args: { command: "git status" } };
  const pending = inner.agent.beforeToolCall(context);
  const request = events.find((event) => event.type === "tool_approval_request");
  assert.ok(request);
  assert.equal(forwarded.length, 0);
  await wrapper.send({ type: "resolve_approval", id: request.id, approve: false });
  assert.equal((await pending).block, true);
  wrapper.setApprovalPolicy(policyFromStrings({ deny: ["bash"], ask: ["bash"], allow: ["bash"] }));
  assert.equal((await inner.agent.beforeToolCall(context)).block, true);
  assert.equal(forwarded.length, 0);
  assert.equal(events.filter((event) => event.type === "tool_approval_request").length, 1);
});

test("destroying a wrapper rejects its pending approval without forwarding", async (t) => {
  const { wrapper, inner, forwarded } = setup(t);
  const pending = inner.agent.beforeToolCall({ toolCall: { name: "bash" }, args: { command: "ls" } });
  assert.equal(wrapper.getPendingApprovals().length, 1);
  wrapper.destroy();
  assert.equal((await pending).block, true);
  assert.equal(forwarded.length, 0);
  assert.equal(wrapper.getPendingApprovals().length, 0);
});

test("dedicated reads and explicitly allowed shell commands still forward", async (t) => {
  const { wrapper, inner, events, forwarded, originalResult } = setup(t, { allow: ["Bash=command:git status"] });
  for (const [name, args] of [["read", { path: "fixture.txt" }], ["bash", { command: "git status" }]]) {
    assert.equal(await inner.agent.beforeToolCall({ toolCall: { name }, args }), originalResult);
  }
  assert.equal(forwarded.length, 2);
  assert.equal(wrapper.getPendingApprovals().length, 0);
  assert.equal(events.some((event) => event.type === "tool_approval_request"), false);
});
