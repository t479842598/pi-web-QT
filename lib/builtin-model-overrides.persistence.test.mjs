import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { applyBuiltinOverridePatches, buildOverridePatches, getEffectiveOverrides } = await createJiti(import.meta.url)
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
  const next = applyBuiltinOverridePatches({
    models: [{ id: "m", contextWindow: 64000 }],
    modelOverrides: { m: { contextWindow: 256000 } },
  }, { m: { contextWindow: null } });
  assert.equal(next.models, undefined);
  assert.equal(next.modelOverrides, undefined);
});

test("hidden is read from modelOverrides without changing SDK model fields", () => {
  const next = applyBuiltinOverridePatches({}, { m: { hidden: true } });
  assert.deepEqual(next.modelOverrides, { m: { hidden: true } });
  assert.equal(next.models, undefined);
});
