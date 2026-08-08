import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-opencode-zen-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = testAgentDir;
const jiti = createJiti(import.meta.url);
const {
  parseOpenCodeKeyImport,
  maskOpenCodeKey,
  mergeOpenCodeZenConfig,
  createOpenCodeZenFetch,
  isOpenCodeZenProvider,
  OPENCODE_ZEN_PROVIDER_IDS,
  testOpenCodeZenProxy,
} = await jiti.import("./opencode-zen.ts");

test("imports OpenCode Zen keys using the first dash as the separator", () => {
  assert.deepEqual(parseOpenCodeKeyImport("alice-sk-abc-def\nbob-token-2"), [
    { note: "alice", apiKey: "sk-abc-def" },
    { note: "bob", apiKey: "token-2" },
  ]);
});

test("rejects malformed key import lines", () => {
  assert.throws(() => parseOpenCodeKeyImport("missingseparator"), /格式错误/);
  assert.throws(() => parseOpenCodeKeyImport("-sk-key"), /格式错误/);
});

test("masks keys without exposing the middle", () => {
  assert.equal(maskOpenCodeKey("sk-123456789"), "sk-1••••6789");
  assert.equal(maskOpenCodeKey("short"), "••••••••");
});

test("does not accept an account without an API key from the safe UI payload", () => {
  const merged = mergeOpenCodeZenConfig({
    accounts: [{ id: "a", note: "alice", enabled: true, proxy: { url: "proxy.example", port: 8080 } }],
    autoSwitch: true,
  });
  assert.deepEqual(merged.accounts, []);
});

test("treats both OpenCode gateways as Zen providers", () => {
  assert.equal(isOpenCodeZenProvider("opencode"), true);
  assert.equal(isOpenCodeZenProvider("opencode-go"), true);
  assert.equal(isOpenCodeZenProvider("openai"), false);
});

test("only the default zen gateway receives the account key (no duplicate picker groups)", () => {
  assert.deepEqual([...OPENCODE_ZEN_PROVIDER_IDS], ["opencode"]);
  assert.equal(OPENCODE_ZEN_PROVIDER_IDS.includes("opencode-go"), false);
});

