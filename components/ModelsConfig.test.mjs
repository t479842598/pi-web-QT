import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  collectModelRenames,
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  trackAddedModels,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

test("API key removal reports authentication conflicts and always refreshes providers", async () => {
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  const apiKeyDetailSource = source.slice(
    source.indexOf("function ApiKeyDetail"),
    source.indexOf("// ── Add provider picker"),
  );
  const removeSource = apiKeyDetailSource.slice(
    apiKeyDetailSource.indexOf("const handleRemove"),
    apiKeyDetailSource.indexOf("return ("),
  );

  assert.match(removeSource, /res\.status === 409\s*\? t\("desktop\.modelsAuthenticationStateChanged"\)/);
  assert.match(removeSource, /finally\s*\{\s*onRefresh\(\);\s*setRemoving\(false\);\s*\}/);
});

test("custom provider card opens the wizard instead of creating a provider directly", async () => {
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  const pickerSource = source.slice(
    source.indexOf("function AddProviderPicker"),
    source.indexOf("// ── Main component"),
  );
  const mainSource = source.slice(source.indexOf("export function ModelsConfig"));

  // The picker still exposes onAddCustom for the custom card…
  assert.match(pickerSource, /onClick=\{\(\) => \{ onAddCustom\(\); onClose\(\); \}\}/);
  // …but the main component now routes it to the wizard instead of creating a blank provider.
  assert.match(mainSource, /onAddCustom=\{\(\) => \{ setPickerOpen\(false\); setCustomDialogOpen\(true\); \}\}/);
  assert.doesNotMatch(mainSource, /providers: \{ \.\.\.\(previous\.providers \?\? \{\}\), \[finalName\]: \{ api: "openai-completions" \} \}/);
  // The submitted provider entry embeds the wizard's model as the first model.
  assert.match(mainSource, /models: \[input\.model\]/);
});

test("custom provider wizard supports format import, URL input and custom request fields", async () => {
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  const dialogSource = source.slice(
    source.indexOf("function CustomProviderDialog"),
    source.indexOf("// ── Main component"),
  );

  // Call format selection + import from existing providers.
  assert.match(dialogSource, /API_OPTIONS\.map/);
  assert.match(dialogSource, /existingProviders\.map/);
  // mistral-conversations is a first-class call format.
  assert.ok(source.includes("\"mistral-conversations\""), "mistral-conversations in API_OPTIONS");
  // Custom call format option reveals the full URL; section labeled 完整 URL.
  assert.match(dialogSource, /CUSTOM_CALL_FORMAT/);
  assert.match(dialogSource, /desktop\.modelsCustomCallFormat/);
  assert.match(dialogSource, /desktop\.modelsCustomCallFormatHelp/);
  assert.match(dialogSource, /desktop\.modelsFullUrl/);
  // Click + to expand a full URL input, with http/https validation.
  assert.match(dialogSource, /onClick=\{\(\) => setUrlOpen\(true\)\}/);
  assert.ok(dialogSource.includes("/^https?:\\/\\//i"), "URL validation regex present");
  // API key can be entered manually next to the URL.
  assert.match(dialogSource, /SecretTextInput value=\{apiKey\}/);
  assert.match(dialogSource, /desktop\.modelsApiKeyPlaceholder/);
  assert.match(dialogSource, /desktop\.modelsApiKeyHelp/);
  // Custom request: model ID + context length + output length are persisted on submit.
  assert.match(dialogSource, /contextWindow: parseInt\(contextWindow, 10\)/);
  assert.match(dialogSource, /maxTokens: parseInt\(maxTokens, 10\)/);
});

test("provider detail has a manual add-model button next to import models", async () => {
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  const detailSource = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );

  assert.match(detailSource, /onAddModel: \(\) => void/);
  assert.match(detailSource, /onClick=\{onAddModel\}/);
  assert.match(detailSource, /desktop\.modelsAddModelManual/);
  // The detail is wired from the main component to the tree's addModel flow.
  const mainSource = source.slice(source.indexOf("export function ModelsConfig"));
  assert.match(mainSource, /onAddModel=\{\(\) => \{ void addModel\(selection\.name\); \}\}/);
});

const draft = (models) => ({ providers: { stepfun: { models: models.map((id) => ({ id })) } } });

test("a model renamed in place is reported with its saved reference", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(
    collectModelRenames(draft(["aaa", "ddd1"]), slots, new Map()),
    [{ from: "stepfun/ddd", to: "stepfun/ddd1" }],
  );
});

test("a model rename keeps the provider id the settings file still spells", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  // The panel renamed the provider too, so the slots moved with it.
  const moved = new Map([["house", slots.get("stepfun")]]);
  assert.deepEqual(
    collectModelRenames(
      { providers: { house: { models: [{ id: "aaa" }, { id: "ddd1" }] } } },
      moved,
      new Map([["stepfun", "house"]]),
    ),
    [{ from: "stepfun/ddd", to: "house/ddd1" }],
  );
});

test("added and removed models never look like a rename", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  trackAddedModels(slots, "stepfun", 1);
  assert.deepEqual(collectModelRenames(draft(["aaa", "ddd", "new"]), slots, new Map()), []);

  const spliced = savedModelIds(draft(["aaa", "ddd"]));
  spliced.get("stepfun").splice(0, 1);
  assert.deepEqual(collectModelRenames(draft(["ddd"]), spliced, new Map()), []);
});

test("a blank id in a half-typed row is not a rename yet", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(collectModelRenames(draft(["aaa", ""]), slots, new Map()), []);
});

test("a provider added since the last save has no saved slots to compare", () => {
  assert.deepEqual(collectModelRenames(draft(["aaa"]), new Map(), new Map()), []);
});
