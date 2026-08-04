import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import AdmZip from "adm-zip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  BACKUP_ROOT,
  MAX_EXTRACT_ENTRY_BYTES,
  MAX_EXTRACT_TOTAL_BYTES,
  adaptMcpConfig,
  buildMcpInstallPrompt,
  cleanupParsedBackup,
  createBackupZip,
  expandBackupPaths,
  isSafeBinScriptName,
  isSafeScriptContent,
  normalizeBackupPaths,
  npmSpecsFromSettings,
  parseBackupZip,
  restoreBackup,
} = await jiti.import("./backup.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-backup-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(join(agentDir, "bin"), { recursive: true });
  mkdirSync(join(agentDir, "skills", "brainstorming"), { recursive: true });
  mkdirSync(join(agentDir, "sessions", "enc-cwd"), { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: { glm: { api: "openai-completions", apiKey: "secret-123", models: [{ id: "glm-x" }] } },
  }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ glm: { type: "api_key", key: "secret-auth" } }));
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultModel: "glm/glm-x",
    packages: ["npm:pi-review-loop", join(agentDir, "local-plugin-dir")],
  }));
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: {
      wrapper: { command: join(agentDir, "bin", "my-mcp"), args: [], transport: "stdio" },
      npxServer: { command: "npx", args: ["-y", "some-mcp"], transport: "stdio" },
    },
  }));
  writeFileSync(join(agentDir, "skills", "brainstorming", "SKILL.md"), "# brainstorming\n");
  writeFileSync(join(agentDir, "sessions", "enc-cwd", "20240101_test.jsonl"), "{}");
  writeFileSync(join(agentDir, "bin", "my-mcp"), "#!/usr/bin/env node\nconsole.log('mcp')");
  // local plugin dir
  mkdirSync(join(agentDir, "local-plugin-dir"), { recursive: true });
  writeFileSync(join(agentDir, "local-plugin-dir", "index.js"), "export {}");
  mkdirSync(join(agentDir, "local-plugin-dir", "node_modules", "x"), { recursive: true });
  writeFileSync(join(agentDir, "local-plugin-dir", "node_modules", "x", "index.js"), "x");
  return agentDir;
}

function readZip(buffer, entry) {
  const zip = new AdmZip(buffer);
  const e = zip.getEntry(entry);
  assert.ok(e, `zip entry missing: ${entry}`);
  return e.getData().toString("utf8");
}

// ── normalize / expand ───────────────────────────────────────────────────────

test("normalizeBackupPaths replaces agentDir and home prefixes", () => {
  const agentDir = isolateAgentDir();
  const input = {
    command: join(agentDir, "bin", "my-mcp"),
    home: join(homedir(), "something"),
    url: "https://example.com/api",
    plain: "npx",
    nested: { args: [join(agentDir, "x")] },
  };
  const normalized = normalizeBackupPaths(input);
  assert.equal(normalized.command, `${BACKUP_ROOT === "pi-backup" ? "${agentDir}/bin/my-mcp" : ""}`);
  assert.equal(normalized.command, "${agentDir}/bin/my-mcp");
  assert.equal(normalized.home, "${home}/something");
  assert.equal(normalized.url, "https://example.com/api");
  assert.equal(normalized.plain, "npx");
  assert.deepEqual(normalized.nested.args, ["${agentDir}/x"]);
});

test("expandBackupPaths restores placeholders on the target machine", () => {
  const agentDir = isolateAgentDir();
  const expanded = expandBackupPaths({
    command: "${agentDir}/bin/my-mcp",
    home: "${home}/cfg",
    deep: { p: "${agentDir}/a/b" },
  });
  assert.equal(expanded.command, join(agentDir, "bin", "my-mcp"));
  assert.equal(expanded.home, join(homedir(), "cfg"));
  assert.equal(expanded.deep.p, join(agentDir, "a", "b"));
});

test("normalize/expand round-trip preserves spaced paths", () => {
  const agentDir = isolateAgentDir();
  const spaced = join(agentDir, "dir with space", "file");
  const round = expandBackupPaths(normalizeBackupPaths(spaced));
  assert.equal(round, spaced);
});

// ── createBackupZip ──────────────────────────────────────────────────────────

