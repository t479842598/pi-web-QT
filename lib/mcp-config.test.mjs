import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { validateMcpServer, validateMcpServers, normalizeMcpServers } = await createJiti(import.meta.url)
  .import("./mcp-config.ts");
const { normalizeMcpTransport } = await createJiti(import.meta.url).import("./api-types.ts");

test("stdio servers require a command and accept args", () => {
  assert.equal(validateMcpServer("s", { command: "npx", args: ["-y", "foo"] }), null);
  assert.match(validateMcpServer("s", { transport: "stdio", args: [] }) ?? "", /requires a non-empty string command/);
  assert.match(validateMcpServer("s", { command: "npx", args: [1] }) ?? "", /args must be an array of strings/);
});

test("URL transports require a url instead of a command (regression: anysearch was rejected)", () => {
  const anysearch = {
    transport: "streamable-http",
    url: "https://api.anysearch.com/mcp",
    lifecycle: "eager",
    headers: { Authorization: "Bearer token" },
  };
  assert.equal(validateMcpServer("anysearch", anysearch), null);
  assert.equal(validateMcpServer("s", { transport: "sse", url: "https://example.com/sse" }), null);

  // A URL transport with no url is invalid even if it has a command.
  assert.match(validateMcpServer("s", { transport: "sse", command: "npx" }) ?? "", /requires a url/);
  assert.match(validateMcpServer("s", { transport: "streamable-http", url: "not-a-url" }) ?? "", /valid http or https URL/);
  assert.match(validateMcpServer("s", { transport: "sse", url: "ftp://example.com" }) ?? "", /valid http or https URL/);
});

test("legacy http transport is normalized to streamable-http", () => {
  assert.equal(normalizeMcpTransport("http"), "streamable-http");
  assert.equal(normalizeMcpTransport("sse"), "sse");
  assert.equal(normalizeMcpTransport(undefined), "stdio");
  assert.equal(normalizeMcpTransport("bogus"), "stdio");

  // A legacy entry stays valid after normalization so old configs keep loading.
  assert.equal(validateMcpServer("s", { transport: "http", url: "https://example.com/mcp" }), null);
});

test("headers and env must be string-valued objects", () => {
  assert.match(validateMcpServer("s", { command: "npx", headers: { A: 1 } }) ?? "", /headers must be an object of string values/);
  assert.match(validateMcpServer("s", { command: "npx", env: { A: 1 } }) ?? "", /env must be an object of string values/);
  assert.equal(validateMcpServer("s", { command: "npx", env: { A: "1" } }), null);
});

test("server names, lifecycle and timeout are validated", () => {
  assert.match(validateMcpServer("bad name", { command: "npx" }) ?? "", /Invalid server name/);
  assert.match(validateMcpServer("s", { command: "npx", lifecycle: "always" }) ?? "", /lifecycle must be one of eager, lazy/);
  assert.match(validateMcpServer("s", { command: "npx", requestTimeoutMs: -1 }) ?? "", /requestTimeoutMs must be a positive number/);
  assert.equal(validateMcpServer("s", { command: "npx", requestTimeoutMs: 30000 }), null);
});

test("unknown fields are preserved rather than rejected", () => {
  assert.equal(validateMcpServer("s", { command: "npx", cwd: "/tmp", healthCheckIntervalMs: 5000 }), null);
});

test("validateMcpServers reports the first offending server by name", () => {
  const problem = validateMcpServers({
    ok: { command: "npx" },
    broken: { transport: "sse" },
  });
  assert.match(problem ?? "", /Server "broken"/);
  assert.equal(validateMcpServers({ a: { command: "npx" }, b: { transport: "sse", url: "https://x/mcp" } }), null);
});

test("normalizeMcpServers keeps URL servers and drops non-objects", () => {
  const servers = normalizeMcpServers({
    anysearch: { transport: "http", url: "https://x/mcp", headers: { A: "b" } },
    lrnev: { command: "/bin/lrnev", args: [], transport: "stdio" },
    junk: "not-an-object",
  });
  assert.deepEqual(Object.keys(servers).sort(), ["anysearch", "lrnev"]);
  assert.equal(servers.anysearch.transport, "streamable-http");
  assert.equal(servers.anysearch.url, "https://x/mcp");
  assert.equal(servers.lrnev.command, "/bin/lrnev");
});
