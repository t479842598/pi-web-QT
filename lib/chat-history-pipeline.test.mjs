import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildHistoryPipeline, findFinalAssistantIndex, isCompactionBoundary } = await jiti.import("./chat-history-pipeline.ts");

// ─── Message builders ───────────────────────────────────────────────────────

function user(id, text, parentId = "0") {
  return { id, parentId, role: "user", content: text, timestamp: 1700000000000 };
}

function assistant(id, content, parentId = null) {
  return { id, parentId, role: "assistant", content };
}

function toolResult(id, toolCallId, parentId = "2") {
  return { id, parentId, role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] };
}

function custom(id, customType, parentId = null) {
  return { id, parentId, role: "custom", customType, data: null };
}

function textBlock(text) { return { type: "text", text }; }
function toolCallBlock(toolCallId, toolName, input) { return { type: "toolCall", toolCallId, toolName, input }; }
function fileBlock(filePath) { return { type: "toolCall", toolCallId: `write-${filePath}`, toolName: "write", input: { file_path: filePath } }; }

/** A successful Agent dispatch carries valid subagent details; hoisting needs them. */
function subagentDetails(sessionId) {
  return { kind: "pi-web-subagent", sessionId, status: "completed", profile: "Explore", description: "run" };
}

// ─── findFinalAssistantIndex ────────────────────────────────────────────────

test("findFinalAssistantIndex: prefers assistant with answer over process-only assistant", () => {
  const messages = [
    user("0", "do it"),
    assistant("1", [toolCallBlock("c1", "write", { file_path: "/a" })], "0"),
    toolResult("2", "c1", "1"),
    assistant("3", [textBlock("done")], "2"),
  ];
  // turn is (0,4): answer-only at index 3
  assert.equal(findFinalAssistantIndex(messages, 0, 4), 3);
});

test("findFinalAssistantIndex: returns last assistant if none has an answer", () => {
  const messages = [
    user("0", "hmm"),
    assistant("1", [toolCallBlock("c1", "edit", { path: "/a" })], "0"),
    toolResult("2", "c1", "1"),
  ];
  // turn (0,3): only assistant at index 1 (has toolCall but no answer text)
  assert.equal(findFinalAssistantIndex(messages, 0, 3), 1);
});

// ─── isCompactionBoundary ──────────────────────────────────────────────────

test("isCompactionBoundary detects compaction custom messages", () => {
  assert.equal(isCompactionBoundary(custom("a", "compaction")), true);
  assert.equal(isCompactionBoundary(custom("b", "something_else")), false);
  assert.equal(isCompactionBoundary(user("c", "hi")), false);
});

// ─── buildHistoryPipeline ──────────────────────────────────────────────────

test("empty messages → empty pipeline", () => {
  const p = buildHistoryPipeline([], [], undefined);
  assert.equal(p.items.length, 0);
  assert.equal(p.lastUserIdx, -1);
  assert.equal(p.toolResultsMap.size, 0);
  assert.equal(p.visibleRefIndexByMessage.size, 0);
});

test("single user message → no-answer turn item (user starts a turn)", () => {
  const messages = [user("0", "hello")];
  const p = buildHistoryPipeline(messages, ["e0"], undefined);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].finalAssistantIdx, -1, "no assistant → no answer");
  assert.equal(p.lastUserIdx, 0);
});

test("orphaned prefix (user message paged out of the tail window) → synthetic turn with userIdx=-1 sentinel", () => {
  // Regression guard for the "Cannot read properties of undefined (reading
  // 'role')" crash on session switch: when the loaded tail window contains NO
  // user message (a running turn longer than the page), the pipeline emits a
  // synthetic turn with userIdx=-1 and lastUserIdx=-1. ChatWindow's isLiveTail
  // branch matches on `userIdx === lastUserIdx`, so it must never call
  // renderMessage(userIdx) for that sentinel.
  const messages = [
    assistant("1", [toolCallBlock("c1", "bash", { command: "ls" })], "0"),
    toolResult("2", "c1", "1"),
    assistant("3", [toolCallBlock("c2", "bash", { command: "pwd" })], "2"),
    toolResult("4", "c2", "3"),
  ];
  const p = buildHistoryPipeline(messages, ["e1", "e2", "e3", "e4"], undefined);
  assert.equal(p.lastUserIdx, -1, "window has no user message");
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].userIdx, -1, "orphaned prefix uses the -1 sentinel");
  assert.equal(p.items[0].endIdx, messages.length, "turn spans the whole window (live-tail candidate)");
});

