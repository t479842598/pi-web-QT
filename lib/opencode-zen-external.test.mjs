import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Isolate the agent dir so tests never touch the real ~/.pi/agent config.
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-oczen-ext-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { filterFreeModels, startExternalAccessServer, stopExternalAccessServer, openAiRateLimitError, readBody, normalizeResponsesBody, summarizeRequestBody } = await createJiti(import.meta.url).import("./opencode-zen-external.ts");
const { getErrorLogs } = await createJiti(import.meta.url).import("./error-log.ts");
const { readOpenCodeZenConfig, mergeOpenCodeZenConfig, nextAccount, nextUtcMidnight } = await createJiti(import.meta.url).import("./opencode-zen.ts");

function freePort() {
  return 40_000 + Math.floor(Math.random() * 20_000);
}

function writeConfig(overrides = {}) {
  const config = {
    accounts: [],
    autoSwitch: true,
    cooldownMs: 60_000,
    externalAccess: { enabled: true, port: 0, apiKey: "test-external-key" },
    ...overrides,
  };
  const configPath = join(agentDir, "opencode-zen.json");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config));
  // Reset the in-memory state so the fresh file is loaded.
  globalThis.__piOpenCodeZenState = undefined;
}

test("filterFreeModels keeps only ids ending with -free", () => {
  const payload = {
    object: "list",
    data: [
      { id: "mimo-v2.5-free", object: "model" },
      { id: "gpt-5.6-luna", object: "model" },
      { id: "deepseek-v4-flash-free", object: "model" },
    ],
  };
  const filtered = filterFreeModels(payload);
  assert.deepEqual(filtered.data.map((item) => item.id), ["mimo-v2.5-free", "deepseek-v4-flash-free"]);
});

test("filterFreeModels passes through non-list payloads unchanged", () => {
  assert.deepEqual(filterFreeModels(null), null);
  assert.deepEqual(filterFreeModels({ error: "boom" }), { error: "boom" });
  assert.deepEqual(filterFreeModels({ object: "list", data: "nope" }), { object: "list", data: "nope" });
});

test("external gateway rejects missing/invalid keys with OpenAI-style 401", async () => {
  const port = freePort();
  writeConfig({ externalAccess: { enabled: true, port, apiKey: "test-external-key" } });
  await startExternalAccessServer();

  try {
    // No key.
    let response = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error?.code, "invalid_api_key");

    // Wrong key.
    response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    assert.equal(response.status, 401);
  } finally {
    await stopExternalAccessServer();
  }
});

test("external gateway 404s non-/v1 paths and answers CORS preflight", async () => {
  const port = freePort();
  writeConfig({ externalAccess: { enabled: true, port, apiKey: "test-external-key" } });
  await startExternalAccessServer();

  try {
    const notFound = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: "Bearer test-external-key" },
    });
    assert.equal(notFound.status, 404);

    const preflight = await fetch(`http://127.0.0.1:${port}/v1/models`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  } finally {
    await stopExternalAccessServer();
  }
});

test("external gateway intercepts Anthropic /v1/messages with a clear pointer", async () => {
  const port = freePort();
  writeConfig({ externalAccess: { enabled: true, port, apiKey: "test-external-key" } });
  await startExternalAccessServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-external-key" },
      body: JSON.stringify({ model: "deepseek-v4-flash-free", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "unsupported_endpoint");
    assert.match(body.error.message, /不支持 Anthropic \/v1\/messages/);
  } finally {
    await stopExternalAccessServer();
  }
});

test("external gateway returns 503 when the account pool is empty", async () => {
  const port = freePort();
  writeConfig({ externalAccess: { enabled: true, port, apiKey: "test-external-key" } });
  await startExternalAccessServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: "Bearer test-external-key" },
    });
    assert.equal(response.status, 503);
  } finally {
    await stopExternalAccessServer();
  }
});

