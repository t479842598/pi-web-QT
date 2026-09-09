import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { applyBuiltinOverridePatches, buildOverridePatches, getEffectiveOverrides, upsertBuiltinModels } = await createJiti(import.meta.url)
  .import("./builtin-model-overrides.ts");

test("buildOverridePatches emits only changed fields and deletion markers", () => {
  const initial = {
    a: { reasoning: true, contextWindow: 128000, thinkingLevelMap: { low: "low" } },
    b: { reasoning: false },
  };
  const drafts = {
    a: { reasoning: false, contextWindow: 256000 },
    b: { reasoning: false },
  };
  assert.deepEqual(buildOverridePatches(["a", "b"], drafts, initial), {
    a: { reasoning: false, contextWindow: 256000, thinkingLevelMap: null },
  });
});

test("new modelOverrides take precedence over legacy models entries", () => {
  const effective = getEffectiveOverrides({
    models: [{ id: "m", contextWindow: 64000, maxTokens: 8192, api: "openai-completions" }],
    modelOverrides: { m: { contextWindow: 256000, hidden: true } },
  });
  assert.deepEqual(effective.m, {
    id: "m",
    contextWindow: 256000,
    maxTokens: 8192,
    api: "openai-completions",
    hidden: true,
  });
});

test("patches preserve legacy transport fields and move managed fields", () => {
  const next = applyBuiltinOverridePatches({
    api: "openai-completions",
    models: [{ id: "m", api: "openai-completions", contextWindow: 64000, maxTokens: 8192, compat: { thinkingFormat: "deepseek" } }],
  }, {
    m: { contextWindow: 256000, maxTokens: 32768 },
  });
  assert.deepEqual(next.models, [{ id: "m", api: "openai-completions", compat: { thinkingFormat: "deepseek" } }]);
  assert.deepEqual(next.modelOverrides, { m: { contextWindow: 256000, maxTokens: 32768 } });
});

test("clearing a managed override migrates the legacy field back to builtin defaults", () => {
  // Pruning is opt-in via builtinModelIds: only ids the SDK registry provides
  // may drop their now-redundant models[] shell.
  const next = applyBuiltinOverridePatches({
    models: [{ id: "m", contextWindow: 64000 }],
    modelOverrides: { m: { contextWindow: 256000 } },
  }, { m: { contextWindow: null } }, { builtinModelIds: new Set(["m"]) });
  assert.equal(next.models, undefined);
  assert.equal(next.modelOverrides, undefined);
});

test("a user-created model is never pruned by an override edit", () => {
  // Regression: models[] entries this UI created for a new model id are only
  // `{ id }` plus the marker. The old pruner deleted them the moment the user
  // edited one of their overrides, so the model silently vanished.
  const next = applyBuiltinOverridePatches({
    models: [{ id: "user-model", piWebCustom: true }],
  }, { "user-model": { contextWindow: 128000 } }, { builtinModelIds: new Set(["some-builtin"]) });
  assert.deepEqual(next.models, [{ id: "user-model", piWebCustom: true }]);
  assert.deepEqual(next.modelOverrides, { "user-model": { contextWindow: 128000 } });
});

test("an unknown models[] id survives even without the marker (fail safe)", () => {
  // When the registry cannot be read the caller passes no ids; keeping an extra
  // entry is harmless, deleting a user's model is not.
  const next = applyBuiltinOverridePatches({
    models: [{ id: "mystery" }],
  }, { mystery: { reasoning: true } });
  assert.deepEqual(next.models, [{ id: "mystery" }]);
});

test("upsertBuiltinModels adds a new id with the custom marker and preserves others", () => {
  const next = upsertBuiltinModels({
    modelOverrides: { existing: { name: "renamed" } },
    models: [{ id: "existing-model" }],
  }, [{ id: "brand-new", name: "Brand New", input: ["text", "image"] }]);

  assert.deepEqual(next.models, [
    { id: "existing-model" },
    { id: "brand-new", name: "Brand New", input: ["text", "image"], piWebCustom: true },
  ]);
  // The override block is untouched by a models[] upsert.
  assert.deepEqual(next.modelOverrides, { existing: { name: "renamed" } });
});

test("upsertBuiltinModels replaces an existing id in place and keeps its marker", () => {
  const next = upsertBuiltinModels({
    models: [{ id: "mine", piWebCustom: true, name: "Old" }],
  }, [{ id: "mine", name: "New" }]);
  assert.deepEqual(next.models, [{ id: "mine", piWebCustom: true, name: "New" }]);
});

test("upsertBuiltinModels does not clear fields the upsert omits", () => {
  const next = upsertBuiltinModels({
    models: [{ id: "mine", contextWindow: 128000, maxTokens: 8192 }],
  }, [{ id: "mine", input: ["text", "image"] }]);
  assert.deepEqual(next.models, [{ id: "mine", contextWindow: 128000, maxTokens: 8192, input: ["text", "image"] }]);
});

test("hidden is read from modelOverrides without changing SDK model fields", () => {
  const next = applyBuiltinOverridePatches({}, { m: { hidden: true } });
  assert.deepEqual(next.modelOverrides, { m: { hidden: true } });
  assert.equal(next.models, undefined);
});

test("newly imported model with no initial draft still emits patches (regression)", () => {
  // Reproduces the "import new model → edit context/maxTokens → save silently
  // dropped" bug: models added via the discovery flow have no entry in
  // initialDrafts, and buildOverridePatches used to skip them entirely.
  const initial = { existing: { reasoning: false } };
  const drafts = {
    existing: { reasoning: false },
    brandnew: { contextWindow: 256000, maxTokens: 16384 },
  };
  const patches = buildOverridePatches(["brandnew"], drafts, initial);
  assert.deepEqual(patches, {
    brandnew: { contextWindow: 256000, maxTokens: 16384 },
  });
});