test("user + toolResult + assistant → turn item with toolResultsMap and visibleRefIndexByMessage", () => {
  const messages = [
    user("0", "do it"),
    assistant("1", [textBlock("thinking...")]),
    toolResult("2", "c1"),
    assistant("3", [textBlock("done!")]),
  ];
  const entryIds = ["e0", "e1", "e2", "e3"];
  const p = buildHistoryPipeline(messages, entryIds, undefined);

  assert.equal(p.items.length, 1, "one turn item");
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].userIdx, 0);
  assert.equal(p.items[0].endIdx, 4);
  assert.equal(p.items[0].finalAssistantIdx, 3, "assistant with text is the answer");
  assert.ok(p.toolResultsMap.has("c1"), "toolResult indexed by toolCallId");
  // visibleRefIndexByMessage: user(0)→0, assistant(1)→1, assistant(3)→2 (toolResult skipped)
  assert.equal(p.visibleRefIndexByMessage.get(0), 0);
  assert.equal(p.visibleRefIndexByMessage.get(1), 1);
  assert.equal(p.visibleRefIndexByMessage.get(3), 2);
  assert.equal(p.visibleRefIndexByMessage.size, 3);
  assert.equal(p.lastUserIdx, 0);
});

test("finalAnswerMessage omits usage when derived from withAssistantBlocks", () => {
  const messages = [
    user("0", "edit file"),
    assistant("1", [textBlock("thinking"), textBlock("done")]),
  ];
  const p = buildHistoryPipeline(messages, ["e0", "e1"], undefined);
  const turn = p.items[0];
  assert.equal(turn.kind, "turn");
  assert.ok(turn.finalAnswerMessage, "should have finalAnswerMessage");
  assert.equal(turn.finalAnswerMessage?.usage, undefined, "usage should be omitted");
});

test("writtenFiles extracted from write tool calls in the final assistant turn", () => {
  const messages = [
    user("0", "write file"),
    assistant("1", [fileBlock("/abs/new.ts")]),
    toolResult("2", "write-/abs/new.ts"),
    assistant("3", [textBlock("created")]),
  ];
  const p = buildHistoryPipeline(messages, ["e0", "e1", "e2", "e3"], "/abs");
  const turn = p.items[0];
  assert.ok(turn.writtenFiles, "final answer exists → writtenFiles computed");
  assert.equal(turn.writtenFiles.length, 1);
  assert.equal(turn.writtenFiles[0].filePath, "/abs/new.ts");
});

test("writtenFiles is undefined when the turn has no final answer", () => {
  const messages = [
    user("0", "write file"),
    assistant("1", [fileBlock("/abs/new.ts")]),
    toolResult("2", "write-/abs/new.ts"),
  ];
  const p = buildHistoryPipeline(messages, ["e0", "e1", "e2"], "/abs");
  const turn = p.items[0];
  assert.equal(turn.finalAnswerMessage, null);
  assert.equal(turn.writtenFiles, undefined, "no answer → no writtenFiles (matches original render)");
});

test("messages with no assistant after user produce a no-answer turn item", () => {
  const messages = [user("0", "foo"), user("1", "bar")];
  const p = buildHistoryPipeline(messages, ["e0", "e1"], undefined);
  // first user starts a turn (0,1), no assistant → finalAssistantIdx=-1
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].kind, "turn");
  assert.equal((p.items[0]).finalAssistantIdx, -1);
  assert.equal((p.items[0]).finalAnswerMessage, null);
  assert.equal((p.items[0]).writtenFiles, undefined);
});

test("compaction boundary starts its own turn when it opens the visible context", () => {
  // After compaction the SDK may trim the user prompt that triggered it, so
  // the compaction entry can be the first message — it must start a turn
  // (ProcessGroup path) rather than render as a bare single.
  const messages = [
    custom("0", "compaction"),
    assistant("1", [textBlock("resumed")]),
  ];
  const p = buildHistoryPipeline(messages, ["e0", "e1"], undefined);
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].userIdx, 0);
  assert.equal(p.items[0].startsCompactionTurn, true);
  assert.equal(p.items[0].finalAssistantIdx, 1);
});

test("compaction entry after a user turn is absorbed into that turn as process", () => {
  const messages = [
    user("0", "hi"),
    assistant("1", [textBlock("ok")]),
    custom("2", "compaction"),
    assistant("3", [textBlock("resumed")]),
  ];
  const p = buildHistoryPipeline(messages, ["e0", "e1", "e2", "e3"], undefined);
  // The turn scan only breaks on role "user", so the compaction + resumed
  // assistant belong to the turn started by user(0).
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].endIdx, 4);
  assert.equal(p.items[0].startsCompactionTurn, false);
});

test("groups a tail that begins inside a turn into one collapsed process item", () => {
  const messages = [
    { role: "assistant", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "pwd" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "/tmp" }] },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "c2", toolName: "edit", input: { path: "a.js" } }] },
    { role: "toolResult", toolCallId: "c2", toolName: "edit", content: [{ type: "text", text: "ok" }] },
  ];
  const pipeline = buildHistoryPipeline(messages, ["a1", "r1", "a2", "r2"], "/tmp");
  assert.equal(pipeline.items.length, 1);
  assert.equal(pipeline.items[0].kind, "turn");
  assert.equal(pipeline.items[0].userIdx, -1);
  assert.equal(pipeline.items[0].finalAssistantIdx, -1);
  assert.ok(pipeline.items[0].processBlocks.length >= 2);
});

