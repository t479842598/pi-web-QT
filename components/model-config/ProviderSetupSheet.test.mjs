import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ProviderSetupSheet.tsx", import.meta.url), "utf8");
const panesSource = await readFile(new URL("./ModelSelectionPanes.tsx", import.meta.url), "utf8");
const chooserSource = await readFile(new URL("./ServiceChooser.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../../hooks/useProviderModels.ts", import.meta.url), "utf8");

test("the setup sheet is a settings-sheet child dialog", () => {
  assert.match(source, /className="settings-sheet-overlay" data-settings-child-dialog="true"/);
  for (const name of [
    "settings-sheet-head",
    "settings-sheet-head-copy",
    "settings-sheet-title",
    "settings-sheet-sub",
    "settings-sheet-close",
    "settings-sheet-body",
    "settings-sheet-foot",
    "settings-sheet-foot-status",
    "settings-sheet-foot-actions",
  ]) {
    assert.match(source, new RegExp(`className="${name}"`), name);
  }
});

test("the sheet wires discovery, api detection and recommendation to the shared pure modules", () => {
  assert.match(source, /useProviderModels\(\s*open,/);
  assert.match(source, /resolveEndpointDraft\(\{/);
  assert.match(source, /recommendModelIds\(\{ models: discovery\.models \}\)/);
  assert.match(source, /canRecommendFrom\(discovery\)/);
  // The auto-detected note goes through the existing translated key.
  assert.match(source, /modelsApiStyleAutoDetected/);
  assert.match(source, /apiStyleLabel\(effectiveApi\)/);
});

test("the automatic preselection runs once per provider and endpoint", () => {
  // A ref, not state: the effect reads the list it writes, so state would re-run it.
  assert.match(source, /const preselectedKeyRef = useRef<string \| null>\(null\)/);
  assert.match(source, /const key = `\$\{name\}\|\$\{baseUrl\}`;/);
  assert.match(source, /if \(preselectedKeyRef\.current === key\) return;/);
  assert.match(source, /preselectedKeyRef\.current = key;/);
});

test("the sheet exposes test and save through the existing translated keys", () => {
  assert.match(source, /t\("desktop\.modelsSetupTest"\)/);
  assert.match(source, /t\("desktop\.modelsSetupSaveProvider"\)/);
  assert.match(source, /t\("desktop\.modelsSetupBaseUrlRequired"\)/);
  assert.match(source, /"\/api\/models-config\/test"/);
  // The probe line maps each error kind to its own copy.
  for (const kind of [
    "unauthorized", "forbidden", "notFound", "rateLimited", "upstream", "timeout", "network", "invalidResponse",
  ]) {
    assert.match(source, new RegExp(`${kind}: "desktop\\.modelsProbeError`), kind);
  }
});

test("the model panes cover both columns, reorder and the default badge", () => {
  for (const key of [
    "desktop.modelsDiscoverTitle",
    "desktop.modelsChosenTitle",
    "desktop.modelsChosenEmpty",
    "desktop.modelsDefaultBadge",
    "desktop.modelsMoveUp",
    "desktop.modelsMoveDown",
    "desktop.modelsRevealAdvanced",
  ]) {
    assert.ok(panesSource.includes(`t("${key}")`), key);
  }
  assert.match(panesSource, /useListReorder\(\{/);
  assert.match(panesSource, /itemProps\(index\)/);
  assert.match(panesSource, /keyboardProps\(index\)/);
  assert.match(panesSource, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(300px, 100%\), 1fr\)\)"/);
  // The indeterminate "select shown" box needs the DOM node.
  assert.match(panesSource, /selectAllRef\.current\.indeterminate = someVisibleSelected/);
});

test("the service chooser filters presets through the shared helper", () => {
  assert.match(chooserSource, /filterServiceOptions\(presetOptions, query\)/);
  assert.match(chooserSource, /presetHaystack\(preset\)/);
  assert.match(chooserSource, /NAMED_ENDPOINT_PRESETS\.map/);
  assert.match(chooserSource, /useEscapeKey\(open, onClose\)/);
  for (const key of [
    "desktop.modelsServiceChooserSearch",
    "desktop.modelsServiceGroupSubscriptions",
    "desktop.modelsServiceGroupApiKey",
    "desktop.modelsServiceGroupPresets",
    "desktop.modelsServiceGroupCustom",
    "desktop.modelsServiceNoMatch",
  ]) {
    assert.ok(chooserSource.includes(`t("${key}")`), key);
  }
});

test("no hover handler rewrites a background and no literal hex colour is used", () => {
  for (const [name, text] of [["ProviderSetupSheet", source], ["ModelSelectionPanes", panesSource], ["ServiceChooser", chooserSource]]) {
    // Built from fragments so this assertion's own source does not read as a
    // hover handler to a grep over the directory.
    assert.doesNotMatch(text, new RegExp(`${"onMouse"}${"Enter"}|${"onMouse"}${"Leave"}`), `${name} hover`);
    // Strip block comments first: the rationale lines mention colours by name.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${name} hex colour`);
  }
});

test("discovery sends the endpoint draft and never the model list", () => {
  assert.match(hookSource, /FETCH_DEBOUNCE_MS = 600/);
  assert.match(hookSource, /const id = \+\+requestSeq\.current;/);
  assert.match(hookSource, /requestSeq\.current !== id/);
  assert.match(hookSource, /new AbortController\(\)/);
  assert.match(hookSource, /if \(controller\.signal\.aborted\) return;/);
  assert.match(hookSource, /provider\.baseUrl = trimmedBaseUrl;/);
  assert.match(hookSource, /provider\.apiKey = trimmedApiKey;/);
  // The request body must not carry `models`: the probe describes the endpoint.
  assert.doesNotMatch(hookSource, /provider\.models\s*=/);
  assert.match(hookSource, /describeModelsFetchError\(/);
  // The saved list is painted before the probe, and kept when the probe fails.
  assert.match(hookSource, /\? \{ status: "ready", models: saved, source: "saved" \}/);
  // A failed probe keeps the saved list and records why.
  assert.match(hookSource, /status: "error",\s*models: saved,/);
});