test("external gateway does not start when disabled or keyless, and status reflects it", async () => {
  writeConfig({ externalAccess: { enabled: false, port: freePort(), apiKey: "test-external-key" } });
  await startExternalAccessServer();
  assert.equal(globalThis.__piOpenCodeZenExternalStatus?.running, false);
  assert.equal(globalThis.__piOpenCodeZenExternalServer, undefined);

  writeConfig({ externalAccess: { enabled: true, port: freePort(), apiKey: "" } });
  await startExternalAccessServer();
  assert.equal(globalThis.__piOpenCodeZenExternalStatus?.running, false);
  assert.equal(globalThis.__piOpenCodeZenExternalServer, undefined);
});

test("merge keeps the saved external apiKey when the draft is empty", () => {
  writeConfig({ externalAccess: { enabled: true, port: 7474, apiKey: "saved-key" } });
  readOpenCodeZenConfig(); // ensure state loaded from the file above
  const merged = mergeOpenCodeZenConfig({ externalAccess: { enabled: true, port: 7474, apiKey: "" } });
  assert.equal(merged.externalAccess.apiKey, "saved-key");
  assert.equal(merged.externalAccess.port, 7474);
  assert.equal(merged.externalAccess.enabled, true);

  // Invalid port falls back to the saved value.
  const mergedBadPort = mergeOpenCodeZenConfig({ externalAccess: { enabled: true, port: 99999 } });
  assert.equal(mergedBadPort.externalAccess.port, 7474);
});

