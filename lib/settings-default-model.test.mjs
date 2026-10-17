import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { resolveDefaultModel, sameModelRef } = await jiti.import("./settings-default-model.ts");

const AVAILABLE = [
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "anthropic", id: "claude-opus-4-1" },
  { provider: "openai", id: "gpt-5.5" },
  { provider: "openrouter", id: "sakana/fugu-ultra" },
  { provider: "CommandCode", id: "stepfun/Step-5-Preview" },
];

test("a stored default that still exists resolves and keeps its original casing", () => {
  const stored = { provider: "anthropic", modelId: "claude-sonnet-4-5" };
  const result = resolveDefaultModel(stored, AVAILABLE);
  assert.equal(result.available, true);
  assert.deepEqual(result.resolved, { provider: "anthropic", modelId: "claude-sonnet-4-5" });
  // Identity, not equality: the value written back must be the caller's own
  // object so a read can never normalize the user's spelling.
  assert.equal(result.resolved, stored);
});

test("matching is case-insensitive but never rewrites the output", () => {
  const stored = { provider: "Anthropic", modelId: "Claude-Sonnet-4-5" };
  const result = resolveDefaultModel(stored, AVAILABLE);
  assert.equal(result.available, true);
  assert.deepEqual(result.resolved, { provider: "Anthropic", modelId: "Claude-Sonnet-4-5" });
  assert.equal(result.resolved, stored);

  const lowerCatalog = resolveDefaultModel(
    { provider: "commandcode", modelId: "stepfun/step-5-preview" },
    AVAILABLE,
  );
  assert.equal(lowerCatalog.available, true);
  assert.deepEqual(lowerCatalog.resolved, {
    provider: "commandcode",
    modelId: "stepfun/step-5-preview",
  });
});

test("a provider that no longer exists degrades to unavailable instead of a pairing", () => {
  const result = resolveDefaultModel({ provider: "zenmux", modelId: "gpt-5.5" }, AVAILABLE);
  assert.equal(result.available, false);
  assert.equal(result.resolved, null);
});

test("a model id removed or renamed under an existing provider degrades too", () => {
  const result = resolveDefaultModel({ provider: "anthropic", modelId: "claude-sonnet-4-0" }, AVAILABLE);
  assert.equal(result.available, false);
  assert.equal(result.resolved, null);
});

test("null, empty and whitespace-only references all mean unset", () => {
  assert.deepEqual(resolveDefaultModel(null, AVAILABLE), { resolved: null, available: false });
  assert.deepEqual(
    resolveDefaultModel({ provider: "", modelId: "claude-sonnet-4-5" }, AVAILABLE),
    { resolved: null, available: false },
  );
  assert.deepEqual(
    resolveDefaultModel({ provider: "anthropic", modelId: "   " }, AVAILABLE),
    { resolved: null, available: false },
  );
  assert.deepEqual(
    resolveDefaultModel({ provider: "  ", modelId: "  " }, AVAILABLE),
    { resolved: null, available: false },
  );
});

test("nested model ids keep their slash instead of being split into a path", () => {
  const result = resolveDefaultModel({ provider: "openrouter", modelId: "sakana/fugu-ultra" }, AVAILABLE);
  assert.equal(result.available, true);
  assert.deepEqual(result.resolved, { provider: "openrouter", modelId: "sakana/fugu-ultra" });

  // The provider segment is not a path prefix: "openrouter/sakana/fugu-ultra"
  // must not be matched by a provider named "openrouter/sakana".
  const wrongPrefix = resolveDefaultModel(
    { provider: "openrouter/sakana", modelId: "fugu-ultra" },
    AVAILABLE,
  );
  assert.equal(wrongPrefix.available, false);
  assert.equal(wrongPrefix.resolved, null);
});

test("a provider match alone is not enough — the model id must match too", () => {
  const result = resolveDefaultModel({ provider: "anthropic", modelId: "gpt-5.5" }, AVAILABLE);
  assert.equal(result.available, false);
  assert.equal(result.resolved, null);
});

test("an empty catalog makes every stored default unavailable", () => {
  assert.deepEqual(
    resolveDefaultModel({ provider: "anthropic", modelId: "claude-sonnet-4-5" }, []),
    { resolved: null, available: false },
  );
});

test("sameModelRef accepts both the SDK id field and the settings modelId field", () => {
  const settingsRef = { provider: "anthropic", modelId: "claude-sonnet-4-5" };
  assert.equal(sameModelRef({ provider: "anthropic", id: "claude-sonnet-4-5" }, settingsRef), true);
  assert.equal(sameModelRef({ provider: "anthropic", modelId: "claude-sonnet-4-5" }, settingsRef), true);
  assert.equal(sameModelRef({ provider: "Anthropic", id: "CLAUDE-SONNET-4-5" }, settingsRef), true);
  assert.equal(sameModelRef({ provider: "openai", id: "claude-sonnet-4-5" }, settingsRef), false);
  assert.equal(sameModelRef({ provider: "anthropic", id: "claude-opus-4-1" }, settingsRef), false);
});

test("sameModelRef never treats two absent references as a match", () => {
  assert.equal(sameModelRef(null, null), false);
  assert.equal(sameModelRef(undefined, { provider: "anthropic", modelId: "claude-sonnet-4-5" }), false);
  assert.equal(sameModelRef({ provider: "anthropic", id: "claude-sonnet-4-5" }, null), false);
  assert.equal(sameModelRef({ provider: "", id: "" }, { provider: "", modelId: "" }), false);
});

test("sameModelRef keeps nested ids intact", () => {
  assert.equal(
    sameModelRef({ provider: "openrouter", id: "sakana/fugu-ultra" }, {
      provider: "openrouter",
      modelId: "sakana/fugu-ultra",
    }),
    true,
  );
  assert.equal(
    sameModelRef({ provider: "openrouter", id: "sakana/fugu" }, {
      provider: "openrouter",
      modelId: "sakana/fugu-ultra",
    }),
    false,
  );
});
