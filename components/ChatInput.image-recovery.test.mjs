import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const componentUrl = new URL("./ChatInput.tsx", import.meta.url);
const {
  ChatInput,
  draftImagesToAttachedImages,
  getUserMessageDraftImages,
} = await jiti.import("./ChatInput.tsx");
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nContext } = await jiti.import("../hooks/useI18n.tsx");
const { getDraft, setDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");
const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } = await jiti.import("../lib/image-attachments.ts");

const png = Object.freeze({ data: "AQID", mimeType: "image/png" });
const jpeg = Object.freeze({ data: "BAUG", mimeType: "image/jpeg" });
const attach = (image) => ({
  ...image,
  previewUrl: `data:${image.mimeType};base64,${image.data}`,
});

function restoreImages(content) {
  return draftImagesToAttachedImages(getUserMessageDraftImages({ role: "user", content }));
}

function renderComposer(t, draft) {
  const key = `image-recovery:${t.name}`;
  setDraft(key, draft);
  t.after(() => clearDraft(key));
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Rendering restored attachments must not fetch external resources");
  });
  return renderToStaticMarkup(React.createElement(
    I18nContext.Provider,
    { value: { locale: "en", setLocale() {}, t: (key) => key, supportedLocales: [] } },
    React.createElement(ChatInput, {
      draftKey: key,
      isStreaming: false,
      onSend() {},
      onAbort() {},
    }),
  ));
}

test("should_create_usable_preview_when_restoring_nested_message_image", () => {
  assert.deepEqual(restoreImages([
    { type: "text", text: "inspect this" },
    { type: "image", source: { type: "base64", media_type: png.mimeType, data: png.data } },
  ]), [attach(png)]);
});

test("should_create_usable_preview_when_restoring_legacy_flat_message_image", () => {
  assert.deepEqual(restoreImages([{ type: "image", ...jpeg }]), [attach(jpeg)]);
});

test("should_keep_multiple_image_formats_when_restoring_mixed_history", () => {
  assert.deepEqual(restoreImages([
    { type: "image", source: { type: "base64", media_type: png.mimeType, data: png.data } },
    { type: "text", text: "between images" },
    { type: "image", ...jpeg },
  ]), [attach(png), attach(jpeg)]);
});

test("should_render_restored_preview_when_converted_history_is_saved_as_a_draft", (t) => {
  const images = restoreImages([{ type: "image", ...png }]);
  const html = renderComposer(t, {
    value: "restored",
    images: images.map(({ data, mimeType }) => ({ data, mimeType })),
  });

  assert.ok(html.includes(`<img src="data:${png.mimeType};base64,${png.data}"`));
});

test("should_render_image_only_preview_when_reopening_a_stored_draft", (t) => {
  const html = renderComposer(t, { value: "", images: [png] });
  assert.ok(html.includes(`<img src="data:${png.mimeType};base64,${png.data}"`));
});

test("should_return_empty_attachments_when_history_contains_text_only", () => {
  assert.deepEqual(restoreImages("plain text"), []);
});

test("should_return_empty_attachments_when_draft_images_are_undefined", () => {
  assert.deepEqual(draftImagesToAttachedImages(undefined), []);
});

test("should_return_empty_attachments_when_draft_images_are_empty", () => {
  assert.deepEqual(draftImagesToAttachedImages([]), []);
});

test("should_ignore_url_images_when_history_has_no_embedded_base64", () => {
  assert.deepEqual(restoreImages([
    { type: "image", source: { type: "url", url: "https://example.invalid/image.png" } },
  ]), []);
});

test("should_keep_exact_limit_when_history_has_maximum_number_of_images", () => {
  const images = Array.from({ length: MAX_ATTACHED_IMAGES }, (_, index) => ({
    data: Buffer.from([index]).toString("base64"),
    mimeType: "image/png",
  }));
  assert.deepEqual(restoreImages(images.map((image) => ({ type: "image", ...image }))), images.map(attach));
});

test("should_limit_attachments_when_history_contains_too_many_images", () => {
  const images = Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, (_, index) => ({
    data: Buffer.from([index]).toString("base64"),
    mimeType: "image/png",
  }));
  assert.deepEqual(
    restoreImages(images.map((image) => ({ type: "image", ...image }))),
    images.slice(0, MAX_ATTACHED_IMAGES).map(attach),
  );
});

