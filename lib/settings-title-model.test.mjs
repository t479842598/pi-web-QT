import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  flattenModels,
  getTitleModel,
  getTitleModelData,
  isKnownTitleModel,
  setTitleModel,
} = await jiti.import("./settings-title-model.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-title-model-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

function writeSettings(agentDir, data) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(data, null, 2));
}

function writeModels(agentDir) {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "ds2api": {
        api: "openai-completions",
        models: [
          { id: "deepseek-v4-flash", reasoning: true, contextWindow: 1000000 },
          { id: "deepseek-v4-flash-search", contextWindow: 1000000 },
        ],
      },
      "glm": {
        api: "openai-completions",
        models: [
          { id: "glm-5.1-think", reasoning: true },
        ],
      },
      "empty": { api: "openai-completions" },
    },
  }, null, 2));
}

test("getTitleModel returns null when unset", () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { defaultModel: "foo/bar" });
  assert.equal(getTitleModel(), null);
});

test("setTitleModel persists and survives a fresh module load", async () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { defaultModel: "foo/bar", packages: ["npm:x"] });

  await setTitleModel("ds2api/deepseek-v4-flash");
  assert.equal(getTitleModel(), "ds2api/deepseek-v4-flash");

  // Other fields untouched
  const file = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.equal(file.defaultModel, "foo/bar");
  assert.deepEqual(file.packages, ["npm:x"]);
  assert.equal(file.titleModel, "ds2api/deepseek-v4-flash");

  // Simulate a restart: fresh module instance reads the same file
  const fresh = await jiti.import("./settings-title-model.ts");
  assert.equal(fresh.getTitleModel(), "ds2api/deepseek-v4-flash");
});

test("setTitleModel(null) removes the field", async () => {
  const agentDir = isolateAgentDir();
  writeSettings(agentDir, { titleModel: "ds2api/deepseek-v4-flash" });

  await setTitleModel(null);
  assert.equal(getTitleModel(), null);
  const file = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.equal("titleModel" in file, false);
});

test("flattenModels lists all providers' models with labels and reasoning", () => {
  const agentDir = isolateAgentDir();
  writeModels(agentDir);

  const options = flattenModels(JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")));
  const labels = options.map((o) => o.label);
  assert.ok(labels.includes("ds2api/deepseek-v4-flash"));
  assert.ok(labels.includes("ds2api/deepseek-v4-flash-search"));
  assert.ok(labels.includes("glm/glm-5.1-think"));
  assert.equal(options.length, 3);
  assert.equal(options.find((o) => o.label === "ds2api/deepseek-v4-flash").reasoning, true);
  assert.equal(options.find((o) => o.label === "ds2api/deepseek-v4-flash-search").reasoning, false);
  // sorted by label
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(labels, sorted);
});

test("flattenModels handles missing/corrupt models.json", () => {
  const agentDir = isolateAgentDir();
  assert.deepEqual(flattenModels({}), []);
  writeFileSync(join(agentDir, "models.json"), "not json{{");
  assert.deepEqual(flattenModels({ providers: {} }), []);
});

test("isKnownTitleModel matches imported models only", () => {
  const agentDir = isolateAgentDir();
  writeModels(agentDir);
  const { models } = getTitleModelData();
  assert.equal(isKnownTitleModel("ds2api/deepseek-v4-flash", models), true);
  assert.equal(isKnownTitleModel("ds2api/gone-model", models), false);
});

test("getTitleModelData combines value and flattened models", () => {
  const agentDir = isolateAgentDir();
  writeModels(agentDir);
  writeSettings(agentDir, { titleModel: "glm/glm-5.1-think" });

  const data = getTitleModelData();
  assert.equal(data.value, "glm/glm-5.1-think");
  assert.equal(data.models.length, 3);
});

test.after(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
});
