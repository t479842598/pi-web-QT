import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  applyModelOrder,
  syncSlotsAfterReorder,
  mergeDiscoveredModels,
  primaryModelId,
  containsModelId,
} = await jiti.import("./model-config-utils.ts");

const models = (ids) => ids.map((id) => ({ id }));

test("applyModelOrder follows the requested order", () => {
  assert.deepEqual(
    applyModelOrder(models(["a", "b", "c"]), ["c", "a", "b"]).map((model) => model.id),
    ["c", "a", "b"],
  );
});

test("applyModelOrder keeps models missing from the order list at the tail, in their own order", () => {
  assert.deepEqual(
    applyModelOrder(models(["a", "b", "c", "d"]), ["d", "b"]).map((model) => model.id),
    ["d", "b", "a", "c"],
  );
});

test("applyModelOrder ignores ids the list does not contain and repeats of the same id", () => {
  assert.deepEqual(
    applyModelOrder(models(["a", "b"]), ["b", "zzz", "b", "a"]).map((model) => model.id),
    ["b", "a"],
  );
});

test("syncSlotsAfterReorder carries each saved id to its new position", () => {
  // A pure drag must not look like three renames to collectModelRenames().
  assert.deepEqual(syncSlotsAfterReorder(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
});

test("syncSlotsAfterReorder parks a free null slot where the unsaved model moved", () => {
  assert.deepEqual(syncSlotsAfterReorder(["a", null, "c"], ["c", "a", null]), ["c", "a", null]);
  // The null slot is not an id, so it cannot be looked up: the position holds null again.
  assert.deepEqual(syncSlotsAfterReorder(["a", null, "c"], [null, "c", "a"]), [null, "c", "a"]);
});

test("syncSlotsAfterReorder reports every model of a never-saved provider as unsaved", () => {
  assert.deepEqual(syncSlotsAfterReorder([null, null], ["b", "a"]), [null, null]);
});

test("syncSlotsAfterReorder passes an absent slot map straight through", () => {
  assert.equal(syncSlotsAfterReorder(undefined, ["a", "b"]), undefined);
});

test("mergeDiscoveredModels appends only ids the draft does not already have", () => {
  const merged = mergeDiscoveredModels(models(["a"]), [{ id: "b", name: "Bee" }, { id: "c" }]);
  assert.deepEqual(merged.models, [{ id: "a" }, { id: "b", name: "Bee" }, { id: "c" }]);
  assert.equal(merged.added, 2);
});

test("mergeDiscoveredModels dedupes case-insensitively and keeps the draft's spelling", () => {
  const merged = mergeDiscoveredModels(models(["GPT-4o"]), [{ id: "gpt-4o" }, { id: "gpt-5" }]);
  assert.deepEqual(merged.models.map((model) => model.id), ["GPT-4o", "gpt-5"]);
  assert.equal(merged.added, 1);
});

test("mergeDiscoveredModels skips blank ids and reports zero added", () => {
  const merged = mergeDiscoveredModels(models(["a"]), [{ id: "  " }, { id: "" }]);
  assert.deepEqual(merged.models, [{ id: "a" }]);
  assert.equal(merged.added, 0);
});

test("primaryModelId is the first non-blank id in order", () => {
  assert.equal(primaryModelId(models(["", "  ", "b", "c"])), "b");
  assert.equal(primaryModelId([]), undefined);
});

test("containsModelId matches case-insensitively and rejects a blank needle", () => {
  assert.equal(containsModelId(models(["GPT-4o"]), "gpt-4o"), true);
  assert.equal(containsModelId(models(["GPT-4o"]), "gpt-5"), false);
  assert.equal(containsModelId(models(["GPT-4o"]), "   "), false);
});

test("syncSlotsAfterReorder keeps a rename's saved spelling when previousIds is given", () => {
  // The model was renamed a→a2 in place, so the slot still says "a" while the
  // draft already shows "a2". previousIds is the draft order *before* this
  // reorder, so the lookup key is "a2" and the value stays "a".
  assert.deepEqual(syncSlotsAfterReorder(["a", "b"], ["b", "a2"], ["a2", "b"]), ["b", "a"]);
  // Without previousIds the renamed id finds no slot and degrades to unsaved.
  assert.deepEqual(syncSlotsAfterReorder(["a", "b"], ["b", "a2"]), ["b", null]);
});
