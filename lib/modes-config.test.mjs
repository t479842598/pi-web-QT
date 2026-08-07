import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { after, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  readModeSettings,
  writeModeSettings,
  defaultModeSettings,
} = await jiti.import("./modes-config.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;
let agentDir;

function isolateAgentDir() {
  agentDir = mkdtempSync(join(tmpdir(), "pi-modes-config-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
}

function writeSettings(data) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(data, null, 2));
}

function readSettings() {
  return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
}

before(() => isolateAgentDir());
after(() => {
  if (ORIGINAL_ENV !== undefined) process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
  else delete process.env.PI_CODING_AGENT_DIR;
  if (agentDir) rmSync(agentDir, { recursive: true, force: true });
});

test("reads global defaults when settings.json is empty", () => {
  writeSettings({});
  const modes = readModeSettings();
  assert.deepEqual(modes, defaultModeSettings());
});

test("per-session override wins over the global record", async () => {
  writeSettings({
    modes: {
      collaborationMode: "plan",
      tokenMode: "delivery",
      toolApprovalMode: "ask",
      permissionRules: { allow: ["Bash"], ask: [], deny: [] },
    },
    modesPerSession: {
      "session-a": {
        collaborationMode: "goal",
        tokenMode: "economy",
        toolApprovalMode: "yolo",
        permissionRules: { allow: [], ask: ["Edit"], deny: [] },
      },
    },
  });

  // No session → global record.
  assert.equal(readModeSettings().collaborationMode, "plan");
  assert.equal(readModeSettings().tokenMode, "delivery");
  // session-a → its own override.
  assert.equal(readModeSettings("session-a").collaborationMode, "goal");
  assert.equal(readModeSettings("session-a").tokenMode, "economy");
  assert.equal(readModeSettings("session-a").toolApprovalMode, "yolo");
  assert.deepEqual(readModeSettings("session-a").permissionRules, { allow: [], ask: ["Edit"], deny: [] });
  // Unknown session → global defaults.
  assert.equal(readModeSettings("no-record-session").collaborationMode, "plan");
});

test("writeModeSettings with a session id does not touch the global key", async () => {
  writeSettings({ modes: { collaborationMode: "normal", tokenMode: "full", toolApprovalMode: "auto", permissionRules: { allow: [], ask: [], deny: [] } } });
  await writeModeSettings({ ...defaultModeSettings(), collaborationMode: "plan" }, "session-x");
  const file = readSettings();
  assert.equal(file.modes.collaborationMode, "normal");
  assert.equal(file.modesPerSession["session-x"].collaborationMode, "plan");
  // Reading the session returns the override; global unchanged.
  assert.equal(readModeSettings("session-x").collaborationMode, "plan");
  assert.equal(readModeSettings().collaborationMode, "normal");
});

test("two sessions keep independent overrides", async () => {
  writeSettings({ modes: defaultModeSettings() });
  await writeModeSettings({ ...defaultModeSettings(), tokenMode: "delivery" }, "session-1");
  await writeModeSettings({ ...defaultModeSettings(), collaborationMode: "goal" }, "session-2");
  assert.equal(readModeSettings("session-1").tokenMode, "delivery");
  assert.equal(readModeSettings("session-1").collaborationMode, "normal");
  assert.equal(readModeSettings("session-2").collaborationMode, "goal");
  assert.equal(readModeSettings("session-2").tokenMode, "full");
});