test("rotates once across every account on replayable 429 responses", async () => {
  const seen = [];
  let calls = 0;
  const fetch = createOpenCodeZenFetch(async (_input, init) => {
    seen.push({ auth: new Headers(init?.headers).get("authorization"), body: typeof init?.body === "string" ? init.body : await new Response(init?.body).text() });
    calls += 1;
    return new Response(calls === 3 ? "ok" : "busy", { status: calls === 3 ? 200 : 429 });
  }, "test-session", {
    accounts: [
      { id: "a", note: "alice", apiKey: "key-a", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "b", note: "bob", apiKey: "key-b", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "c", note: "carol", apiKey: "key-c", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    autoSwitch: true,
    cooldownMs: 0,
  });

  const response = await fetch("https://opencode.ai/zen/go/v1/responses", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(seen.map((entry) => entry.auth), ["Bearer key-a", "Bearer key-b", "Bearer key-c"]);
  assert.deepEqual(seen.map((entry) => entry.body), [seen[0].body, seen[0].body, seen[0].body]);
});

test("re-importing the same key only updates the note without duplicating the account", async () => {
  const { importOpenCodeZenKeys } = await jiti.import("./opencode-zen.ts");
  const first = importOpenCodeZenKeys("alice-sk-abc-def");
  const second = importOpenCodeZenKeys("alice2-sk-abc-def");
  assert.equal(second.accounts.length, 1);
  assert.equal(second.accounts[0].note, "alice2");
  assert.equal(second.accounts[0].apiKeyMasked, first.accounts[0].apiKeyMasked);
});

test("does not rotate a non-replayable request body", async () => {
  let calls = 0;
  const fetch = createOpenCodeZenFetch(async () => {
    calls += 1;
    return new Response("busy", { status: 429 });
  }, "test-session", {
    accounts: [
      { id: "a", note: "alice", apiKey: "key-a", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "b", note: "bob", apiKey: "key-b", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    autoSwitch: true,
    cooldownMs: 0,
  });

  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("hello")); controller.close(); } });
  const response = await fetch("https://opencode.ai/zen/v1/chat/completions", { method: "POST", body, duplex: "half" });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test("caps per-request attempts and falls back to the last successful account", async () => {
  const auths = [];
  const fetch = createOpenCodeZenFetch(async (_input, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    auths.push(auth);
    // fetch 1: a 429 → b 200（b 成为 lastSuccess）
    if (auths.length === 1) return new Response("busy", { status: 429 });
    if (auths.length === 2) return new Response("ok", { status: 200 });
    // fetch 2: c → d → e 全部 429（主循环 3 次封顶），然后回退 b → 200
    if (auths.length <= 5) return new Response("busy", { status: 429 });
    return new Response("recovered", { status: 200 });
  }, "test-session", {
    accounts: [
      { id: "a", note: "alice", apiKey: "key-a", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "b", note: "bob", apiKey: "key-b", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "c", note: "carol", apiKey: "key-c", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "d", note: "dave", apiKey: "key-d", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "e", note: "erin", apiKey: "key-e", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    autoSwitch: true,
    cooldownMs: 60_000,
  });

  const first = await fetch("https://opencode.ai/zen/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }) });
  assert.equal(first.status, 200);
  assert.deepEqual(auths, ["Bearer key-a", "Bearer key-b"]);

  // 第二轮从 c 开始：主循环只试 c/d/e 三个（MAX_ATTEMPTS=3），b 未参与 → 回退 b 成功
  const second = await fetch("https://opencode.ai/zen/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }) });
  assert.equal(second.status, 200);
  assert.deepEqual(auths, ["Bearer key-a", "Bearer key-b", "Bearer key-c", "Bearer key-d", "Bearer key-e", "Bearer key-b"]);
});

test("keeps trying the earliest-expiring account when the whole pool is cooling down", async () => {
  const auths = [];
  const fetch = createOpenCodeZenFetch(async (_input, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    auths.push(auth);
    // fetch 1: a 429 → b 429（两账号都进入 60s 冷却）
    // fetch 2: 全池冷却 → 冷却池兜底取最早过期的 a 硬试 → 200
    if (auths.length <= 2) return new Response("busy", { status: 429 });
    return new Response("ok", { status: 200 });
  }, "test-session", {
    accounts: [
      { id: "a", note: "alice", apiKey: "key-a", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
      { id: "b", note: "bob", apiKey: "key-b", enabled: true, proxy: { enabled: false, url: "", port: 0, username: "", password: "" } },
    ],
    autoSwitch: true,
    cooldownMs: 60_000,
  });

  const first = await fetch("https://opencode.ai/zen/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }) });
  assert.equal(first.status, 429);

  // 全败后参与账号被压缩为短冷却，但仍在冷却中 → 第二请求走冷却池兜底，不再 503
  const second = await fetch("https://opencode.ai/zen/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }) });
  assert.equal(second.status, 200);
  assert.deepEqual(auths, ["Bearer key-a", "Bearer key-b", "Bearer key-a"]);
});

test("proxy test rejects an invalid port instead of connecting", async () => {
  // proxyUri validation errors must surface to the API route as a 400, not be
  // silently swallowed by the test helper.
  await assert.rejects(
    testOpenCodeZenProxy({
      protocol: "http",
      enabled: true,
      url: "http://proxy.example",
      port: 70000,
      username: "",
      password: "",
    }),
    /端口/,
  );
  await assert.rejects(
    testOpenCodeZenProxy({
      protocol: "http",
      enabled: true,
      url: "ftp://proxy.example",
      port: 21,
      username: "",
      password: "",
    }),
    /http\/https\/socks5/,
  );
});

test("accepts socks5 proxies and preserves the protocol through normalization", async () => {
  const merged = mergeOpenCodeZenConfig({
    accounts: [{
      id: "s",
      note: "socks",
      apiKey: "key-s",
      proxy: { protocol: "socks5", url: "socks5://socks.example", port: 1080 },
    }],
    autoSwitch: true,
  });
  assert.equal(merged.accounts[0].proxy.protocol, "socks5");
  assert.match(merged.accounts[0].proxy.url, /^socks5:\/\//);

  // A socks5 proxy with an invalid port must still fail validation before any
  // connection is attempted.
  await assert.rejects(
    testOpenCodeZenProxy({
      protocol: "socks5",
      enabled: true,
      url: "socks5://socks.example",
      port: 70000,
      username: "",
      password: "",
    }),
    /端口/,
  );
});

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});
