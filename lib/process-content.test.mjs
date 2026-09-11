import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// This module now has runtime cross-imports (subagent-tool-details), and the
// strip-types loader cannot resolve those without an extension — load through
// jiti like the other lib tests.
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./process-content.ts");
}

function assistant(content, timestamp = 1000) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    timestamp,
    content,
  };
}

test("converts Pi blocks without mutating the session message", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "Inspect the repository" },
    { type: "toolCall", toolCallId: "call-1", toolName: "read_file", input: { path: "README.md" } },
  ]);
  const snapshot = structuredClone(message);

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 4,
    entryId: "entry-4",
    phase: "process",
  });

  assert.deepEqual(message, snapshot);
  assert.deepEqual(blocks.map((block) => block.type), ["thinking", "toolCall"]);
  assert.equal(blocks[0].origin.sourceEntryId, "entry-4");
  assert.equal(blocks[1].origin.groupId, "call-1");
  assert.equal(blocks[1].status, "running");
});

test("pairs tool results and preserves error state and duration", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const result = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    timestamp: 6200,
    isError: true,
    content: [{ type: "text", text: "command failed" }],
  };
  const blocks = messageToProcessContentBlocks(
    assistant([{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} }], 1000),
    {
      messageIndex: 1,
      phase: "process",
      toolResults: new Map([["call-1", result]]),
    },
  );

  assert.equal(blocks[0].type, "toolCall");
  assert.equal(blocks[0].result, result);
  assert.equal(blocks[0].status, "error");
  assert.equal(blocks[0].duration, 5);
});

test("keeps source block indices for deferred thinking", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "", deferred: true },
    { type: "text", text: "Final answer" },
  ]);

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 2,
    entryId: "assistant-entry",
    phase: "process",
    blocks: [message.content[0]],
  });

  assert.equal(blocks[0].type, "thinking");
  assert.equal(blocks[0].deferred, true);
  assert.equal(blocks[0].origin.sourceBlockIndex, 0);
});

test("converts visible custom messages into process blocks", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = {
    role: "custom",
    customType: "status",
    display: true,
    content: "Checking dependencies",
  };

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 3,
    entryId: "custom-entry",
    phase: "process",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "custom");
  assert.equal(blocks[0].origin.phase, "process");
});

// ── Subagent hoisting (splitProcessSegments) ────────────────────────────────

function toolCallBlock(overrides = {}) {
  return {
    id: "b1",
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "Agent",
    input: {},
    status: "running",
    origin: { phase: "process", placement: "standalone", sourceMessageIndex: 0, groupId: "call-1" },
    ...overrides,
  };
}

function subagentResult(overrides = {}) {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "Agent",
    content: [{ type: "text", text: "done" }],
    details: { kind: "pi-web-subagent", sessionId: "sub-1", status: "completed" },
    ...overrides,
  };
}

test("hoists a running Agent call even before its result lands", async () => {
  const { splitProcessSegments } = await loadSubject();
  const segments = splitProcessSegments([toolCallBlock()]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, "subagent");
});

test("hoists a completed Agent call that carries valid subagent details", async () => {
  const { splitProcessSegments } = await loadSubject();
  const segments = splitProcessSegments([
    toolCallBlock({ status: "success", result: subagentResult() }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, "subagent");
});

test("keeps a failed Agent dispatch in the process group so its error stays visible", async () => {
  // subagent-extension returns `details: undefined, isError: true` on a dispatch
  // failure. Hoisting it would render an unclickable row and hide the reason,
  // so the block must stay in the group where tool-result content is rendered.
  const { splitProcessSegments } = await loadSubject();
  const failed = toolCallBlock({
    status: "error",
    result: subagentResult({ details: undefined, isError: true, content: [{ type: "text", text: "spawn failed" }] }),
  });
  const segments = splitProcessSegments([failed]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, "group");
  assert.equal(segments[0].blocks[0], failed);
});

test("keeps an Agent call with malformed details in the process group", async () => {
  const { splitProcessSegments } = await loadSubject();
  const bad = toolCallBlock({
    status: "success",
    result: subagentResult({ details: { kind: "pi-web-subagent", sessionId: "sub-1", status: "bogus" } }),
  });
  const segments = splitProcessSegments([bad]);
  assert.equal(segments[0].kind, "group");
});

test("splits surrounding blocks into groups around the hoisted row", async () => {
  const { splitProcessSegments } = await loadSubject();
  const before = { ...toolCallBlock(), id: "t0", toolCallId: "call-0", toolName: "read_file" };
  const agent = toolCallBlock();
  const after = { ...toolCallBlock(), id: "t2", toolCallId: "call-2", toolName: "write_file" };
  const segments = splitProcessSegments([before, agent, after]);
  assert.deepEqual(segments.map((s) => s.kind), ["group", "subagent", "group"]);
  assert.equal(segments[0].blocks.length, 1);
  assert.equal(segments[2].blocks.length, 1);
});

test("returns no segments for an empty turn", async () => {
  const { splitProcessSegments } = await loadSubject();
  assert.deepEqual(splitProcessSegments([]), []);
});
