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
