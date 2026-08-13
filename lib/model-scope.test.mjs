import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveVisibleModels, selectInitialModelScope, invalidateAvailableModelsCache } = await createJiti(import.meta.url).import("./model-scope.ts");

const models = [
  { id: "claude-opus", provider: "anthropic", name: "Claude Opus" },
  { id: "claude-sonnet", provider: "anthropic", name: "Claude Sonnet" },
  { id: "claude-sonnet", provider: "gateway", name: "Gateway Sonnet" },
];
const runtime = { getAvailable: async () => models };
const references = (scope) => scope.visible.map((model) => `${model.provider}/${model.id}`).sort();

test("uses pi resolver for provider and bare-model globs", async () => {
  const providerScope = await resolveVisibleModels(runtime, ["gateway/*"]);
  assert.deepEqual(references(providerScope), ["gateway/claude-sonnet"]);

  const modelScope = await resolveVisibleModels(runtime, ["*sonnet*"]);
  assert.deepEqual(references(modelScope), ["anthropic/claude-sonnet", "gateway/claude-sonnet"]);
});

test("retains thinking pins and falls back when every enabled pattern misses", async () => {
  const pinned = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.equal(pinned.thinkingLevelPins["anthropic/claude-opus"], "high");
  assert.equal(pinned.thinkingLevelPins["anthropic/claude-sonnet"], "high");

  const missed = await resolveVisibleModels(runtime, ["missing/*"]);
  assert.deepEqual(references(missed), references({ visible: models }));
  assert.equal(missed.scopedModels.length, 0);
  assert.equal(missed.warnings.length, 1);
});

test("rejects an explicit model outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.throws(
    () => selectInitialModelScope(scope, { requestedModel: { provider: "gateway", modelId: "claude-sonnet" } }),
    /not available in the enabled scope/,
  );
  assert.equal(
    selectInitialModelScope(scope, { defaultModel: { provider: "anthropic", modelId: "claude-opus" } }).thinkingLevel,
    "high",
  );
});

test("fresh-install empty model list is dropped by invalidateAvailableModelsCache", async () => {
  // Fresh install: no credentials, so getAvailable() resolves to an empty list.
  // Start from a clean cache — earlier tests cached a populated list.
  invalidateAvailableModelsCache();
  let available = [];
  let calls = 0;
  const emptyRuntime = { getAvailable: async () => { calls += 1; return available; } };

  // First load caches the empty list (what happens on page open before auth).
  const first = await resolveVisibleModels(emptyRuntime, undefined);
  assert.deepEqual(references(first), []);

  // User adds a provider; the in-process list now has models, but the stale
  // empty list is still cached — a bare reload would keep showing no models.
  available = models;
  const stillEmpty = await resolveVisibleModels(emptyRuntime, undefined);
  assert.deepEqual(references(stillEmpty), []);
  assert.equal(calls, 1);

  // The auth routes must call invalidateAvailableModelsCache() — once they do,
  // the next load re-enumerates and sees the provider's models immediately.
  invalidateAvailableModelsCache();
  const refreshed = await resolveVisibleModels(emptyRuntime, undefined);
  assert.deepEqual(references(refreshed), references({ visible: models }));
  assert.equal(calls, 2);
});
