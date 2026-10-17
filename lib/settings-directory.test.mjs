import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { SETTINGS_DIRECTORY_GROUPS, groupSettingsDirectory } = await createJiti(import.meta.url).import("./settings-directory.ts");
const tabs = SETTINGS_DIRECTORY_GROUPS.flatMap((group) => group.ids.map((id) => ({ id, labelKey: `desktop.${id}` })));
const translate = (key) => ({ "desktop.models": "模型", "desktop.plugins": "插件", "desktop.import": "导入会话" })[key] ?? key;

test("directory keeps every existing settings destination once and in order", () => {
  const groups = groupSettingsDirectory(tabs, "", translate);
  assert.deepEqual(groups.flatMap((group) => group.tabs.map((tab) => tab.id)), tabs.map((tab) => tab.id));
  // 16 pre-existing destinations + "ui-kit" (the two-kit switch, ADR 0006).
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, 17);
});

test("the interface-kit section sits right after display", () => {
  const order = SETTINGS_DIRECTORY_GROUPS.flatMap((group) => group.ids);
  const display = order.indexOf("display");
  assert.equal(order[display + 1], "ui-kit");
  assert.ok(order.includes("ui-kit"));
});

test("search filters translated section labels without changing the source", () => {
  assert.deepEqual(groupSettingsDirectory(tabs, " 模型 ", translate).map((group) => [group.id, group.tabs.map((tab) => tab.id)]), [["agent", ["models"]]]);
  assert.deepEqual(groupSettingsDirectory(tabs, " 插件 ", translate).flatMap((group) => group.tabs.map((tab) => tab.id)), ["plugins"]);
  assert.deepEqual(groupSettingsDirectory(tabs, "not-found", translate), []);
  assert.equal(tabs.length, 17);
});

test("hidden server and mobile import remain hidden when the caller excludes them", () => {
  const visible = tabs.filter((tab) => !["server", "import"].includes(tab.id));
  assert.equal(groupSettingsDirectory(visible, "", translate).flatMap((group) => group.tabs).length, 15);
  assert.deepEqual(groupSettingsDirectory(visible, "导入", translate), []);
});
