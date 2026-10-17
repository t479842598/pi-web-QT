import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const {
  NON_CHAT_MODEL_PATTERN,
  PREMIUM_OUTPUT_COST_PER_MILLION,
  RECOMMENDED_MODEL_LIMIT,
  canRecommendFrom,
  dedupeByFamily,
  isChatCapableModelId,
  recommendModelIds,
} = await jiti.import("./recommended-models.ts");

const reliable = (output) => ({ status: "reliable", cost: { output } });

test("constants: the exported knobs match the documented values", () => {
  assert.equal(RECOMMENDED_MODEL_LIMIT, 3);
  assert.equal(PREMIUM_OUTPUT_COST_PER_MILLION, 100);
  assert.ok(NON_CHAT_MODEL_PATTERN instanceof RegExp);
  for (const sample of ["text-embedding-3-large", "bge-reranker-v2", "whisper-1", "dall-e-3", "tts-1"]) {
    assert.ok(NON_CHAT_MODEL_PATTERN.test(sample), sample);
  }
});

test("isChatCapableModelId: filters the non-chat families, keeps chat ids", () => {
  for (const id of [
    "text-embedding-3-large",
    "voyage-embed",
    "rerank-multilingual",
    "omni-moderation-latest",
    "whisper-1",
    "tts-1-hd",
    "gpt-4o-transcribe",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gemini-live-2",
    "gpt-image-1",
    "dall-e-3",
    "imagen-3.0",
    "ocr-model",
    "llama-guard-3",
    "o3-deep-research",
    "computer-use-preview",
    "speech-02",
  ]) {
    assert.equal(isChatCapableModelId(id), false, id);
  }
  for (const id of [
    "gpt-5.1",
    "claude-sonnet-4-5",
    "deepseek-chat",
    "qwen3-max",
    "glm-4.6",
    "kimi-k2",
    "gemini-2.5-pro",
    "grok-4",
    "",
  ]) {
    assert.equal(isChatCapableModelId(id), id !== "", id);
  }
});

test("dedupeByFamily: one entry per family, input order kept, limit honoured", () => {
  assert.deepEqual(
    dedupeByFamily(["gpt-5.1", "gpt-5.1-mini", "claude-sonnet-4-5", "claude-opus-4-1", "gemini-2.5-pro"]),
    ["gpt-5.1", "claude-sonnet-4-5", "gemini-2.5-pro"],
  );
  // a slash-prefixed id dedupes on its last segment
  assert.deepEqual(
    dedupeByFamily(["openrouter/openai/gpt-5", "openrouter/anthropic/claude-4"]),
    ["openrouter/openai/gpt-5", "openrouter/anthropic/claude-4"],
  );
  assert.deepEqual(dedupeByFamily(["gpt-5", "gpt-5-mini"]), ["gpt-5"]);
  assert.deepEqual(dedupeByFamily(["a-1", "b-1", "c-1", "d-1"], 2), ["a-1", "b-1"]);
  assert.deepEqual(dedupeByFamily(["a-1"], 0), []);
  assert.deepEqual(dedupeByFamily([]), []);
});

test("canRecommendFrom: only a clean ready discovery qualifies", () => {
  assert.equal(canRecommendFrom({ status: "ready", source: "network" }), true);
  assert.equal(canRecommendFrom({ status: "ready" }), true);
  assert.equal(canRecommendFrom({ status: "ready", source: "error" }), false);
  assert.equal(canRecommendFrom({ status: "ready", error: "boom" }), false);
  assert.equal(canRecommendFrom({ status: "loading" }), false);
  assert.equal(canRecommendFrom({ status: "idle" }), false);
  assert.equal(canRecommendFrom({ status: "error", error: "401" }), false);
});

