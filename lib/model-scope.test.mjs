import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-scope.ts");
  } catch {
    return import("./model-scope.ts");
  }
}

const { resolveVisibleModels, selectInitialModelScope, invalidateAvailableModelsCache } = await loadSubject();

const MODELS = [
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", provider: "acme-gateway", name: "Claude Opus 4.8 (Acme)" },
  { id: "claude-sonnet-5", provider: "acme-gateway", name: "Claude Sonnet 5 (Acme)" },
  { id: "gpt-5.6-sol", provider: "acme-gateway-openai", name: "GPT-5.6 (Acme)" },
];

const runtime = { getAvailable: async () => MODELS };

const refs = (result) => result.visible.map((m) => `${m.provider}/${m.id}`);

test("returns every available model when no patterns are configured", async () => {
  for (const patterns of [undefined, [], ["", "   "]]) {
    const result = await resolveVisibleModels(runtime, patterns);
    assert.deepEqual(refs(result), MODELS.map((m) => `${m.provider}/${m.id}`));
    assert.deepEqual(result.scopedModels, []);
    assert.deepEqual(result.warnings, []);
  }
});

test("expands provider globs alongside exact references (#307)", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-5",
    "acme-gateway/*",
    "acme-gateway-openai/*",
  ]);

  assert.deepEqual(refs(result).sort(), [
    "acme-gateway-openai/gpt-5.6-sol",
    "acme-gateway/claude-opus-4-8",
    "acme-gateway/claude-sonnet-5",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("matches bare model id globs across providers without duplicates", async () => {
  const result = await resolveVisibleModels(runtime, ["*sonnet*"]);

  assert.deepEqual(refs(result).sort(), [
    "acme-gateway/claude-sonnet-5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-sonnet-5",
  ]);
});

test("rejects an ambiguous bare exact model id before fuzzy matching", async () => {
  await assert.rejects(
    resolveVisibleModels(runtime, ["claude-sonnet-5"]),
    /Ambiguous enabledModels entry.*acme-gateway\/claude-sonnet-5.*anthropic\/claude-sonnet-5.*provider\/modelId/,
  );
});

test("accepts provider-qualified and unique bare exact model ids", async () => {
  const qualified = await resolveVisibleModels(runtime, ["acme-gateway/claude-sonnet-5"]);
  assert.deepEqual(refs(qualified), ["acme-gateway/claude-sonnet-5"]);

  const unique = await resolveVisibleModels(runtime, ["gpt-5.6-sol"]);
  assert.deepEqual(refs(unique), ["acme-gateway-openai/gpt-5.6-sol"]);
});

test("rejects an ambiguous bare exact model id with a thinking suffix", async () => {
  await assert.rejects(
    resolveVisibleModels(runtime, ["claude-sonnet-5:high"]),
    /Ambiguous enabledModels entry/,
  );
});

test("keeps thinking-level suffixes out of the matched reference and reports them as pins", async () => {
  const pinned = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.deepEqual(refs(pinned).sort(), [
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-sonnet-5",
  ]);
  assert.deepEqual(pinned.thinkingLevelPins, {
    "anthropic/claude-opus-5": "high",
    "anthropic/claude-sonnet-5": "high",
    "anthropic/claude-sonnet-4-6": "high",
  });

  const single = await resolveVisibleModels(runtime, ["acme-gateway/claude-opus-4-8:low"]);
  assert.deepEqual(refs(single), ["acme-gateway/claude-opus-4-8"]);
  assert.deepEqual(single.thinkingLevelPins, { "acme-gateway/claude-opus-4-8": "low" });
});

test("leaves models without a pinned thinking level unpinned", async () => {
  const result = await resolveVisibleModels(runtime, ["anthropic/claude-opus-5:high", "acme-gateway/*"]);

  assert.deepEqual(result.thinkingLevelPins, { "anthropic/claude-opus-5": "high" });
});

test("keeps models that matched and stays quiet about leftover unmatched globs", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5",
    "retired-provider/old-model-*",
    "ghost-gateway/*",
  ]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, []);
});

test("keeps unmatched exact and malformed glob warnings when another model matches", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5",
    "typo-model",
    "ghost-gateway/*:bogus",
  ]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, [
    'No models match pattern "typo-model"',
    'No models match pattern "ghost-gateway/*:bogus"',
  ]);
});

test("falls back to all available models when nothing matches at all", async () => {
  const result = await resolveVisibleModels(runtime, ["ghost-gateway/*"]);

  assert.deepEqual(refs(result), MODELS.map((m) => `${m.provider}/${m.id}`));
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.scopedModels, []);
  assert.deepEqual(result.thinkingLevelPins, {});
});

test("selects the saved scoped default and applies its thinking pin", async () => {
  const scope = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5:high",
    "acme-gateway/*:low",
  ]);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway", modelId: "claude-sonnet-5" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "acme-gateway/claude-sonnet-5");
  assert.equal(initial.thinkingLevel, "low");
  assert.equal(initial.scopedModels.length, 3);
});

test("uses the saved default without creating a synthetic scope when unconfigured", async () => {
  const scope = await resolveVisibleModels(runtime, undefined);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway-openai", modelId: "gpt-5.6-sol" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "acme-gateway-openai/gpt-5.6-sol");
  assert.equal(initial.thinkingLevel, undefined);
  assert.deepEqual(initial.scopedModels, []);
});

test("uses resolver order when the saved default is outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5:high",
    "anthropic/claude-sonnet-5:low",
  ]);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway-openai", modelId: "gpt-5.6-sol" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "anthropic/claude-opus-5");
  assert.equal(initial.thinkingLevel, "high");
});

test("applies a requested scoped model pin unless thinking was explicitly overridden", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  const requestedModel = { provider: "anthropic", modelId: "claude-sonnet-5" };

  assert.equal(
    selectInitialModelScope(scope, { requestedModel }).thinkingLevel,
    "high",
  );
  assert.equal(
    selectInitialModelScope(scope, { requestedModel, thinkingLevel: "low" }).thinkingLevel,
    "low",
  );
  assert.equal(
    selectInitialModelScope(scope, { requestedModel, thinkingLevel: "off" }).thinkingLevel,
    "off",
  );
});

test("rejects an explicit model outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*"]);

  assert.throws(
    () => selectInitialModelScope(scope, {
      requestedModel: { provider: "acme-gateway", modelId: "claude-sonnet-5" },
    }),
    /not available in the enabled scope/,
  );
});

test("rejects an explicit model outside the enabled scope with a thinking pin", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.throws(
    () => selectInitialModelScope(scope, { requestedModel: { provider: "gateway", modelId: "claude-sonnet" } }),
    /not available in the enabled scope/,
  );
  assert.equal(
    selectInitialModelScope(scope, { defaultModel: { provider: "anthropic", modelId: "claude-opus-5" } }).thinkingLevel,
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
  assert.deepEqual(refs(first), []);

  // User adds a provider; the in-process list now has models, but the stale
  // empty list is still cached — a bare reload would keep showing no models.
  available = MODELS;
  const stillEmpty = await resolveVisibleModels(emptyRuntime, undefined);
  assert.deepEqual(refs(stillEmpty), []);
  assert.equal(calls, 1);

  // The auth routes must call invalidateAvailableModelsCache() — once they do,
  // the next load re-enumerates and sees the provider's models immediately.
  invalidateAvailableModelsCache();
  const refreshed = await resolveVisibleModels(emptyRuntime, undefined);
  assert.deepEqual(refs(refreshed), MODELS.map((m) => `${m.provider}/${m.id}`));
  assert.equal(calls, 2);
});