test("createBackupZip includes core files, skills, local package, bin script, manifest", () => {
  isolateAgentDir();
  const zip = createBackupZip({ includeSecrets: true, includeSessions: true });

  const manifest = JSON.parse(readZip(zip, `${BACKUP_ROOT}/manifest.json`));
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.includeSecrets, true);
  assert.equal(manifest.includeSessions, true);
  assert.ok(manifest.localPackages.includes("local-plugin-dir"));
  assert.ok(manifest.mcpBinScripts.includes("my-mcp"));
  assert.ok(manifest.files.includes(`${BACKUP_ROOT}/bin/my-mcp`));

  // paths normalized in zip
  const settings = JSON.parse(readZip(zip, `${BACKUP_ROOT}/settings.json`));
  assert.ok(settings.packages.includes("${agentDir}/local-plugin-dir"));

  // local package skipped node_modules
  assert.equal(readZip(zip, `${BACKUP_ROOT}/local-packages/local-plugin-dir/index.js`), "export {}");
  assert.equal(new AdmZip(zip).getEntry(`${BACKUP_ROOT}/local-packages/local-plugin-dir/node_modules/x/index.js`), null);

  // mcp.json command normalized
  const mcp = JSON.parse(readZip(zip, `${BACKUP_ROOT}/mcp.json`));
  assert.equal(mcp.mcpServers.wrapper.command, "${agentDir}/bin/my-mcp");

  // sessions included
  assert.equal(new AdmZip(zip).getEntry(`${BACKUP_ROOT}/sessions/enc-cwd/20240101_test.jsonl`) !== null, true);
});

test("createBackupZip with includeSecrets=false redacts apiKey and drops auth.json", () => {
  isolateAgentDir();
  const zip = createBackupZip({ includeSecrets: false, includeSessions: false });

  const models = JSON.parse(readZip(zip, `${BACKUP_ROOT}/models.json`));
  assert.equal(models.providers.glm.apiKey, "");
  assert.equal(new AdmZip(zip).getEntry(`${BACKUP_ROOT}/auth.json`), null);
  const manifest = JSON.parse(readZip(zip, `${BACKUP_ROOT}/manifest.json`));
  assert.equal(manifest.includeSecrets, false);
});

// ── adaptMcpConfig ───────────────────────────────────────────────────────────

test("adaptMcpConfig: PATH commands kept, bin scripts restored on mac, manual on windows bash", () => {
  const agentDir = isolateAgentDir();
  const servers = {
    npxServer: { command: "npx", args: ["-y", "mcp"] },
    wrapper: { command: `${agentDir}/bin/my-mcp`, args: [] },
    absOther: { command: "/opt/tools/thing", args: [] },
  };
  const binScripts = new Map([["my-mcp", Buffer.from("#!/usr/bin/env node\n")]]);

  const mac = adaptMcpConfig(servers, binScripts, "darwin");
  const byName = Object.fromEntries(mac.servers.map((s) => [s.name, s]));
  assert.equal(byName.npxServer.action, "keep");
  assert.equal(byName.wrapper.action, "restore-script");
  assert.equal(byName.absOther.action, "keep-with-warning");
  assert.ok(mac.warnings.some((w) => w.includes("absOther")));

  const win = adaptMcpConfig(servers, binScripts, "win32");
  const winByName = Object.fromEntries(win.servers.map((s) => [s.name, s]));
  assert.equal(winByName.wrapper.action, "generate-cmd");
  assert.match(winByName.wrapper.adapted.command, /\.cmd$/);

  // bash shebang → manual
  const bashScripts = new Map([["my-mcp", Buffer.from("#!/bin/bash\n")]]);
  const winBash = adaptMcpConfig({ wrapper: servers.wrapper }, bashScripts, "win32");
  assert.equal(winBash.servers[0].action, "manual");
});

// ── parseBackupZip security ──────────────────────────────────────────────────

test("parseBackupZip rejects zip-slip entries", () => {
  const zip = new AdmZip();
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify({ formatVersion: 1 })));
  zip.addFile("../evil.txt", Buffer.from("bad"));
  assert.throws(() => parseBackupZip(zip.toBuffer()), /Path traversal blocked|Unexpected entry/);
});

test("parseBackupZip rejects archives without manifest", () => {
  const zip = new AdmZip();
  zip.addFile("pi-backup/settings.json", Buffer.from("{}"));
  assert.throws(() => parseBackupZip(zip.toBuffer()), /manifest.json missing/);
});

test("parseBackupZip rejects unsupported format version", () => {
  const zip = new AdmZip();
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify({ formatVersion: 99 })));
  assert.throws(() => parseBackupZip(zip.toBuffer()), /Unsupported backup format version/);
});

test("parseBackupZip accepts a valid backup", () => {
  isolateAgentDir();
  const zip = createBackupZip({ includeSecrets: true, includeSessions: false });
  const parsed = parseBackupZip(zip);
  try {
    assert.equal(parsed.manifest.formatVersion, 1);
    assert.ok(parsed.categories.includes("core"));
    assert.ok(parsed.categories.includes("mcp"));
    assert.ok(parsed.binScripts.has("my-mcp"));
    assert.ok(Object.keys(parsed.servers).includes("wrapper"));
  } finally {
    cleanupParsedBackup(parsed);
  }
});

