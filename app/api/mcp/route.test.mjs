import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const root = mkdtempSync(join(tmpdir(), "pi-mcp-route-test-"));
process.env.PI_CODING_AGENT_DIR = root;
const configPath = join(root, "mcp.json");
const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)) },
  moduleCache: false,
  fsCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
beforeEach(() => rmSync(configPath, { force: true }));
after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(root, { recursive: true, force: true });
});

function request(method = "GET", body) {
  return new Request("http://localhost/api/mcp", {
    method,
    headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const valid = { fixture: { command: "node", args: ["fixture.mjs"], transport: "stdio" } };

test("missing MCP file is empty and can be created", async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).mcpServers, {});
  assert.equal((await PUT(request("PUT", { mcpServers: valid }))).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).mcpServers, valid);
});

for (const source of [
  'SYNTHETIC_PRIVATE_VALUE {',
  '[{"secret":"SYNTHETIC_PRIVATE_VALUE"}]',
  '{"mcpServers":[{"secret":"SYNTHETIC_PRIVATE_VALUE"}]}',
  '{"mcpServers":{"broken":"SYNTHETIC_PRIVATE_VALUE"}}',
  'null',
  'false',
  '{"mcpServers":null}',
]) {
  test(`unusable MCP document refuses reads and writes (${source.slice(0, 16)})`, async () => {
    writeFileSync(configPath, source);
    const read = await GET(request());
    assert.equal(read.status, 422);
    assert.equal((await read.text()).includes("SYNTHETIC_PRIVATE_VALUE"), false);
    const write = await PUT(request("PUT", { mcpServers: valid }));
    assert.equal(write.status, 409);
    assert.equal((await write.text()).includes("SYNTHETIC_PRIVATE_VALUE"), false);
    assert.equal(readFileSync(configPath, "utf8"), source);
  });
}

test("MCP read failures are not treated as a missing configuration", async (t) => {
  mkdirSync(configPath);
  t.after(() => rmSync(configPath, { recursive: true, force: true }));
  assert.equal((await GET(request())).status, 422);
  assert.equal((await PUT(request("PUT", { mcpServers: valid }))).status, 409);
  assert.equal(statSync(configPath).isDirectory(), true);
});

test("MCP read and save preserve unknown fields and sibling settings", async () => {
  const original = {
    settings: { reconnect: true }, unknownSibling: { future: 2 },
    mcpServers: { fixture: { ...valid.fixture, unknownFuture: { enabled: true } } },
  };
  writeFileSync(configPath, JSON.stringify(original));
  const read = await GET(request());
  assert.equal(read.status, 200);
  const servers = (await read.json()).mcpServers;
  servers.fixture.args = ["updated.mjs"];
  assert.equal((await PUT(request("PUT", { mcpServers: servers }))).status, 200);
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(saved.settings, original.settings);
  assert.deepEqual(saved.unknownSibling, original.unknownSibling);
  assert.deepEqual(saved.mcpServers.fixture.unknownFuture, { enabled: true });
});

test("a file becoming invalid after GET is not replaced by a stale save", async () => {
  writeFileSync(configPath, JSON.stringify({ mcpServers: valid }));
  assert.equal((await GET(request())).status, 200);
  writeFileSync(configPath, '{"mcpServers":');
  assert.equal((await PUT(request("PUT", { mcpServers: valid }))).status, 409);
  assert.equal(readFileSync(configPath, "utf8"), '{"mcpServers":');
});

test("malformed request JSON is a client error and leaves MCP config unchanged", async () => {
  const source = JSON.stringify({ mcpServers: valid });
  writeFileSync(configPath, source);
  const response = await PUT(new Request("http://localhost/api/mcp", {
    method: "PUT", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json" }, body: "{",
  }));
  assert.equal(response.status, 400);
  assert.equal(readFileSync(configPath, "utf8"), source);
});