test("should_filter_before_truncating_when_invalid_drafts_precede_a_valid_image", () => {
  const invalid = Array.from({ length: MAX_ATTACHED_IMAGES }, () => ({ data: "!", mimeType: "image/png" }));
  assert.deepEqual(draftImagesToAttachedImages([...invalid, png]), [attach(png)]);
});

for (const [label, image] of [
  ["empty_base64", { data: "", mimeType: "image/png" }],
  ["invalid_base64", { data: "!!!!", mimeType: "image/png" }],
  ["unpadded_base64", { data: "AQ", mimeType: "image/png" }],
  ["noncanonical_base64", { data: "AB==", mimeType: "image/png" }],
  ["nonimage_mime", { data: "AQID", mimeType: "text/plain" }],
  ["invalid_mime", { data: "AQID", mimeType: "image/" }],
  ["missing_data", { mimeType: "image/png" }],
  ["nonstring_data", { data: 123, mimeType: "image/png" }],
]) {
  test(`should_drop_${label}_when_restoring_history_with_valid_images`, () => {
    assert.deepEqual(restoreImages([
      { type: "image", ...image },
      { type: "image", ...png },
    ]), [attach(png)]);
  });
}

for (const [label, size, expectedCount] of [
  ["one_byte", 1, 1],
  ["exact_maximum", MAX_ATTACHED_IMAGE_BYTES, 1],
  ["above_maximum", MAX_ATTACHED_IMAGE_BYTES + 1, 0],
]) {
  test(`should_enforce_decoded_size_when_converting_${label}_image`, () => {
    const data = Buffer.alloc(size, 0x61).toString("base64");
    assert.equal(draftImagesToAttachedImages([{ data, mimeType: "image/png" }]).length, expectedCount);
  });
}

test("should_leave_input_unchanged_when_creating_preview_urls", () => {
  const images = Object.freeze([png, jpeg]);
  const attached = draftImagesToAttachedImages(images);
  assert.deepEqual(attached, [attach(png), attach(jpeg)]);
});

// React SSR cannot commit refs. Extract the real imperative factory with the
// TypeScript AST and evaluate it with the component's real module helpers.
// Closure state and browser APIs are mocked; no restore logic is duplicated.
const componentSource = await readFile(componentUrl, "utf8");
const parsed = ts.createSourceFile(fileURLToPath(componentUrl), componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let imperativeFactory;
function findImperativeFactory(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useImperativeHandle") {
    imperativeFactory = node.arguments[1];
  }
  ts.forEachChild(node, findImperativeFactory);
}
findImperativeFactory(parsed);
assert.ok(imperativeFactory && ts.isArrowFunction(imperativeFactory));
const closureNames = [
  "textareaRef", "value", "valueRef", "attachedImagesRef", "pastedBlocksRef", "draftKeyRef",
  "setValue", "setAtQuery", "setHistoryMenuOpen", "setAttachedImages", "setPastedBlocks",
  "processImageFiles", "isStreaming", "shellRef", "requestAnimationFrame",
];
const { createImperativeHandle } = await jiti.evalModule(
  `${componentSource}\nexport function createImperativeHandle({ ${closureNames.join(", ")} }) { return (${imperativeFactory.getText(parsed)})(); }`,
  { filename: fileURLToPath(componentUrl) },
);

function createComposerHarness(t, initial = {}) {
  const key = `imperative-image-recovery:${t.name}`;
  clearDraft(key);
  t.after(() => clearDraft(key));
  const state = {
    value: initial.value ?? "",
    images: initial.images?.map((image) => ({ ...image })) ?? [],
    pastedBlocks: initial.pastedBlocks?.map((block) => ({ ...block })) ?? [],
  };
  const setState = (field) => (value) => {
    state[field] = typeof value === "function" ? value(state[field]) : value;
  };
  const textarea = initial.textarea === false ? null : {
    value: initial.textareaValue ?? state.value,
    focus: t.mock.fn(),
    style: {},
    scrollHeight: 32,
  };
  const deps = {
    textareaRef: { current: textarea },
    value: state.value,
    valueRef: { current: state.value },
    attachedImagesRef: { current: state.images },
    pastedBlocksRef: { current: state.pastedBlocks },
    draftKeyRef: { current: key },
    setValue: setState("value"),
    setAttachedImages: setState("images"),
    setPastedBlocks: setState("pastedBlocks"),
    setAtQuery: t.mock.fn(),
    setHistoryMenuOpen: t.mock.fn(),
    processImageFiles: t.mock.fn(),
    isStreaming: false,
    shellRef: { current: null },
    requestAnimationFrame: t.mock.fn(() => 0),
  };
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  const handle = createImperativeHandle(deps);
  return { key, state, deps, handle, revoke };
}