// ── restoreBackup ────────────────────────────────────────────────────────────

test("restoreBackup restores core, skills, local package with path rewrite, mcp adapt", () => {
  const agentDir = isolateAgentDir();
  const zip = createBackupZip({ includeSecrets: true, includeSessions: false });
  const parsed = parseBackupZip(zip);
  try {
    const { report, npmPackages } = restoreBackup(parsed, {
      categories: ["core", "skills", "packages", "mcp"],
      skippedMcpServers: [],
    });

    assert.ok(report.restored.includes("models.json"));
    assert.ok(report.restored.includes("mcp.json"));
    assert.ok(report.needsRestart.includes("settings.json"));
    assert.ok(npmPackages.includes("npm:pi-review-loop"));

    // local package migrated to agentDir/local-packages/
    assert.equal(readFileSync(join(agentDir, "local-packages", "local-plugin-dir", "index.js"), "utf8"), "export {}");
    // settings.json packages rewritten
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    assert.ok(settings.packages.includes(join(agentDir, "local-packages", "local-plugin-dir")));
    // skills restored
    assert.ok(existsSync(join(agentDir, "skills", "brainstorming", "SKILL.md")));
    // mcp bin script restored
    assert.ok(existsSync(join(agentDir, "bin", "my-mcp")));
    const mcp = JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers.wrapper.command, join(agentDir, "bin", "my-mcp"));
    assert.equal(mcp.mcpServers.npxServer.command, "npx");
  } finally {
    cleanupParsedBackup(parsed);
  }
});

test("restoreBackup skips deselected categories and servers", () => {
  const agentDir = isolateAgentDir();
  const zip = createBackupZip({ includeSecrets: true, includeSessions: false });
  const parsed = parseBackupZip(zip);
  try {
    const { report } = restoreBackup(parsed, {
      categories: ["mcp"],
      skippedMcpServers: ["wrapper"],
    });
    assert.ok(!report.restored.includes("models.json"));
    assert.ok(report.restored.includes("mcp.json"));
    const mcp = JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8"));
    assert.equal("wrapper" in mcp.mcpServers, false);
    assert.equal("npxServer" in mcp.mcpServers, true);
  } finally {
    cleanupParsedBackup(parsed);
  }
});

// ── install prompt ───────────────────────────────────────────────────────────

test("buildMcpInstallPrompt is a unified template with server specifics", () => {
  const prompt = buildMcpInstallPrompt({
    name: "my-mcp",
    original: { command: "/old/path/my-mcp", args: [] },
    adapted: null,
    action: "manual",
    platform: "win32",
    reason: "bash wrapper",
  });
  assert.match(prompt, /my-mcp/);
  assert.match(prompt, /统一安装约定/);
  assert.match(prompt, /mcp\.json/);
});

test("parseBackupZip rejects decompression bombs over the size limit", () => {
  const zip = new AdmZip();
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify({ formatVersion: 1, includeSecrets: true })));
  // entry declared larger than the single-entry cap (without writing real data)
  zip.addFile("pi-backup/huge.bin", Buffer.alloc(0));
  const entry = zip.getEntry("pi-backup/huge.bin");
  // patch the declared uncompressed size to exceed the cap
  entry.header.size = MAX_EXTRACT_ENTRY_BYTES + 1;
  assert.throws(() => parseBackupZip(zip.toBuffer()), /too large/);
});

test("parseBackupZip rejects archives whose declared total exceeds the aggregate cap", () => {
  const zip = new AdmZip();
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify({ formatVersion: 1, includeSecrets: true })));
  // Three entries each under the single-entry cap but whose declared sum
  // (1 GiB + 3 bytes) exceeds the 1 GiB aggregate cap.
  for (let i = 0; i < 3; i++) {
    zip.addFile(`pi-backup/chunk-${i}.bin`, Buffer.alloc(0));
    zip.getEntry(`pi-backup/chunk-${i}.bin`).header.size = Math.floor(MAX_EXTRACT_TOTAL_BYTES / 3) + 1;
  }
  assert.throws(() => parseBackupZip(zip.toBuffer()), /too large/);
});

