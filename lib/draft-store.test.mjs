import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getDraft,
  setDraft,
  clearDraft,
  mergeRestoredSubmissionDraft,
  restoreDraftSubmission,
  rekeyDraft,
} = await jiti.import("./draft-store.ts");
const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } = await jiti.import("./image-attachments.ts");

test("set/get/clear round-trips a draft", () => {
  setDraft("s1", { value: "hello", images: [{ data: "aGk=", mimeType: "image/gif" }] });
  const draft = getDraft("s1");
  assert.equal(draft?.value, "hello");
  assert.equal(draft?.images.length, 1);
  clearDraft("s1");
  assert.equal(getDraft("s1"), null);
});

test("empty drafts are not stored", () => {
  setDraft("empty", { value: "", images: [] });
  assert.equal(getDraft("empty"), null);
});

test("drafts are isolated between keys and cloned", () => {
  setDraft("a", { value: "one", images: [] });
  const d = getDraft("a");
  assert.ok(d);
  d.value = "mutated";
  assert.equal(getDraft("a")?.value, "one", "caller mutation must not leak into the store");
  clearDraft("a");
});

test("draft map is bounded (LRU eviction of oldest keys)", () => {
  for (let i = 0; i < 130; i++) {
    setDraft(`key-${i}`, { value: `draft ${i}`, images: [] });
  }
  // Cap is 100 — the oldest keys must be gone.
  assert.equal(getDraft("key-0"), null);
  assert.equal(getDraft("key-29"), null);
  assert.equal(getDraft("key-30")?.value, "draft 30");
  assert.equal(getDraft("key-129")?.value, "draft 129");
  // Refreshing a key makes it recent.
  setDraft("key-30", { value: "draft 30 again", images: [] });
  setDraft("key-200", { value: "x", images: [] });
  assert.equal(getDraft("key-30")?.value, "draft 30 again", "recently written key survives eviction");
  // Cleanup: keep the shared map small for other tests.
  for (let i = 0; i <= 200; i++) clearDraft(`key-${i}`);
});

// ChatDraftImage deliberately has no `type` field. Fixtures must use that
// public shape, not the API's { type: "image", ... } wire representation.
const submittedImage = Object.freeze({ data: "AQID", mimeType: "image/png" });
const currentImage = Object.freeze({ data: "BAUG", mimeType: "image/jpeg" });

function withDraftKeys(t, ...keys) {
  for (const key of keys) clearDraft(key);
  t.after(() => {
    for (const key of keys) clearDraft(key);
  });
}

function numberedImages(count) {
  return Array.from({ length: count }, (_, index) => ({
    data: Buffer.from([index + 1]).toString("base64"),
    mimeType: "image/png",
  }));
}

test("should_keep_submitted_and_current_images_when_merging_rejected_submission", () => {
  const restored = mergeRestoredSubmissionDraft(
    "submitted", [submittedImage], "typed while sending", [currentImage],
  );

  assert.deepEqual(restored, {
    value: "submitted\n\ntyped while sending",
    images: [submittedImage, currentImage],
    pastedBlocks: undefined,
  });
});

test("should_keep_image_only_submission_when_current_draft_is_empty", () => {
  assert.deepEqual(
    mergeRestoredSubmissionDraft("", [submittedImage], "", []),
    { value: "", images: [submittedImage], pastedBlocks: undefined },
  );
});

test("should_keep_current_images_when_submitted_images_are_undefined", () => {
  assert.deepEqual(
    mergeRestoredSubmissionDraft("submitted", undefined, "current", [currentImage]).images,
    [currentImage],
  );
});

test("should_return_empty_images_when_both_image_lists_are_empty", () => {
  assert.deepEqual(mergeRestoredSubmissionDraft("", undefined, "", []), {
    value: "",
    images: [],
    pastedBlocks: undefined,
  });
});

test("should_preserve_image_order_when_merged_count_equals_the_limit", () => {
  const images = numberedImages(MAX_ATTACHED_IMAGES);
  assert.deepEqual(
    mergeRestoredSubmissionDraft("sent", images.slice(0, 4), "draft", images.slice(4)).images,
    images,
  );
});

