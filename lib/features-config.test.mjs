import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readFeaturesConfig, writeFeaturesConfig } = await jiti.import("./features-config.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-features-config-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

function writeSettings(agentDir, data) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(data, null, 2));
}

test("readFeaturesConfig returns defaults when unset", () => {
  isolateAgentDir();
  const config = readFeaturesConfig();
  assert.equal(config.tasksBoard, true);
});

test("readFeaturesConfig handles corrupt settings.json", () => {
  const agentDir = isolateAgentDir();
  writeFileSync(join(agentDir, "settings.json"), "not json{{");
  assert.equal(readFeaturesConfig().tasksBoard, true);
});

test("writeFeaturesConfig persists and preserves other settings fields", () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { proxy: { enabled: false }, defaultModel: "foo/bar" });

  writeFeaturesConfig({ tasksBoard: false });

  const file = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.equal(file.proxy.enabled, false);
  assert.equal(file.defaultModel, "foo/bar");
  assert.equal(file.features.tasksBoard, false);

  // Round-trip read.
  assert.equal(readFeaturesConfig().tasksBoard, false);
});

test("readFeaturesConfig normalizes invalid field types", () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { features: { tasksBoard: "yes" } });
  assert.equal(readFeaturesConfig().tasksBoard, true);
});

test.after(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
});
