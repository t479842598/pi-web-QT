import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const {
  NAMED_ENDPOINT_PRESETS,
  endpointHost,
  filterServiceOptions,
  matchNamedPreset,
  normalizeEndpointUrl,
  presetDiscoveryStyle,
  presetHaystack,
} = await jiti.import("./provider-presets.ts");

const API_SET = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
]);

const byId = (id) => NAMED_ENDPOINT_PRESETS.find((preset) => preset.id === id);

const options = NAMED_ENDPOINT_PRESETS.map((preset) => ({ preset, haystack: presetHaystack(preset) }));

test("presets: every api value belongs to the models.json dialect set", () => {
  for (const preset of NAMED_ENDPOINT_PRESETS) {
    assert.ok(API_SET.has(preset.api), `${preset.id} has api ${preset.api}`);
  }
});

test("presets: ids are unique", () => {
  const ids = NAMED_ENDPOINT_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 25, `only ${ids.length} presets`);
});

test("presets: required vendors are present with the documented endpoints", () => {
  const expected = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    google: "https://generativelanguage.googleapis.com/v1beta",
    openrouter: "https://openrouter.ai/api/v1",
    groq: "https://api.groq.com/openai/v1",
    xai: "https://api.x.ai/v1",
    mistral: "https://api.mistral.ai",
    together: "https://api.together.ai/v1",
    fireworks: "https://api.fireworks.ai/inference",
    deepseek: "https://api.deepseek.com",
    "alibaba-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "moonshotai-cn": "https://api.moonshot.cn/v1",
    moonshotai: "https://api.moonshot.ai/v1",
    zai: "https://api.z.ai/api/paas/v4",
    zhipuai: "https://open.bigmodel.cn/api/paas/v4",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
    "kimi-coding": "https://api.kimi.com/coding/v1",
  };
  for (const [id, baseUrl] of Object.entries(expected)) {
    assert.equal(byId(id)?.baseUrl, baseUrl, id);
  }
  for (const id of ["minimax", "minimax-cn", "kimi-coding"]) {
    assert.equal(byId(id)?.api, "anthropic-messages", id);
  }
  // account-shaped providers must not be offered as a baseUrl + key preset
  for (const id of ["opencode-go", "pi-messages", "codex", "openai-codex", "qwen-token-plan"]) {
    assert.equal(byId(id), undefined, id);
  }
});

test("presets: filterServiceOptions hits the same kimi/moonshot preset for every spelling", () => {
  for (const query of ["kimi", "moonshot", "api.moonshot.cn"]) {
    const hits = filterServiceOptions(options, query).map((option) => option.preset.id);
    assert.ok(hits.length > 0, query);
    const allowed = new Set(["kimi-coding", "moonshotai", "moonshotai-cn"]);
    for (const id of hits) assert.ok(allowed.has(id), `${query} matched ${id}`);
  }
  assert.deepEqual(
    filterServiceOptions(options, "api.moonshot.cn").map((option) => option.preset.id),
    ["moonshotai-cn"],
  );
});

test("presets: empty query returns a copy, unknown query returns nothing", () => {
  const all = filterServiceOptions(options, "");
  assert.equal(all.length, options.length);
  assert.notEqual(all, options);
  assert.deepEqual(filterServiceOptions(options, "no-such-vendor-xyz"), []);
  assert.deepEqual(filterServiceOptions(options, "  KIMI  ").map((option) => option.preset.id).sort(), [
    "kimi-coding",
    "moonshotai",
    "moonshotai-cn",
  ]);
});

test("presets: matchNamedPreset is insensitive to a trailing slash and host case", () => {
  assert.equal(matchNamedPreset({ baseUrl: "https://api.moonshot.cn/v1/" })?.id, "moonshotai-cn");
  assert.equal(matchNamedPreset({ baseUrl: " https://API.MOONSHOT.CN/v1// " })?.id, "moonshotai-cn");
  assert.equal(matchNamedPreset({ baseUrl: "https://api.anthropic.com" })?.id, "anthropic");
  assert.equal(matchNamedPreset({ id: "Kimi-Coding" })?.id, "kimi-coding");
});

test("presets: matchNamedPreset falls back to host plus compatible api", () => {
  // same host, path rewritten by the user, completions family stays compatible
  assert.equal(
    matchNamedPreset({ baseUrl: "https://api.groq.com/openai", api: "openai-responses" })?.id,
    "groq",
  );
  // a host nobody publishes stays unmatched so the caller keeps the typed value
  assert.equal(matchNamedPreset({ baseUrl: "http://127.0.0.1:11434/v1" }), undefined);
  assert.equal(matchNamedPreset({ baseUrl: "https://api.unknown-vendor.example/v1" }), undefined);
  assert.equal(matchNamedPreset({}), undefined);
});

test("presets: normalizeEndpointUrl never throws and folds cosmetic differences", () => {
  assert.equal(normalizeEndpointUrl("https://API.OpenAI.com/v1/"), "https://api.openai.com/v1");
  assert.equal(normalizeEndpointUrl("  https://api.openai.com/v1  "), "https://api.openai.com/v1");
  assert.equal(normalizeEndpointUrl(""), undefined);
  assert.equal(normalizeEndpointUrl(undefined), undefined);
  assert.equal(normalizeEndpointUrl(42), undefined);
  assert.doesNotThrow(() => normalizeEndpointUrl("not a url //"));
  assert.equal(normalizeEndpointUrl("not a url //"), "not a url");
  assert.equal(normalizeEndpointUrl("http://[::1"), "http://[::1");
});

test("presets: endpointHost tolerates a missing protocol and a trailing dot", () => {
  assert.equal(endpointHost("api.moonshot.cn/v1"), "api.moonshot.cn");
  assert.equal(endpointHost("https://API.Anthropic.com"), "api.anthropic.com");
  assert.equal(endpointHost("https://api.openai.com./v1"), "api.openai.com");
  assert.equal(endpointHost(""), undefined);
  assert.equal(endpointHost(undefined), undefined);
});

test("presets: discovery style is derived from api but an explicit value wins", () => {
  assert.equal(presetDiscoveryStyle(byId("anthropic")), "anthropic-models");
  assert.equal(presetDiscoveryStyle(byId("minimax")), "anthropic-models");
  assert.equal(presetDiscoveryStyle(byId("google")), "google-models");
  assert.equal(presetDiscoveryStyle(byId("openai")), "openai-models");
  assert.equal(presetDiscoveryStyle(byId("mistral")), "openai-models");
  assert.equal(
    presetDiscoveryStyle({ ...byId("openai"), discoveryStyle: "anthropic-models" }),
    "anthropic-models",
  );
});
