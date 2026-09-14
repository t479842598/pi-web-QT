import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./message-display.ts");
}

function assistant(content) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content,
  };
}

test("bounds thinking previews to the first nonblank line without splitting Unicode characters", async () => {
  const { getThinkingPreview } = await loadSubject();
  assert.equal(getThinkingPreview(" \r\n **First line** \r\nSecond line"), "**First line**");
  assert.equal(getThinkingPreview("First\rSecond"), "First");
  assert.equal(getThinkingPreview(" \n\t"), "");
  assert.equal(getThinkingPreview("\u{1F4A1}".repeat(300)), "\u{1F4A1}".repeat(240));
});

test("splits trailing final answer blocks from process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
    { type: "image", source: { type: "url", url: "https://example.com/final.png" } },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text", "image"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "toolCall"]);
});

test("keeps pre-tool text in process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "text", text: "I will inspect the repo first." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.equal(result.answerBlocks[0].text, "Final answer");
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["text", "toolCall"]);
});

test("does not expose text before a trailing tool call as final answer", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "text", text: "I need to call a tool." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks, []);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "text", "toolCall"]);
});

test("drops empty thinking blocks after completion", async () => {
  const { getDisplayableAssistantBlocks, splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["text"],
  );

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });
  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks, []);
});

test("keeps empty thinking while streaming", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Partial answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: true });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking"]);
});

test("keeps deferred historical thinking placeholders", async () => {
  const { getDisplayableAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "", deferred: true },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["thinking", "text"],
  );
});

test("keeps ordinary text visible when reasoning follows it", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  for (const isStreaming of [false, true]) {
    const message = assistant([
      { type: "text", text: "正文段落。\n".repeat(2000) },
      { type: "thinking", thinking: "provider reasoning arrives later" },
      { type: "text", text: "正文结尾" },
    ]);
    const split = splitFinalAssistantBlocks(message, { isStreaming });
    assert.deepEqual(split.answerBlocks, [message.content[0], message.content[2]]);
    assert.deepEqual(split.processBlocks, [message.content[1]]);
  }
});

test("only tool calls delimit pre-tool narration from the final answer", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "text", text: "Inspecting files" },
    { type: "toolCall", toolCallId: "c1", toolName: "read", input: {} },
    { type: "text", text: "Complete answer" },
    { type: "thinking", thinking: "late reasoning" },
  ]);
  const split = splitFinalAssistantBlocks(message);
  assert.deepEqual(split.answerBlocks, [message.content[2]]);
  assert.deepEqual(split.processBlocks, [message.content[0], message.content[1], message.content[3]]);
});

test("returns completed provider errors even when the message has no content", async () => {
  const { getAssistantErrorMessage } = await loadSubject();
  const message = {
    ...assistant([]),
    stopReason: "error",
    errorMessage: "OpenAI API error (403): request forbidden",
  };

  assert.equal(
    getAssistantErrorMessage(message),
    "OpenAI API error (403): request forbidden",
  );
  assert.equal(getAssistantErrorMessage(message, { isStreaming: true }), null);
});

test("falls back when a provider error has no message", async () => {
  const { getAssistantErrorMessage } = await loadSubject();

  assert.equal(
    getAssistantErrorMessage({ ...assistant([]), stopReason: "error" }),
    "Unknown provider error",
  );
  assert.equal(
    getAssistantErrorMessage({ ...assistant([]), stopReason: "stop" }),
    null,
  );
});

test("treats compaction summaries as turn anchors", async () => {
  const { isMessageGroupAnchor } = await loadSubject();

  assert.equal(isMessageGroupAnchor({ role: "user", content: "prompt" }), true);
  assert.equal(isMessageGroupAnchor({
    role: "custom",
    customType: "compaction",
    content: "summary",
    display: true,
  }), true);
  assert.equal(isMessageGroupAnchor(assistant([])), false);
});
