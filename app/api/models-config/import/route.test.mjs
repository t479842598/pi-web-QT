import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The route scans the user's home and writes models.json under the agent dir.
// Point both at throwaway temp dirs so the test never touches the real ones.
const originalHome = process.env.HOME;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const home = mkdtempSync(join(tmpdir(), "pi-import-home-"));
const agentDir = mkdtempSync(join(tmpdir(), "pi-import-agent-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDir;
const modelsPath = join(agentDir, "models.json");

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../../../../", import.meta.url)) },
  moduleCache: false,
  fsCache: false,
});
const { GET, POST } = await jiti.import("./route.ts");

function seedHome() {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
    env: { ANTHROPIC_BASE_URL: "https://claude.example.com", ANTHROPIC_AUTH_TOKEN: "sk-claude" },
    model: "claude-sonnet-5",
  }));
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), [
    'model = "gpt-5-codex"',
    "",
    "[model_providers.relay]",
    'name = "Relay"',
    'base_url = "https://relay.example.com/v1"',
    'wire_api = "responses"',
    'env_key = "RELAY_KEY"',
  ].join("\n"));
  process.env.RELAY_KEY = "sk-relay";
}

beforeEach(() => {
  rmSync(modelsPath, { force: true });
  seedHome();
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  delete process.env.RELAY_KEY;
  rmSync(home, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
});

function request(method = "GET", body) {
  return new Request("http://localhost/api/models-config/import", {
    method,
    headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("GET scans local agents and hides secrets", async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  const { candidates } = await response.json();
  const keys = candidates.map((c) => `${c.source}:${c.externalId}`);
  assert.ok(keys.includes("claude-code:default"));
  assert.ok(keys.includes("codex:relay"));
  for (const candidate of candidates) {
    assert.equal("apiKey" in candidate, false);
    assert.equal("headers" in candidate, false);
  }
  const relay = candidates.find((c) => c.source === "codex");
  assert.equal(relay.hasKey, true);
});

test("POST imports the selected candidate into models.json", async () => {
  const response = await POST(request("POST", { keys: ["codex:relay"] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.imported, 1);
  assert.equal(body.skipped, 0);

  const onDisk = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.equal(onDisk.providers.Relay.api, "openai-responses");
  assert.equal(onDisk.providers.Relay.baseUrl, "https://relay.example.com/v1");
  assert.equal(onDisk.providers.Relay.apiKey, "sk-relay");
});

test("POST re-import of the same candidate is skipped", async () => {
  await POST(request("POST", { keys: ["codex:relay"] }));
  const again = await POST(request("POST", { keys: ["codex:relay"] }));
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.imported, 0);
  assert.equal(body.skipped, 1);
});

test("POST rejects an empty key list with 400", async () => {
  const response = await POST(request("POST", { keys: [] }));
  assert.equal(response.status, 400);
});

test("POST with unknown keys imports nothing", async () => {
  const response = await POST(request("POST", { keys: ["nope:nope"] }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).imported, 0);
});