test("merge without accounts (switch-active-account PUT) keeps the current account list", () => {
  writeConfig({
    accounts: [
      { id: "a1", note: "acct-1", apiKey: "sk-1", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "a2", note: "acct-2", apiKey: "sk-2", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    externalAccess: { enabled: false, port: 7474, apiKey: "" },
  });
  readOpenCodeZenConfig();
  const merged = mergeOpenCodeZenConfig({ activeAccountId: "a2" });
  assert.equal(merged.accounts.length, 2);
  assert.deepEqual(merged.accounts.map((account) => account.id), ["a1", "a2"]);
});

test("normalizeResponsesBody drops top-level reasoning_effort when reasoning.effort exists", () => {
  const body = Buffer.from(JSON.stringify({ input: "hi", reasoning_effort: "high", reasoning: { effort: "low" } }), "utf8");
  const out = normalizeResponsesBody(body);
  const parsed = JSON.parse(out.toString("utf8"));
  assert.equal(parsed.reasoning_effort, undefined);
  assert.deepEqual(parsed.reasoning, { effort: "low" });
  assert.deepEqual(parsed.input, [{ role: "user", content: "hi" }]);
});

test("normalizeResponsesBody keeps a lone reasoning_effort untouched", () => {
  const body = Buffer.from(JSON.stringify({ input: [{ role: "user", content: "hi" }], reasoning_effort: "high" }), "utf8");
  const out = normalizeResponsesBody(body);
  const parsed = JSON.parse(out.toString("utf8"));
  assert.equal(parsed.reasoning_effort, "high");
  assert.equal(parsed.reasoning, undefined);
  assert.deepEqual(parsed.input, [{ role: "user", content: "hi" }]);
});

test("normalizeResponsesBody leaves conflict-free bodies unchanged", () => {
  const body = Buffer.from(JSON.stringify({ input: [{ role: "user", content: "hi" }], reasoning: { effort: "low" } }), "utf8");
  assert.equal(normalizeResponsesBody(body), body);
  // Non-JSON body passes through untouched.
  const notJson = Buffer.from("not json at all", "utf8");
  assert.equal(normalizeResponsesBody(notJson), notJson);
});

test("external gateway normalizes /v1/responses body before forwarding", async () => {
  const port = freePort();
  writeConfig({
    accounts: [
      { id: "a1", note: "acct-1", apiKey: "sk-1", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    externalAccess: { enabled: true, port, apiKey: "test-external-key" },
  });

  const originalFetch = globalThis.fetch;
  const realFetch = originalFetch.bind(globalThis);
  let capturedUrl = "";
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ id: "resp-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await startExternalAccessServer();

    const response = await realFetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-external-key" },
      body: JSON.stringify({ input: "hi", reasoning_effort: "high", reasoning: { effort: "low" } }),
    });
    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://opencode.ai/zen/v1/responses");
    const forwarded = JSON.parse(Buffer.from(capturedInit.body).toString("utf8"));
    assert.equal(forwarded.reasoning_effort, undefined);
    assert.deepEqual(forwarded.reasoning, { effort: "low" });
    assert.deepEqual(forwarded.input, [{ role: "user", content: "hi" }]);
  } finally {
    globalThis.fetch = originalFetch;
    await stopExternalAccessServer();
  }
});

test("external gateway logs upstream 400 body and passes it through", async () => {
  const port = freePort();
  writeConfig({
    accounts: [
      { id: "a1", note: "acct-1", apiKey: "sk-1", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    externalAccess: { enabled: true, port, apiKey: "test-external-key" },
  });

  const originalFetch = globalThis.fetch;
  const realFetch = originalFetch.bind(globalThis);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "model boom" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  try {
    await startExternalAccessServer();

    const response = await realFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-external-key" },
      body: JSON.stringify({ model: "deepseek-v4-flash-free", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.message, "model boom"); // client still receives the upstream body unchanged

    const logs = getErrorLogs({ source: "opencode-zen-external" });
    assert.ok(logs.length > 0);
    const entry = logs[0];
    assert.equal(entry.level, "error");
    assert.equal(entry.statusCode, 400);
    assert.match(entry.message, /POST \/v1\/chat\/completions/);
    assert.match(entry.message, /模型=deepseek-v4-flash-free/);
    assert.match(entry.message, /model boom/);
  } finally {
    globalThis.fetch = originalFetch;
    await stopExternalAccessServer();
  }
});

test("external gateway logs successful calls at info level", async () => {
  const port = freePort();
  writeConfig({
    accounts: [
      { id: "a1", note: "acct-1", apiKey: "sk-1", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    externalAccess: { enabled: true, port, apiKey: "test-external-key" },
  });

  const originalFetch = globalThis.fetch;
  const realFetch = originalFetch.bind(globalThis);
  globalThis.fetch = async () => new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
  try {
    await startExternalAccessServer();

    const response = await realFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-external-key" },
      body: JSON.stringify({ model: "mimo-v2.5-free", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");

    const logs = getErrorLogs({ source: "opencode-zen-external" });
    const entry = logs[0];
    assert.equal(entry.level, "info");
    assert.equal(entry.statusCode, 200);
    assert.match(entry.message, /模型=mimo-v2.5-free/);
  } finally {
    globalThis.fetch = originalFetch;
    await stopExternalAccessServer();
  }
});

test("summarizeRequestBody describes message structure without content", () => {
  const body = Buffer.from(JSON.stringify({
    model: "deepseek-v4-flash-free",
    stream: true,
    reasoning_effort: "high",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!", reasoning_content: "think" },
      { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ],
  }), "utf8");
  const summary = summarizeRequestBody(body);
  assert.ok(summary);
  assert.match(summary, /0:user\{content\} content=str\(2\) reasoning_content=missing tool_calls=missing/);
  assert.match(summary, /1:assistant\{content,reasoning_content\} content=str\(6\) reasoning_content=str\(5\) tool_calls=missing/);
  assert.match(summary, /2:assistant\{tool_calls\} content=missing reasoning_content=missing tool_calls=arr\(1\)/);
  assert.match(summary, /3:tool\{tool_call_id,content\} content=str\(2\) reasoning_content=missing tool_calls=missing tool_call_id=call_1/);
  assert.match(summary, /stream=true reasoning_effort=str\(4\)/);
  // No message text in the summary.
  assert.ok(!summary.includes("Hello!"));
  assert.ok(!summary.includes("think"));
});

test("summarizeRequestBody returns undefined for non-chat bodies", () => {
  assert.equal(summarizeRequestBody(Buffer.from("not json")), undefined);
  assert.equal(summarizeRequestBody(Buffer.from(JSON.stringify({ input: "hi" }))), undefined);
});

test("openAiRateLimitError returns a friendly OpenAI-style 429", () => {
  const error = openAiRateLimitError("60");
  assert.equal(error.status, 429);
  assert.equal(error.headers["Retry-After"], "60");
  const parsed = JSON.parse(error.body);
  assert.equal(parsed.error.code, "rate_limit_exceeded");
  assert.equal(parsed.error.type, "rate_limit_error");
  assert.match(parsed.error.message, /当前账号已限额/);
});

function testState(cooldown) {
  return {
    config: {
      accounts: [
        { id: "a1", note: "a1", apiKey: "k1", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
        { id: "a2", note: "a2", apiKey: "k2", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
        { id: "a3", note: "a3", apiKey: "k3", enabled: true, proxy: { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" } },
      ],
      autoSwitch: true,
      cooldownMs: 60_000,
      externalAccess: { enabled: false, port: 7474, apiKey: "" },
    },
    activeIndex: 0,
    cooldownUntil: new Map(cooldown),
    dispatchers: new Map(),
  };
}

test("nextUtcMidnight returns the next 00:00 UTC", () => {
  // 2026-08-08 16:00 UTC → 2026-08-09 00:00 UTC
  const now = Date.UTC(2026, 7, 8, 16, 0, 0);
  assert.equal(nextUtcMidnight(now), Date.UTC(2026, 7, 9, 0, 0, 0));
  // Exactly at midnight → the following day
  const midnight = Date.UTC(2026, 7, 9, 0, 0, 0);
  assert.equal(nextUtcMidnight(midnight), Date.UTC(2026, 7, 10, 0, 0, 0));
});

test("daily-cooldown accounts are never picked, even with ignoreCooldown", () => {
  const now = Date.now();
  const midnight = nextUtcMidnight(now);
  const state = testState([
    ["a1", { until: midnight, daily: true }],
    ["a2", { until: midnight, daily: true }],
    ["a3", { until: midnight, daily: true }],
  ]);
  assert.equal(nextAccount(state), null);
  assert.equal(nextAccount(state, new Set(), true), null); // ignoreCooldown must NOT force a daily account
});

test("transient cooldown participates in ignoreCooldown fallback, daily does not", () => {
  const now = Date.now();
  const state = testState([
    ["a1", { until: now + 60_000, daily: false }], // transient, earliest expiry
    ["a2", { until: nextUtcMidnight(now), daily: true }], // daily, must be skipped
    ["a3", { until: nextUtcMidnight(now), daily: true }], // daily, must be skipped
  ]);
  assert.equal(nextAccount(state), null); // all cooling → no pick without ignoreCooldown
  const picked = nextAccount(state, new Set(), true);
  assert.equal(picked?.id, "a1"); // only the transient account is force-tried
});

test("available account wins over any cooldown", () => {
  const now = Date.now();
  const state = testState([
    ["a1", { until: nextUtcMidnight(now), daily: true }],
    ["a2", { until: now + 60_000, daily: false }],
  ]);
  const picked = nextAccount(state);
  assert.equal(picked?.id, "a3"); // a3 has no cooldown
});

test("readBody rejects oversized bodies with a bounded error", async () => {
  const { Readable } = await import("node:stream");
  const fakeReq = Readable.from([Buffer.alloc(64), Buffer.alloc(64)]);
  await assert.rejects(
    () => readBody(fakeReq, 100),
    /request body too large/,
  );
});

test("readBody passes bodies within the limit", async () => {
  const { Readable } = await import("node:stream");
  const fakeReq = Readable.from([Buffer.from("hello"), Buffer.from(" world")]);
  const body = await readBody(fakeReq, 1024);
  assert.equal(body.toString(), "hello world");
});
