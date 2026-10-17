import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const { apiStyleLabel, inferApiStyle, resolveEndpointDraft } = await jiti.import(
  "./provider-api-style.ts",
);

test("inferApiStyle: anthropic host and /v1/messages path", () => {
  assert.equal(inferApiStyle("https://api.anthropic.com"), "anthropic-messages");
  assert.equal(inferApiStyle("https://api.anthropic.com/v1"), "anthropic-messages");
  assert.equal(inferApiStyle("https://proxy.example.com/v1/messages"), "anthropic-messages");
  assert.equal(inferApiStyle("https://proxy.example.com/v1/messages/"), "anthropic-messages");
});

test("inferApiStyle: google host and /v1beta path", () => {
  assert.equal(inferApiStyle("https://generativelanguage.googleapis.com/v1beta"), "google-generative-ai");
  assert.equal(inferApiStyle("https://generativelanguage.googleapis.com"), "google-generative-ai");
  assert.equal(inferApiStyle("https://gateway.example.com/v1beta"), "google-generative-ai");
});

test("inferApiStyle: mistral host", () => {
  assert.equal(inferApiStyle("https://api.mistral.ai"), "mistral-conversations");
  assert.equal(inferApiStyle("https://api.mistral.ai/v1"), "mistral-conversations");
});

test("inferApiStyle: openai responses by path and by host", () => {
  assert.equal(inferApiStyle("https://api.openai.com/v1/responses"), "openai-responses");
  assert.equal(inferApiStyle("https://api.openai.com/v1/responses/"), "openai-responses");
  assert.equal(inferApiStyle("https://relay.example.com/responses"), "openai-responses");
  assert.equal(inferApiStyle("https://relay.example.com/v1/responses"), "openai-responses");
});

test("inferApiStyle: an indistinguishable endpoint answers undefined", () => {
  assert.equal(inferApiStyle("http://127.0.0.1:11434/v1"), undefined);
  assert.equal(inferApiStyle("http://localhost:8080/v1"), undefined);
  assert.equal(inferApiStyle("https://api.openai.com/v1"), undefined);
  assert.equal(inferApiStyle("https://openrouter.ai/api/v1"), undefined);
  assert.equal(inferApiStyle(""), undefined);
  assert.equal(inferApiStyle(undefined), undefined);
  assert.equal(inferApiStyle("   "), undefined);
});

test("inferApiStyle: host wins over a conflicting path", () => {
  assert.equal(inferApiStyle("https://api.anthropic.com/v1beta"), "anthropic-messages");
  assert.equal(inferApiStyle("https://api.mistral.ai/v1/responses"), "mistral-conversations");
});

test("resolveEndpointDraft: a locked row is never rewritten", () => {
  assert.deepEqual(
    resolveEndpointDraft({ baseUrl: "https://api.anthropic.com", current: "openai-completions", locked: true }),
    { api: "openai-completions", autoDetected: false },
  );
});

test("resolveEndpointDraft: a detected change always carries a note", () => {
  const draft = resolveEndpointDraft({
    baseUrl: "https://api.anthropic.com",
    current: "openai-completions",
    locked: false,
  });
  assert.equal(draft.api, "anthropic-messages");
  assert.equal(draft.autoDetected, true);
  assert.equal(typeof draft.note, "string");
  assert.ok(draft.note.length > 0);
  assert.ok(draft.note.includes("Anthropic Messages"));
});

test("resolveEndpointDraft: no inference or no difference keeps the current value", () => {
  assert.deepEqual(
    resolveEndpointDraft({ baseUrl: "http://127.0.0.1:11434/v1", current: "openai-completions", locked: false }),
    { api: "openai-completions", autoDetected: false },
  );
  const same = resolveEndpointDraft({
    baseUrl: "https://api.anthropic.com",
    current: "anthropic-messages",
    locked: false,
  });
  assert.deepEqual(same, { api: "anthropic-messages", autoDetected: false });
  assert.equal(same.note, undefined);
});

test("resolveEndpointDraft: every auto change is paired with a note", () => {
  const cases = [
    ["https://generativelanguage.googleapis.com/v1beta", "google-generative-ai"],
    ["https://api.mistral.ai", "mistral-conversations"],
    ["https://api.openai.com/v1/responses", "openai-responses"],
  ];
  for (const [baseUrl, api] of cases) {
    const draft = resolveEndpointDraft({ baseUrl, current: "openai-completions", locked: false });
    assert.equal(draft.api, api);
    assert.equal(draft.autoDetected, true);
    assert.ok(draft.note && draft.note.length > 0, baseUrl);
  }
  // the invariant in the other direction: changed api without a note is impossible
  const draft = resolveEndpointDraft({ baseUrl: "https://api.mistral.ai", current: "openai-completions", locked: false });
  assert.ok(draft.api !== "openai-completions" ? Boolean(draft.note) : draft.note === undefined);
});

test("apiStyleLabel: english labels for every dialect, unknown falls through", () => {
  assert.equal(apiStyleLabel("openai-completions"), "OpenAI Chat Completions");
  assert.equal(apiStyleLabel("openai-responses"), "OpenAI Responses");
  assert.equal(apiStyleLabel("anthropic-messages"), "Anthropic Messages");
  assert.equal(apiStyleLabel("google-generative-ai"), "Google Generative AI");
  assert.equal(apiStyleLabel("mistral-conversations"), "Mistral Conversations");
  assert.equal(apiStyleLabel("something-else"), "something-else");
});
