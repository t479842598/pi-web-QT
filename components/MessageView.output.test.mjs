import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MessageView } = await jiti.import("./MessageView.tsx");
const { I18nContext } = await jiti.import("../hooks/useI18n.tsx");
const { buildHistoryPipeline } = await jiti.import("../lib/chat-history-pipeline.ts");

const nestedImage = { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } };
const flatImage = { type: "image", mimeType: "image/jpeg", data: "BAUG" };
const i18n = { locale: "en", setLocale() {}, t: (key) => key, supportedLocales: [] };

function render(t, content) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("SSR image output must not fetch"); });
  return renderToStaticMarkup(React.createElement(
    I18nContext.Provider,
    { value: i18n },
    React.createElement(MessageView, { message: { role: "assistant", provider: "", model: "", content } }),
  ));
}

function imageSources(html) {
  return Array.from(html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g), (match) => match[1]);
}

test("should_render_nested_base64_image_when_assistant_output_contains_an_image", (t) => {
  assert.deepEqual(imageSources(render(t, [nestedImage])), ["data:image/png;base64,AQID"]);
});

test("should_render_legacy_flat_image_when_assistant_output_has_no_source_object", (t) => {
  assert.deepEqual(imageSources(render(t, [flatImage])), ["data:image/jpeg;base64,BAUG"]);
});

test("should_render_url_image_when_assistant_output_uses_a_url_source", (t) => {
  assert.deepEqual(imageSources(render(t, [{ type: "image", source: { type: "url", url: "https://example.invalid/image.png" } }])), ["https://example.invalid/image.png"]);
});

test("should_render_no_image_when_output_content_is_empty", (t) => {
  assert.deepEqual(imageSources(render(t, [])), []);
});

test("should_skip_missing_image_source_when_a_valid_image_follows", (t) => {
  assert.deepEqual(imageSources(render(t, [{ type: "image" }, nestedImage])), ["data:image/png;base64,AQID"]);
});

test("should_skip_empty_url_when_output_has_no_usable_image_source", (t) => {
  assert.deepEqual(imageSources(render(t, [{ type: "image", source: { type: "url", url: "" } }])), []);
});

for (const [format, images, expectedSources] of [
  ["nested", [nestedImage], ["data:image/png;base64,AQID"]],
  ["flat", [flatImage], ["data:image/jpeg;base64,BAUG"]],
  ["mixed", [nestedImage, flatImage], ["data:image/png;base64,AQID", "data:image/jpeg;base64,BAUG"]],
]) {
  test(`should_render_promoted_${format}_images_once_when_history_has_a_later_answer`, (t) => {
    // Exercise collectProcessContentBlocks -> messageToProcessContentBlocks ->
    // output promotion -> MessageView. Direct flat-image rendering alone would
    // miss a converter that discards the SDK's data/mimeType fields.
    const messages = [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [...images, { type: "toolCall", toolName: "read", toolCallId: "call-1", input: {} }] },
      { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];
    const turn = buildHistoryPipeline(messages, ["u", "a1", "r", "a2"], undefined).items[0];
    const outputBlocks = turn.processSegments.filter((segment) => segment.kind === "output").flatMap((segment) => segment.blocks);
    assert.deepEqual(imageSources(render(t, outputBlocks)), expectedSources);
  });
}

test("should_preserve_flat_image_when_final_assistant_process_blocks_are_promoted", (t) => {
  // This image takes splitAssistantContentBlocks rather than the preceding
  // message collector, so cover both callers of the conversion helper.
  const messages = [
    { role: "user", content: "inspect" },
    { role: "assistant", content: [flatImage, { type: "toolCall", toolName: "read", toolCallId: "call-1", input: {} }, { type: "text", text: "done" }] },
  ];
  const turn = buildHistoryPipeline(messages, ["u", "final"], undefined).items[0];
  const renderedContent = [
    ...turn.processSegments.filter((segment) => segment.kind === "output").flatMap((segment) => segment.blocks),
    ...(turn.finalAnswerMessage?.content ?? []),
  ];
  assert.deepEqual(imageSources(render(t, renderedContent)), ["data:image/jpeg;base64,BAUG"]);
});

test("should_keep_image_once_when_orphaned_final_answer_is_split_from_reasoning", (t) => {
  const messages = [{ role: "assistant", content: [nestedImage, { type: "thinking", thinking: "reasoning" }] }];
  const turn = buildHistoryPipeline(messages, ["orphan"], undefined).items[0];
  const renderedContent = [
    ...turn.processSegments.filter((segment) => segment.kind === "output").flatMap((segment) => segment.blocks),
    ...(turn.finalAnswerMessage?.content ?? []),
  ];
  assert.deepEqual(imageSources(render(t, renderedContent)), ["data:image/png;base64,AQID"]);
});