function failedMessage(text = "rejected", images = [png]) {
  return {
    role: "user",
    content: [...(text ? [{ type: "text", text }] : []), ...images.map((image) => ({ type: "image", ...image }))],
    timestamp: 1,
  };
}

test("should_restore_history_images_when_empty_composer_uses_replace_message", (t) => {
  const h = createComposerHarness(t);
  h.handle.replaceMessage(failedMessage());
  assert.deepEqual({ value: h.state.value, images: h.state.images }, {
    value: "rejected",
    images: [attach(png)],
  });
});

test("should_leave_new_input_untouched_when_history_edit_uses_replace_message", (t) => {
  const h = createComposerHarness(t, { value: "new draft", images: [attach(jpeg)] });
  h.handle.replaceMessage(failedMessage());
  assert.deepEqual({ value: h.state.value, images: h.state.images }, {
    value: "new draft",
    images: [attach(jpeg)],
  });
});

test("should_merge_failed_submission_when_user_typed_text_and_attached_images", (t) => {
  const h = createComposerHarness(t, { value: "new draft", images: [attach(jpeg)] });
  h.handle.restoreSubmission(failedMessage());
  assert.deepEqual({ value: h.state.value, images: h.state.images }, {
    value: "rejected\n\nnew draft",
    images: [attach(png), attach(jpeg)],
  });
});

test("should_merge_live_textarea_value_when_react_state_has_not_caught_up", (t) => {
  const h = createComposerHarness(t, { value: "stale", textareaValue: "just typed" });
  h.handle.restoreSubmission(failedMessage());
  assert.equal(h.state.value, "rejected\n\njust typed");
});

test("should_merge_latest_value_ref_when_textarea_is_unmounted", (t) => {
  const h = createComposerHarness(t, { value: "stale", textarea: false });
  h.deps.valueRef.current = "latest draft";
  h.handle.restoreSubmission(failedMessage());
  assert.equal(h.state.value, "rejected\n\nlatest draft");
});

test("should_persist_merged_images_immediately_when_restoring_submission", (t) => {
  const h = createComposerHarness(t, { value: "new draft", images: [attach(jpeg)] });
  h.handle.restoreSubmission(failedMessage());
  assert.deepEqual(getDraft(h.key), {
    value: "rejected\n\nnew draft",
    images: [png, jpeg],
    pastedBlocks: undefined,
  });
});

test("should_preserve_paste_expansion_when_restoring_into_a_folded_paste", (t) => {
  const block = { id: "paste-1", label: "[Paste 1]", text: "long original content" };
  const h = createComposerHarness(t, { value: block.label, pastedBlocks: [block] });
  h.handle.restoreSubmission(failedMessage());
  assert.deepEqual(getDraft(h.key), {
    value: "rejected\n\n[Paste 1]",
    images: [png],
    pastedBlocks: [block],
  });
});

test("should_revoke_old_blob_preview_when_rebuilding_restored_attachments", (t) => {
  const h = createComposerHarness(t, { images: [{ ...jpeg, previewUrl: "blob:current-image" }] });
  h.handle.restoreSubmission(failedMessage());
  assert.deepEqual(h.revoke.mock.calls.map(({ arguments: args }) => args), [["blob:current-image"]]);
});

test("should_not_revoke_data_urls_when_rebuilding_restored_attachments", (t) => {
  const h = createComposerHarness(t, { images: [attach(jpeg)] });
  h.handle.restoreSubmission(failedMessage());
  assert.equal(h.revoke.mock.callCount(), 0);
});

test("should_restore_image_only_submission_when_composer_already_has_an_image", (t) => {
  const h = createComposerHarness(t, { images: [attach(jpeg)] });
  h.handle.restoreSubmission(failedMessage(""));
  assert.deepEqual(getDraft(h.key), { value: "", images: [png, jpeg], pastedBlocks: undefined });
});

test("should_keep_refs_current_when_recovery_runs_before_next_render", (t) => {
  const h = createComposerHarness(t, { value: "current", images: [attach(jpeg)], textarea: false });
  h.handle.restoreSubmission(failedMessage("first"));
  h.handle.restoreSubmission(failedMessage("second", []));
  assert.deepEqual(getDraft(h.key), {
    value: "second\n\nfirst\n\ncurrent",
    images: [png, jpeg],
    pastedBlocks: undefined,
  });
});