test("should_cap_combined_images_when_submission_and_current_draft_overflow", () => {
  const images = numberedImages(MAX_ATTACHED_IMAGES + 1);
  assert.deepEqual(
    mergeRestoredSubmissionDraft("sent", images.slice(0, 6), "draft", images.slice(6)).images,
    images.slice(0, MAX_ATTACHED_IMAGES),
  );
});

test("should_filter_invalid_images_before_applying_the_count_limit", () => {
  const invalidImages = Array.from({ length: MAX_ATTACHED_IMAGES }, () => ({
    data: "not-base64!",
    mimeType: "image/png",
  }));
  assert.deepEqual(
    mergeRestoredSubmissionDraft("sent", invalidImages, "draft", [currentImage]).images,
    [currentImage],
  );
});

for (const [label, data] of [
  ["empty", ""],
  ["illegal_characters", "!!!!"],
  ["missing_padding", "AQ"],
  ["embedded_padding", "AQ=I"],
  ["embedded_whitespace", "AQ ID"],
  ["noncanonical_padding_bits", "AB=="],
  ["data_url_instead_of_raw_base64", "data:image/png;base64,AQID"],
]) {
  test(`should_drop_${label}_base64_when_restoring_with_a_valid_image`, () => {
    assert.deepEqual(
      mergeRestoredSubmissionDraft("", [{ data, mimeType: "image/png" }], "", [currentImage]).images,
      [currentImage],
    );
  });
}

for (const mimeType of ["", "text/plain", "image/", "image/png; charset=utf-8"]) {
  test(`should_drop_invalid_mime_${JSON.stringify(mimeType)}_when_merging_images`, () => {
    assert.deepEqual(
      mergeRestoredSubmissionDraft("", [{ data: "AQID", mimeType }], "", [currentImage]).images,
      [currentImage],
    );
  });
}

for (const [label, image] of [
  ["null", null],
  ["undefined", undefined],
  ["nonobject", "AQID"],
  ["missing_data", { mimeType: "image/png" }],
  ["missing_mime", { data: "AQID" }],
  ["nonstring_data", { data: 123, mimeType: "image/png" }],
]) {
  test(`should_drop_${label}_attachment_when_restoring_with_a_valid_image`, () => {
    assert.deepEqual(
      mergeRestoredSubmissionDraft("", [image], "", [currentImage]).images,
      [currentImage],
    );
  });
}

for (const [label, size, expectedCount] of [
  ["one_byte", 1, 1],
  ["below_maximum", MAX_ATTACHED_IMAGE_BYTES - 1, 1],
  ["exact_maximum", MAX_ATTACHED_IMAGE_BYTES, 1],
  ["above_maximum", MAX_ATTACHED_IMAGE_BYTES + 1, 0],
]) {
  test(`should_enforce_decoded_size_when_image_is_${label}`, () => {
    const image = { data: Buffer.alloc(size, 0x61).toString("base64"), mimeType: "image/png" };
    const restored = mergeRestoredSubmissionDraft("", [image], "", []);
    // Check cardinality rather than printing a multi-megabyte base64 diff.
    assert.equal(restored.images.length, expectedCount);
  });
}

test("should_clone_merged_images_when_caller_mutates_the_restored_draft", () => {
  const images = [{ ...submittedImage }, { ...currentImage }];
  const restored = mergeRestoredSubmissionDraft("sent", images.slice(0, 1), "draft", images.slice(1));
  if (restored.images.length === images.length) restored.images[0].data = "BwgJ";

  assert.deepEqual(
    { count: restored.images.length, original: images },
    { count: 2, original: [submittedImage, currentImage] },
  );
});

test("should_store_text_and_images_when_restoring_a_failed_submission", (t) => {
  const key = "image-recovery:restore";
  withDraftKeys(t, key);
  setDraft(key, { value: "new draft", images: [currentImage] });

  restoreDraftSubmission(key, "rejected", [submittedImage]);

  assert.deepEqual(getDraft(key), {
    value: "rejected\n\nnew draft",
    images: [submittedImage, currentImage],
    pastedBlocks: undefined,
  });
});