test("groups a user turn with only tool processing instead of rendering every message", () => {
  const messages = [
    { role: "user", content: "run checks" },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "pwd" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "/tmp" }] },
  ];
  const pipeline = buildHistoryPipeline(messages, ["u", "a", "r"], "/tmp");
  assert.equal(pipeline.items.length, 1);
  assert.equal(pipeline.items[0].processBlocks.length, 1);
});

// ─── Subagent hoisting ──────────────────────────────────────────────────────

test("hoists Agent tool calls out of the process group into their own segments", () => {
  const messages = [
    { role: "user", content: "spawn two agents" },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "ls" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "ok" }] },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "agent1", toolName: "Agent", input: { subagent_type: "Explore", task: "a" } }] },
    { role: "toolResult", toolCallId: "agent1", toolName: "Agent", content: [{ type: "text", text: "done" }], details: subagentDetails("agent1") },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "agent2", toolName: "Agent", input: { subagent_type: "Explore", task: "b" } }] },
    { role: "toolResult", toolCallId: "agent2", toolName: "Agent", content: [{ type: "text", text: "done" }], details: subagentDetails("agent2") },
  ];
  const pipeline = buildHistoryPipeline(messages, ["u", "a1", "r1", "a2", "r2", "a3", "r3"], "/tmp");
  const turn = pipeline.items[0];
  assert.equal(turn.kind, "turn");
  // Order is preserved: group(bash) → agent1 → agent2.
  assert.deepEqual(turn.processSegments.map((s) => s.kind), ["group", "subagent", "subagent"]);
  assert.equal(turn.processSegments[1].subagent.toolCallId, "agent1");
  assert.equal(turn.processSegments[2].subagent.toolCallId, "agent2");
  // The hoisted blocks are not duplicated inside the groups.
  const grouped = turn.processSegments
    .filter((s) => s.kind === "group")
    .flatMap((s) => s.blocks.map((b) => b.toolCallId ?? null));
  assert.ok(!grouped.includes("agent1"));
  assert.ok(!grouped.includes("agent2"));
});

test("keeps a subagent sandwiched between tool calls in position", () => {
  const messages = [
    { role: "user", content: "go" },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "b1", toolName: "bash", input: { command: "ls" } }] },
    { role: "toolResult", toolCallId: "b1", toolName: "bash", content: [{ type: "text", text: "ok" }] },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "agent1", toolName: "Agent", input: { subagent_type: "Explore", task: "x" } }] },
    { role: "toolResult", toolCallId: "agent1", toolName: "Agent", content: [{ type: "text", text: "done" }], details: subagentDetails("agent1") },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "b2", toolName: "read", input: { path: "a" } }] },
    { role: "toolResult", toolCallId: "b2", toolName: "read", content: [{ type: "text", text: "ok" }] },
  ];
  const pipeline = buildHistoryPipeline(messages, ["u", "a1", "r1", "a2", "r2", "a3", "r3"], "/tmp");
  const turn = pipeline.items[0];
  assert.deepEqual(turn.processSegments.map((s) => s.kind), ["group", "subagent", "group"]);
  assert.equal(turn.processSegments[0].blocks[0].toolCallId, "b1");
  assert.equal(turn.processSegments[2].blocks[0].toolCallId, "b2");
});

test("orphaned prefix with trailing non-processable messages keeps them aggregated, never bare singles", () => {
  // Regression for the "running turn won't collapse" report: a tail window
  // starting mid-turn must NOT degrade to per-message singles when the prefix
  // also contains messages without displayable process blocks (e.g. a bare
  // toolResult or an empty assistant). The render loop would otherwise emit
  // every message as an expanded MessageView with inline tool cards.
  const messages = [
    toolResult("1", "c0", "0"),
    assistant("2", [toolCallBlock("c1", "bash", { command: "ls" })], "1"),
    toolResult("3", "c1", "2"),
  ];
  const p = buildHistoryPipeline(messages, ["e1", "e2", "e3"], undefined);
  // The synthetic prefix turn absorbs the whole window (no user anchor until
  // the next real user message), so no "single" items leak out of it.
  const leakedSingles = p.items.filter((item) => item.kind === "single");
  assert.equal(leakedSingles.length, 0, "orphaned prefix must not produce singles");
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].userIdx, -1);
});

test("orphaned prefix followed by a real user turn splits into prefix turn + user turn", () => {
  const messages = [
    assistant("1", [toolCallBlock("c1", "bash", { command: "ls" })], "0"),
    toolResult("2", "c1", "1"),
    user("3", "next task"),
    assistant("4", [textBlock("done")], "3"),
  ];
  const p = buildHistoryPipeline(messages, ["e1", "e2", "e3", "e4"], undefined);
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].kind, "turn");
  assert.equal(p.items[0].userIdx, -1, "prefix turn keeps the sentinel");
  assert.equal(p.items[0].endIdx, 2, "prefix turn ends before the next user message");
  assert.equal(p.items[1].kind, "turn");
  assert.equal(p.items[1].userIdx, 2);
  assert.equal(p.items[1].finalAssistantIdx, 3);
});