test("restoreBackup skips unsafe local package names", () => {
  const agentDir = isolateAgentDir();
  const zip = new AdmZip();
  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    sourcePlatform: "darwin",
    includeSecrets: true,
    files: [],
    mcpBinScripts: [],
    localPackages: ["..", "../evil", "ok-plugin"],
    absolutePaths: [],
    warnings: [],
  };
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify(manifest)));
  zip.addFile("pi-backup/settings.json", Buffer.from("{}"));
  zip.addFile("pi-backup/local-packages/ok-plugin/index.js", Buffer.from("export {}"));
  const parsed = parseBackupZip(zip.toBuffer());
  try {
    const { report } = restoreBackup(parsed, { categories: ["packages"], skippedMcpServers: [] });
    // unsafe names warned and skipped, safe name restored
    assert.ok(report.warnings.some((w) => w.includes("..")));
    assert.ok(report.restored.includes("local-packages/ok-plugin"));
    assert.ok(existsSync(join(agentDir, "local-packages", "ok-plugin", "index.js")));
    // no escape artifacts
    assert.ok(!existsSync(join(agentDir, "..", "evil")));
    assert.ok(!existsSync(join(agentDir, "evil")));
  } finally {
    cleanupParsedBackup(parsed);
  }
});

test("restoreBackup exposes npm specs but reinstall is opt-in via selections", () => {
  isolateAgentDir();
  const zip = new AdmZip();
  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    sourcePlatform: "darwin",
    includeSecrets: true,
    files: [],
    mcpBinScripts: [],
    localPackages: [],
    absolutePaths: [],
    warnings: [],
  };
  zip.addFile("pi-backup/manifest.json", Buffer.from(JSON.stringify(manifest)));
  zip.addFile(
    "pi-backup/settings.json",
    Buffer.from(JSON.stringify({ packages: ["npm:pi-review-loop", "/abs/local"] })),
  );
  const parsed = parseBackupZip(zip.toBuffer());
  try {
    // npm specs surfaced in preview payload
    assert.deepEqual(npmSpecsFromSettings(parsed), ["npm:pi-review-loop"]);
    // restore without opt-in still collects specs (caller gates on reinstallNpm)
    const { npmPackages } = restoreBackup(parsed, { categories: ["packages"], skippedMcpServers: [] });
    assert.deepEqual(npmPackages, ["npm:pi-review-loop"]);
  } finally {
    cleanupParsedBackup(parsed);
  }
});

test("adaptMcpConfig rejects unsafe bin script names", () => {
  const agentDir = isolateAgentDir();
  const servers = {
    evil: { command: `${agentDir}/bin/..%2f..%2fevil`, args: [] },
    dotdot: { command: `${agentDir}/bin/..`, args: [] },
  };
  const binScripts = new Map();
  const mac = adaptMcpConfig(servers, binScripts, "darwin");
  for (const server of mac.servers) {
    assert.equal(server.action, "manual");
  }
});

test("adaptMcpConfig rejects bin scripts with unrecognized shebang", () => {
  const agentDir = isolateAgentDir();
  const servers = {
    weird: { command: `${agentDir}/bin/weird`, args: [] },
  };
  const binScripts = new Map([["weird", Buffer.from("#!/usr/bin/perl\nprint 1;\n")]]);
  const mac = adaptMcpConfig(servers, binScripts, "darwin");
  assert.equal(mac.servers[0].action, "manual");
  assert.match(mac.servers[0].reason, /shebang/);
});

test("adaptMcpConfig normalizes restored command into agentDir/bin", () => {
  const agentDir = isolateAgentDir();
  const servers = {
    ok: { command: `${agentDir}/bin/../bin/tool`, args: ["--flag"] },
  };
  const binScripts = new Map([["tool", Buffer.from("#!/usr/bin/env node\n")]]);
  const mac = adaptMcpConfig(servers, binScripts, "darwin");
  assert.equal(mac.servers[0].action, "restore-script");
  assert.equal(mac.servers[0].adapted.command, join(agentDir, "bin", "tool"));
  assert.deepEqual(mac.servers[0].adapted.args, ["--flag"]);
});

test("isSafeBinScriptName and isSafeScriptContent guards", () => {
  assert.equal(isSafeBinScriptName("my-mcp"), true);
  assert.equal(isSafeBinScriptName("a.b_c-1"), true);
  assert.equal(isSafeBinScriptName("../evil"), false);
  assert.equal(isSafeBinScriptName("a/b"), false);
  assert.equal(isSafeBinScriptName(".hidden"), false);
  assert.equal(isSafeScriptContent(Buffer.from("#!/usr/bin/env node\n")), true);
  assert.equal(isSafeScriptContent(Buffer.from("#!/bin/bash\n")), true);
  assert.equal(isSafeScriptContent(Buffer.from("#!/usr/bin/perl\n")), false);
  assert.equal(isSafeScriptContent(Buffer.from("plain text\n")), false);
});

test.after(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
});
