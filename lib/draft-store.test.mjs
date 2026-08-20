import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getDraft, setDraft, clearDraft } = await jiti.import("./draft-store.ts");

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
