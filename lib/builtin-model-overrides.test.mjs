import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildOverrideEntries, mergeIntoProviders } = await jiti.import("./builtin-model-overrides.ts");

test("buildOverrideEntries keeps only meaningful values", () => {
  const entries = buildOverrideEntries(["a", "b", "c"], {
    a: { reasoning: true, contextWindow: 128000, maxTokens: 32768 },
    b: { reasoning: false },
    c: { contextWindow: 0, maxTokens: -1, thinkingLevelMap: {} },
  });
  assert.deepEqual(entries, [
    { id: "a", reasoning: true, contextWindow: 128000, maxTokens: 32768 },
    { id: "b", reasoning: false },
    { id: "c" }, // cleared → removal marker
  ]);
});

test("buildOverrideEntries keeps thinkingLevelMap with entries", () => {
  const entries = buildOverrideEntries(["m"], {
    m: { thinkingLevelMap: { low: "low-v2", high: null } },
  });
  assert.deepEqual(entries, [{ id: "m", thinkingLevelMap: { low: "low-v2", high: null } }]);
});

test("buildOverrideEntries skips unknown drafts and empty results", () => {
  assert.deepEqual(buildOverrideEntries(["x"], {}), []);
  assert.deepEqual(buildOverrideEntries([], {}), []);
});

test("mergeIntoProviders replaces dirty entries and keeps others", () => {
  const providers = {
    deepseek: {
      models: [
        { id: "deepseek-chat", contextWindow: 64000 },
        { id: "deepseek-reasoner", maxTokens: 8192 },
      ],
    },
  };
  const next = mergeIntoProviders(providers, "deepseek", [
    { id: "deepseek-chat", maxTokens: 32768 },
  ]);
  assert.deepEqual(next.deepseek.models, [
    { id: "deepseek-reasoner", maxTokens: 8192 },
    { id: "deepseek-chat", maxTokens: 32768 },
  ]);
  assert.deepEqual(providers, providers); // input untouched
});

test("mergeIntoProviders creates provider entry when missing", () => {
  const next = mergeIntoProviders({}, "anthropic", [{ id: "claude-x", reasoning: true }]);
  assert.deepEqual(next.anthropic.models, [{ id: "claude-x", reasoning: true }]);
});

test("mergeIntoProviders removes overlay entry and provider when cleared", () => {
  const providers = {
    deepseek: { models: [{ id: "deepseek-chat", maxTokens: 32768 }] },
  };
  // dirty model serialized with no values → bare { id } marks removal
  const next = mergeIntoProviders(providers, "deepseek", [{ id: "deepseek-chat" }]);
  assert.equal("deepseek" in next, false);
});

test("buildOverrideEntries emits bare id for cleared drafts", () => {
  assert.deepEqual(buildOverrideEntries(["x"], { x: { contextWindow: 0 } }), [{ id: "x" }]);
});
