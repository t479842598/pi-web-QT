import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  filterDisabledExtensionTools,
  normalizeExtensionToolSettings,
  readExtensionToolSettings,
  writeExtensionToolSettings,
  getExtensionToolsPath,
} = await createJiti(import.meta.url).import("./extension-tools.ts");

function tempDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-exttools-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("no configuration keeps every extension tool active", () => {
  // The default must preserve existing behaviour: an empty policy filters
  // nothing, so extensions and MCP tools stay usable.
  const tools = ["read", "Agent", "mcp_lrnev_project_status", "lsp_fix"];
  assert.deepEqual(filterDisabledExtensionTools(tools, { disabled: [] }), tools);
});

test("disabled names are filtered out of the active list", () => {
  const tools = ["read", "Agent", "lsp_fix", "start_supervision"];
  const result = filterDisabledExtensionTools(tools, { disabled: ["lsp_fix", "start_supervision"] });
  assert.deepEqual(result, ["read", "Agent"]);
});

test("unknown disabled names are harmless", () => {
  const tools = ["read", "Agent"];
  assert.deepEqual(filterDisabledExtensionTools(tools, { disabled: ["not-installed"] }), tools);
});

test("normalize trims, de-duplicates, and drops non-strings", () => {
  assert.deepEqual(
    normalizeExtensionToolSettings({ disabled: ["  lsp_fix  ", "lsp_fix", 42, null, "", "Agent"] }),
    { disabled: ["lsp_fix", "Agent"] },
  );
  for (const raw of [null, undefined, 42, "nope", [], { disabled: "x" }]) {
    assert.deepEqual(normalizeExtensionToolSettings(raw), { disabled: [] }, `raw=${JSON.stringify(raw)}`);
  }
});

test("settings round-trip through the config file", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "extension-tools.json");
  assert.deepEqual(readExtensionToolSettings(file), { disabled: [] }, "missing file = no policy");

  await writeExtensionToolSettings({ disabled: ["lsp_fix", "Agent"] }, file);
  assert.deepEqual(readExtensionToolSettings(file), { disabled: ["lsp_fix", "Agent"] });

  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(written.version, 1);
  assert.deepEqual(written.disabled, ["lsp_fix", "Agent"]);
});

test("a corrupt policy file disables nothing", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "extension-tools.json");
  fs.writeFileSync(file, "{not json");
  // Failing open matters: a bad file must not strip every extension tool.
  assert.deepEqual(readExtensionToolSettings(file), { disabled: [] });
});

test("writing replaces the previous policy rather than merging", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "extension-tools.json");
  await writeExtensionToolSettings({ disabled: ["a", "b"] }, file);
  await writeExtensionToolSettings({ disabled: ["b"] }, file);
  assert.deepEqual(readExtensionToolSettings(file), { disabled: ["b"] });
});

test("the config path lives in the agent directory", () => {
  assert.equal(getExtensionToolsPath("/tmp/agent"), path.join("/tmp/agent", "extension-tools.json"));
});
