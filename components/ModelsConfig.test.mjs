import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(dialogSource, /API_OPTIONS/);
  assert.match(dialogSource, /existingProviders\.map/);
  // Click + to expand a full URL input, with http/https validation.
  assert.match(dialogSource, /onClick=\{\(\) => setUrlOpen\(true\)\}/);
  assert.ok(dialogSource.includes("/^https?:\\/\\//i"), "URL validation regex present");
  // Custom request: model ID + context length + output length are persisted on submit.
  assert.match(dialogSource, /contextWindow: parseInt\(contextWindow, 10\)/);
  assert.match(dialogSource, /maxTokens: parseInt\(maxTokens, 10\)/);
});