test("recommendModelIds: an all-non-chat list recommends nothing", () => {
  assert.deepEqual(
    recommendModelIds({ models: [{ id: "text-embedding-3-small" }, { id: "whisper-1" }] }),
    { ids: [], reason: "empty" },
  );
  assert.deepEqual(recommendModelIds({ models: [] }), { ids: [], reason: "empty" });
});

test("recommendModelIds: without catalog metadata only the first chat model is picked", () => {
  const models = [{ id: "text-embedding-3-small" }, { id: "gpt-5.1" }, { id: "claude-sonnet-4-5" }];
  assert.deepEqual(recommendModelIds({ models }), { ids: ["gpt-5.1"], reason: "first-only" });
  // a preset without a trustworthy price is the same tier
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "GPT-5.1" }, catalogPrice: { status: "unreliable" } }),
    { ids: ["gpt-5.1"], reason: "first-only" },
  );
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "GPT-5.1" }, catalogPrice: null }),
    { ids: ["gpt-5.1"], reason: "first-only" },
  );
});

test("recommendModelIds: reliable catalog metadata ranks up to three families", () => {
  const models = [
    { id: "gpt-5.1" },
    { id: "gpt-5.1-mini" },
    { id: "claude-sonnet-4-5" },
    { id: "claude-opus-4-1" },
    { id: "gemini-2.5-pro" },
    { id: "deepseek-chat" },
  ];
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "GPT-5.1" }, catalogPrice: reliable(10) }),
    { ids: ["gpt-5.1", "claude-sonnet-4-5", "gemini-2.5-pro"], reason: "catalog-ranked" },
  );
});

test("recommendModelIds: premium output cost is demoted behind standard candidates", () => {
  const models = [
    { id: "expensive-pro", cost: { output: 600 } },
    { id: "cheap-flash", cost: { output: 2 } },
    { id: "mid-standard", cost: { output: 15 } },
  ];
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "x" }, catalogPrice: reliable(10) }),
    { ids: ["cheap-flash", "mid-standard", "expensive-pro"], reason: "catalog-ranked" },
  );
});

test("recommendModelIds: a per-model price overrides the preset price in both directions", () => {
  // preset says the flagship is premium, but this candidate is cheap
  const cheap = [{ id: "flash", cost: { output: 1 } }, { id: "pro", cost: { output: 900 } }];
  assert.deepEqual(
    recommendModelIds({ models: cheap, catalogPreset: { name: "x" }, catalogPrice: reliable(500) }),
    { ids: ["flash", "pro"], reason: "catalog-ranked" },
  );
  // preset is cheap, one candidate is premium → it drops behind the others
  const mixed = [{ id: "a-premium", cost: { output: 400 } }, { id: "b-plain" }, { id: "c-plain" }];
  assert.deepEqual(
    recommendModelIds({ models: mixed, catalogPreset: { name: "x" }, catalogPrice: reliable(1) }),
    { ids: ["b-plain", "c-plain", "a-premium"], reason: "catalog-ranked" },
  );
});

test("recommendModelIds: a uniform premium preset price keeps the discovery order", () => {
  // Documented no-op: every candidate inherits the same price, so sorting on it
  // cannot reorder anything. The reason still says the catalog was consulted.
  const models = [{ id: "gpt-5.1" }, { id: "claude-opus-4-1" }];
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "x" }, catalogPrice: reliable(800) }),
    { ids: ["gpt-5.1", "claude-opus-4-1"], reason: "catalog-ranked" },
  );
});

test("recommendModelIds: a non-chat model never occupies a recommended slot", () => {
  const models = [
    { id: "text-embedding-3-large" },
    { id: "whisper-1" },
    { id: "gpt-5.1" },
  ];
  assert.deepEqual(recommendModelIds({ models }), { ids: ["gpt-5.1"], reason: "first-only" });
  assert.deepEqual(
    recommendModelIds({ models, catalogPreset: { name: "GPT-5.1" }, catalogPrice: reliable(10) }),
    { ids: ["gpt-5.1"], reason: "catalog-ranked" },
  );
});
