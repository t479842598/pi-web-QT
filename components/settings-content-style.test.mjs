import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as ts from "typescript";

const panels = [
  "ServerSwitchConfig", "DisplayConfig", "ChatConfig", "ModelsConfig",
  "SkillsConfig", "PluginsConfig", "ProxyConfig", "FeaturesConfig",
  "LogsConfig", "SnippetsConfig", "UsageConfig", "McpConfig",
  "AgentsConfig", "ToolsConfig", "BackupConfig", "ImportSessionsConfig",
];

async function elements(file) {
  const source = await readFile(new URL(`./${file}.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0, `${file} parses as TSX`);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = Object.fromEntries(node.attributes.properties
        .filter(ts.isJsxAttribute)
        .map((attr) => [attr.name.text, attr.initializer?.getText(ast) ?? ""]));
      found.push({ tag: node.tagName.getText(ast), attributes });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { source, found };
}

const hasClass = (found, tag, name) => found.some((el) =>
  (tag === "*" || el.tag === tag) && el.attributes.className?.includes(name));

test("shared toggle and section expose independent, stylable row and heading hooks", async () => {
  const { source, found } = await elements("SettingToggle");
  for (const [tag, name] of [
    ["label", "settings-content-row"], ["span", "settings-content-row-label"],
    ["span", "settings-content-row-description"], ["section", "settings-content-card"],
    ["h2", "settings-content-section-title"], ["p", "settings-content-section-description"],
  ]) assert.ok(hasClass(found, tag, name), `${tag}.${name}`);
  assert.match(source, /--settings-content-row-padding/);
  assert.match(source, /--settings-content-section-divider/);
  assert.doesNotMatch(source, /onMouse(?:Enter|Leave)/, "hover must not overwrite CSS backgrounds");
  assert.ok(found.some((el) => el.tag === "button" && el.attributes.role === '"switch"'));
});

test("shared detail controls keep their existing classes and offer card and content hooks", async () => {
  const { source, found } = await elements("SettingsUi");
  for (const name of [
    "settings-content-panel", "settings-content-surface", "settings-content-header",
    "settings-content-sidebar", "settings-content-sidebar-item", "settings-content-detail",
    "settings-content-detail-stack", "settings-content-detail-header", "settings-content-section-title",
    "settings-content-field", "settings-content-footer", "settings-content-card",
  ]) assert.ok(hasClass(found, "*", name), name);
  assert.match(source, /--settings-content-card-bg/);
  assert.match(source, /--settings-content-card-border/);
  assert.match(source, /"config-sidebar-item", "settings-content-sidebar-item", className/);
  assert.match(source, /"config-detail-stack", "settings-content-detail-stack", className/);
});

test("every settings pane exposes a scoped panel container without requiring a CSS positional selector", async () => {
  for (const panel of panels) {
    const { found } = await elements(panel);
    assert.ok(hasClass(found, "div", "settings-content-panel") ||
      (panel === "AgentsConfig" && found.some((el) => el.tag === "ConfigPanelShell")),
    `${panel} has a settings content root`);
  }
});

test("cards, headers and split editors have stable styling hooks", async () => {
  for (const panel of ["ServerSwitchConfig", "DisplayConfig", "ChatConfig", "BackupConfig"]) {
    const { found } = await elements(panel);
    assert.ok(hasClass(found, "header", "settings-content-header"), `${panel} header`);
    assert.ok(hasClass(found, "*", "settings-content-card") ||
      (panel === "ChatConfig" && found.some((el) => el.tag === "SettingSection")), `${panel} card`);
  }
  for (const panel of ["ModelsConfig", "SkillsConfig", "PluginsConfig"]) {
    const { found } = await elements(panel);
    for (const name of ["settings-content-surface", "settings-content-split", "settings-content-sidebar", "settings-content-detail", "settings-content-footer"]) {
      assert.ok(hasClass(found, "*", name), `${panel} ${name}`);
    }
  }
  for (const panel of ["ProxyConfig", "FeaturesConfig", "LogsConfig", "SnippetsConfig", "UsageConfig", "McpConfig", "ToolsConfig", "ImportSessionsConfig"]) {
    const { found } = await elements(panel);
    assert.ok(hasClass(found, "*", "settings-content-card") || found.some((el) => el.tag === "SettingsContentCard"), `${panel} cards`);
  }
});

test("card backgrounds and borders have fallback values and CSS variable overrides", async () => {
  for (const panel of ["SettingsUi", "ServerSwitchConfig", "UsageConfig", "LogsConfig", "SnippetsConfig", "ImportSessionsConfig"]) {
    const { source } = await elements(panel);
    assert.match(source, /--settings-content-card-bg/, `${panel} card background`);
    assert.match(source, /--settings-content-card-border/, `${panel} card border`);
  }
});