test("should_store_image_only_draft_when_failed_submission_has_no_text", (t) => {
  const key = "image-recovery:restore-image-only";
  withDraftKeys(t, key);

  restoreDraftSubmission(key, "", [submittedImage]);

  assert.deepEqual(getDraft(key), {
    value: "",
    images: [submittedImage],
    pastedBlocks: undefined,
  });
});

test("should_keep_draft_absent_when_restoring_an_empty_submission", (t) => {
  const key = "image-recovery:restore-empty";
  withDraftKeys(t, key);

  restoreDraftSubmission(key, "", []);

  assert.equal(getDraft(key), null);
});

test("should_keep_pasted_blocks_when_restoring_images_into_an_existing_draft", (t) => {
  const key = "image-recovery:restore-blocks";
  withDraftKeys(t, key);
  const block = { id: "paste-1", label: "[Paste 1]", text: "original long paste" };
  setDraft(key, { value: block.label, images: [currentImage], pastedBlocks: [block] });

  restoreDraftSubmission(key, "rejected", [submittedImage]);

  assert.deepEqual(getDraft(key), {
    value: `rejected\n\n${block.label}`,
    images: [submittedImage, currentImage],
    pastedBlocks: [block],
  });
});

test("should_keep_both_drafts_images_when_rekeying_into_an_existing_session", (t) => {
  const previousKey = "image-recovery:new-session";
  const nextKey = "image-recovery:created-session";
  withDraftKeys(t, previousKey, nextKey);
  setDraft(previousKey, { value: "in-progress draft", images: [currentImage] });
  setDraft(nextKey, { value: "restored submission", images: [submittedImage] });

  rekeyDraft(previousKey, nextKey);

  assert.deepEqual(getDraft(nextKey), {
    value: "restored submission\n\nin-progress draft",
    images: [submittedImage, currentImage],
    pastedBlocks: undefined,
  });
});

test("should_move_images_when_rekeying_to_a_missing_draft", (t) => {
  const previousKey = "image-recovery:move-source";
  const nextKey = "image-recovery:move-destination";
  withDraftKeys(t, previousKey, nextKey);
  setDraft(previousKey, { value: "", images: [submittedImage] });

  rekeyDraft(previousKey, nextKey);

  assert.deepEqual(getDraft(nextKey), {
    value: "",
    images: [submittedImage],
    pastedBlocks: undefined,
  });
});

test("should_remove_previous_key_when_rekeying_an_image_draft", (t) => {
  const previousKey = "image-recovery:remove-source";
  const nextKey = "image-recovery:remove-destination";
  withDraftKeys(t, previousKey, nextKey);
  setDraft(previousKey, { value: "", images: [submittedImage] });

  rekeyDraft(previousKey, nextKey);

  assert.equal(getDraft(previousKey), null);
});

test("should_prefer_unsaved_images_when_rekeying_with_a_live_draft", (t) => {
  const previousKey = "image-recovery:live-source";
  const nextKey = "image-recovery:live-destination";
  withDraftKeys(t, previousKey, nextKey);
  setDraft(previousKey, { value: "stale", images: [{ data: "BwgJ", mimeType: "image/gif" }] });
  setDraft(nextKey, { value: "restored", images: [submittedImage] });

  rekeyDraft(previousKey, nextKey, { value: "live", images: [currentImage] });

  assert.deepEqual(getDraft(nextKey), {
    value: "restored\n\nlive",
    images: [submittedImage, currentImage],
    pastedBlocks: undefined,
  });
});

test("should_cap_images_when_rekeying_two_full_drafts", (t) => {
  const previousKey = "image-recovery:overflow-source";
  const nextKey = "image-recovery:overflow-destination";
  withDraftKeys(t, previousKey, nextKey);
  const images = numberedImages(MAX_ATTACHED_IMAGES + 2);
  setDraft(previousKey, { value: "current", images: images.slice(5) });
  setDraft(nextKey, { value: "restored", images: images.slice(0, 5) });

  rekeyDraft(previousKey, nextKey);

  assert.deepEqual(getDraft(nextKey)?.images, images.slice(0, MAX_ATTACHED_IMAGES));
});
