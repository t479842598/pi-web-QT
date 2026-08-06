import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyProxyEnv,
  buildProxyUrl,
  readProxyConfig,
  writeProxyConfig,
} = await jiti.import("./proxy-config.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-proxy-config-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

function writeSettings(agentDir, data) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(data, null, 2));
}

test("readProxyConfig returns defaults when unset", () => {
  isolateAgentDir();
  const config = readProxyConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.protocol, "http");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 7890);
  assert.equal(config.username, "");
  assert.equal(config.password, "");
  assert.equal(config.noProxy, "localhost,127.0.0.1,.local");
});

test("readProxyConfig handles corrupt settings.json", () => {
  const agentDir = isolateAgentDir();
  writeFileSync(join(agentDir, "settings.json"), "not json{{");
  assert.equal(readProxyConfig().enabled, false);
});

test("readProxyConfig normalizes invalid fields", () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, {
    proxy: {
      enabled: true,
      protocol: "gopher", // invalid → http
      host: "",
      port: 999999, // invalid → 7890
      username: 42, // non-string → ""
      password: "secret",
    },
  });
  const config = readProxyConfig();
  assert.equal(config.protocol, "http");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 7890);
  assert.equal(config.username, "");
  assert.equal(config.password, "secret");
});

test("writeProxyConfig persists and preserves other settings fields", () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { defaultModel: "foo/bar", packages: ["npm:x"] });

  writeProxyConfig({
    enabled: true,
    protocol: "socks5",
    host: "localhost",
    port: 1080,
    username: "u",
    password: "p",
    noProxy: "",
  });

  const file = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.equal(file.defaultModel, "foo/bar");
  assert.deepEqual(file.packages, ["npm:x"]);
  assert.equal(file.proxy.protocol, "socks5");
  assert.equal(file.proxy.port, 1080);
});

test("buildProxyUrl returns null when disabled or incomplete", () => {
  assert.equal(buildProxyUrl({ enabled: false, protocol: "http", host: "h", port: 1, username: "", password: "", noProxy: "" }), null);
  assert.equal(buildProxyUrl({ enabled: true, protocol: "http", host: "", port: 1, username: "", password: "", noProxy: "" }), null);
  assert.equal(buildProxyUrl({ enabled: true, protocol: "http", host: "h", port: 0, username: "", password: "", noProxy: "" }), null);
});

test("buildProxyUrl builds plain and authenticated URLs", () => {
  const base = { enabled: true, protocol: "http", host: "127.0.0.1", port: 7890, username: "", password: "", noProxy: "" };
  assert.equal(buildProxyUrl({ ...base }), "http://127.0.0.1:7890");
  assert.equal(buildProxyUrl({ ...base, username: "u", password: "p" }), "http://u:p@127.0.0.1:7890");
  assert.equal(buildProxyUrl({ ...base, protocol: "socks5", host: "localhost", port: 1080 }), "socks5://localhost:1080");
});

test("buildProxyUrl percent-encodes credentials", () => {
  const base = { enabled: true, protocol: "http", host: "h", port: 1, username: "us er", password: "p@ss:w/rd", noProxy: "" };
  assert.equal(buildProxyUrl(base), "http://us%20er:p%40ss%3Aw%2Frd@h:1");
});

test("applyProxyEnv sets and clears environment variables", () => {
  const base = { enabled: true, protocol: "http", host: "127.0.0.1", port: 7890, username: "u", password: "p", noProxy: "localhost,.local" };
  applyProxyEnv(base);
  assert.equal(process.env.HTTP_PROXY, "http://u:p@127.0.0.1:7890");
  assert.equal(process.env.HTTPS_PROXY, "http://u:p@127.0.0.1:7890");
  assert.equal(process.env.NO_PROXY, "localhost,.local");

  applyProxyEnv({ ...base, enabled: false });
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.HTTPS_PROXY, undefined);
  assert.equal(process.env.NO_PROXY, "");

  // Restore original values if they existed
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.NO_PROXY;
});

test.after(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
});
