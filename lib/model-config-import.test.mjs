import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaudeCodeModelConfig,
  parseCodexModelConfig,
  parseOpenCodeModelConfig,
  parsePiModelConfig,
  parseCcSwitchConfigJson,
  parseCcSwitchProviders,
  applyModelConfigImports,
  scanModelConfigSources,
  modelConfigImportKey,
  publicModelConfigCandidate,
} from "./model-config-import.ts";

test("Claude Code: reads base URL, secret and default model", () => {
  const drafts = parseClaudeCodeModelConfig(
    { env: { ANTHROPIC_BASE_URL: "https://api.example.com", ANTHROPIC_AUTH_TOKEN: "sk-claude" }, model: "claude-sonnet-4-6" },
    undefined,
  );
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.equal(d.source, "claude-code");
  assert.equal(d.baseUrl, "https://api.example.com");
  assert.equal(d.api, "anthropic-messages");
  assert.equal(d.apiKey, "sk-claude");
  assert.equal(d.hasKey, true);
  assert.deepEqual(d.models.map((m) => m.id), ["claude-sonnet-4-6"]);
});

test("Claude Code: returns nothing without a base URL or key", () => {
  assert.deepEqual(parseClaudeCodeModelConfig({ model: "x" }), []);
});

test("Claude Code: resolves ${VAR} secrets against env", () => {
  const drafts = parseClaudeCodeModelConfig(
    { env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_API_KEY: "${MY_KEY}" }, model: "m" },
    undefined,
    { MY_KEY: "resolved-value" },
  );
  assert.equal(drafts[0].apiKey, "resolved-value");
});

test("Codex: parses [model_providers.*] tables from TOML", () => {
  const toml = `
model = "gpt-5-codex"

[model_providers.myrelay]
name = "MyRelay"
base_url = "https://relay.example.com/v1"
wire_api = "responses"
env_key = "RELAY_KEY"
`;
  const drafts = parseCodexModelConfig(toml, { RELAY_KEY: "sk-relay" });
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.equal(d.externalId, "myrelay");
  assert.equal(d.name, "MyRelay");
  assert.equal(d.baseUrl, "https://relay.example.com/v1");
  assert.equal(d.api, "openai-responses");
  assert.equal(d.apiKey, "sk-relay");
  assert.deepEqual(d.models.map((m) => m.id), ["gpt-5-codex"]);
});

test("Codex: skips requires_openai_auth providers with no key source", () => {
  const toml = `
[model_providers.openai_oauth]
requires_openai_auth = true
`;
  assert.deepEqual(parseCodexModelConfig(toml), []);
});

test("OpenCode: reads provider options and auth.json key", () => {
  const config = {
    provider: {
      myprovider: {
        name: "MyProvider",
        models: { "my-model": { name: "My Model" } },
        options: { baseURL: "https://oc.example.com/v1", apiKey: undefined },
      },
    },
  };
  const drafts = parseOpenCodeModelConfig(config, { myprovider: { apiKey: "sk-oc" } });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].externalId, "myprovider");
  assert.equal(drafts[0].baseUrl, "https://oc.example.com/v1");
  assert.equal(drafts[0].apiKey, "sk-oc");
  assert.deepEqual(drafts[0].models, [{ id: "my-model", name: "My Model" }]);
});

test("Pi: reads native models.json providers with model entries", () => {
  const modelsJson = {
    providers: {
      deepseek: {
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-deepseek",
        models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }, "deepseek-reasoner"],
      },
    },
  };
  const drafts = parsePiModelConfig(modelsJson);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].externalId, "deepseek");
  assert.deepEqual(drafts[0].models.map((m) => m.id), ["deepseek-chat", "deepseek-reasoner"]);
});

test("Pi: never stores a shell-command secret", () => {
  const drafts = parsePiModelConfig({ providers: { p: { apiKey: "!op read secret", models: [{ id: "m" }] } } });
  assert.equal(drafts[0].hasKey, false);
  assert.equal(drafts[0].apiKey, undefined);
});

test("cc-switch: legacy config.json rows are retagged and parsed", () => {
  const doc = {
    claude: {
      providers: {
        p1: { id: "p1", name: "Relay", settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://cc.example.com", ANTHROPIC_API_KEY: "sk-cc" } } },
      },
    },
  };
  const rows = parseCcSwitchConfigJson(doc);
  assert.equal(rows.length, 1);
  const drafts = parseCcSwitchProviders(rows);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].source, "cc-switch");
  assert.equal(drafts[0].externalId, "claude:p1");
  assert.equal(drafts[0].name, "Relay");
  assert.equal(drafts[0].baseUrl, "https://cc.example.com");
});

test("publicModelConfigCandidate never leaks the key", () => {
  const candidate = publicModelConfigCandidate({
    source: "pi", externalId: "x", name: "X", baseUrl: null, api: "openai-completions",
    apiKey: "sk-secret", models: [{ id: "m" }], hasKey: true,
  });
  assert.equal("apiKey" in candidate, false);
  assert.equal(candidate.hasKey, true);
});

test("applyModelConfigImports: adds new providers and skips duplicates", () => {
  const base = { providers: {} };
  const draft = {
    source: "pi", externalId: "p", name: "NewProv", baseUrl: "https://a", api: "openai-completions",
    models: [{ id: "m1" }], hasKey: false,
  };
  const first = applyModelConfigImports(base, [draft]);
  assert.equal(first.imported, 1);
  assert.equal(first.config.providers.NewProv.api, "openai-completions");
  assert.deepEqual(first.config.providers.NewProv.models.map((m) => m.id), ["m1"]);

  const second = applyModelConfigImports(first.config, [draft]);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
});

test("applyModelConfigImports: same name, different endpoint → uniquified", () => {
  const base = { providers: { P: { api: "openai-completions", baseUrl: "https://a", models: [{ id: "m" }] } } };
  const result = applyModelConfigImports(base, [{
    source: "pi", externalId: "q", name: "P", baseUrl: "https://b", api: "openai-completions",
    models: [{ id: "m" }], hasKey: false,
  }]);
  assert.equal(result.imported, 1);
  assert.ok(result.config.providers["P-2"]);
});

test("scanModelConfigSources: scans a fake home and dedupes cc-switch", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-scan-"));
  try {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: "https://claude.example.com", ANTHROPIC_AUTH_TOKEN: "sk-c" },
      model: "claude-x",
    }));
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), `model = "gpt-x"\n\n[model_providers.r]\nbase_url = "https://r"`);
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({
      providers: { native: { api: "openai-completions", baseUrl: "https://n", models: [{ id: "nm" }] } },
    }));

    const drafts = scanModelConfigSources({ home, env: {} });
    const sources = drafts.map((d) => d.source).sort();
    assert.deepEqual(sources, ["claude-code", "codex", "pi"]);
    for (const d of drafts) {
      assert.ok(modelConfigImportKey(d.source, d.externalId));
      // candidates must not carry secrets
      assert.equal("apiKey" in publicModelConfigCandidate(d), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
