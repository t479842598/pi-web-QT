import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The chat list keys ProcessGroup/MessageView rows by item key. If a row's key
// changes between two renders, React remounts it and every piece of local UI
// state (expanded tool details, active process tab) is lost. These tests pin
// the keying rules that keep the LIVE tail stable while tokens stream.

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("live-tail keys are scoped to the turn's user index", () => {
  assert.match(source, /const liveProcessItemKey = \(userIdx: number\) => `live-process-u\$\{userIdx\}`/);
  assert.match(source, /const liveAnswerItemKey = \(userIdx: number\) => `live-answer-u\$\{userIdx\}`/);
});

test("historical keys stay entryId-based so prepending an older page is safe", () => {
  assert.match(source, /const processItemKey = \(userIdx: number\) => `process-\$\{messageItemKey\(userIdx, "user"\)\}`/);
  assert.match(source, /const answerItemKey = \(userIdx: number\) => `answer-\$\{messageItemKey\(userIdx, "user"\)\}`/);
});

test("the live branch uses the live keys, not the entryId-based ones", () => {
  const live = source.slice(source.indexOf("const isLiveTail"), source.indexOf("if (finalAssistantIdx === -1"));
  // Process groups may be split into per-segment keys once subagent rows are
  // hoisted out, so accept the segment form as long as it is rooted in the
  // turn's user index (live) and never the entryId-based key.
  assert.match(live, /liveProcess(Item|Segment)Key\(userIdx/);
  assert.match(live, /liveAnswerItemKey\(userIdx\)/);
  assert.doesNotMatch(live, /answerItemKey\(userIdx\)/);
  assert.doesNotMatch(live, /processItemKey\(userIdx\)/);
});

test("keys no longer embed values that change mid-run", () => {
  // Regression: the process key embedded the first process-message index, which
  // changed as soon as a process block appeared; the answer key switched from a
  // streaming form to an entryId form on every assistant message_end (once per
  // tool step), remounting the group and dropping the user's expanded details.
  assert.doesNotMatch(source, /live-process-\$\{userIdx\}-\$\{liveProcessIndices\[0\]/);
  assert.doesNotMatch(source, /live-answer-streaming-\$\{userIdx\}/);
  assert.doesNotMatch(source, /`process-\$\{userIdx >= 0 \? messageItemKey/);
});

// Execute both production segment callbacks and the real minimap range mapper.
// React elements are created, not mounted; no browser or session is started.
const { default: ts } = await import("typescript");
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { buildHistoryPipeline } = await jiti.import("../lib/chat-history-pipeline.ts");
const parsed = ts.createSourceFile("ChatWindow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "forEach") {
    const target = node.expression.expression.getText(parsed);
    if (target === "splitProcessSegments(liveProcessBlocks)") callbacks.live = node.arguments[0];
    if (target === "item.processSegments") callbacks.history = node.arguments[0];
    if (target === "starts") callbacks.map = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(callbacks.live && callbacks.history && callbacks.map, "production segment callbacks and mapper must be found");
const names = [
  "visibleRefIndexByMessage", "processRefIdx", "pushRendered", "MessageView", "SubagentRunRow", "ProcessGroup",
  "subagentItemKey", "onOpenSubagent", "subagentRuns", "subagentSessionId", "messageCwd", "onOpenFile",
  "handleQuoteReply", "onOpenSession", "messages", "agentRunning", "streamState", "liveProcessSegmentKey",
  "userIdx", "messageRefs", "session", "sessionIdRef", "tokenRate", "processSegmentKey",
];
const { createCallbacks, mapRefs } = await jiti.evalModule(`
export function createCallbacks({ ${names.join(", ")} }) {
  return { live: ${callbacks.live.getText(parsed)}, history: ${callbacks.history.getText(parsed)} };
}
export function mapRefs(starts, visibleMessages) {
  const refToItem = [];
  starts.forEach(${callbacks.map.getText(parsed)});
  return refToItem;
}`, { filename: fileURLToPath(new URL("./ChatWindow.tsx", import.meta.url)) });

function runSegments(mode, segments, visibleRefIndexByMessage) {
  const starts = [];
  const empty = () => null;
  const deps = Object.fromEntries(names.map((name) => [name, undefined]));
  Object.assign(deps, {
    visibleRefIndexByMessage, processRefIdx: 1,
    pushRendered: (_node, startRef) => starts.push({ startRef, itemIdx: starts.length }),
    MessageView: empty, SubagentRunRow: empty, ProcessGroup: empty,
    subagentItemKey: (id) => `subagent-${id}`, subagentSessionId: () => "",
    messages: Array(20), agentRunning: mode === "live", streamState: { isStreaming: mode === "live" },
    liveProcessSegmentKey: (user, segment) => `${user}-${segment}`, userIdx: 0,
    messageRefs: { current: [] }, session: { id: "session" }, sessionIdRef: { current: "session" },
    processSegmentKey: (_user, _segment, firstId) => firstId,
  });
  segments.forEach(createCallbacks(deps)[mode]);
  return starts;
}

function alternatingTurn() {
  const messages = [
    { role: "user", content: "work" },
    { role: "assistant", content: [{ type: "text", text: "first progress" }, { type: "toolCall", toolCallId: "c1", toolName: "read", input: {} }] },
    { role: "toolResult", toolCallId: "c1", content: [] },
    { role: "assistant", content: [{ type: "text", text: "second progress" }, { type: "toolCall", toolCallId: "c2", toolName: "read", input: {} }] },
    { role: "toolResult", toolCallId: "c2", content: [] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ];
  return buildHistoryPipeline(messages, ["u", "a1", "r1", "a2", "r2", "final"], undefined);
}

for (const mode of ["live", "history"]) {
  test(`should_keep_segment_refs_nondecreasing_when_${mode}_output_alternates_with_tools`, () => {
    const pipeline = alternatingTurn();
    const starts = runSegments(mode, pipeline.items[0].processSegments, pipeline.visibleRefIndexByMessage);
    assert.deepEqual(starts.map(({ startRef }) => startRef), [1, 1, 2, 2]);
  });

  test(`should_not_overwrite_earlier_message_mapping_when_${mode}_has_later_process_groups`, () => {
    const pipeline = alternatingTurn();
    const starts = runSegments(mode, pipeline.items[0].processSegments, pipeline.visibleRefIndexByMessage);
    const refs = mapRefs(starts, Array(3));
    assert.deepEqual([refs[1], refs[2]], [1, 3]);
  });

  test(`should_emit_no_segment_refs_when_${mode}_process_segments_are_empty`, () => {
    assert.deepEqual(runSegments(mode, [], new Map()), []);
  });
}

