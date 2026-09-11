import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { FILE_TABS_KEY, serializeFileTabs, restoreFileTabs } = await createJiti(import.meta.url)
  .import("./file-tab-state.ts");

test("round-trips tabs, the active id and the panel open flag", () => {
  const tabs = [
    { id: "file:/a/b.ts", label: "b.ts", filePath: "/a/b.ts" },
    { id: "file:/a/c.md", label: "c.md", filePath: "/a/c.md", initialDisplayMode: "diff" },
    { id: "terminal:1", label: "shell", filePath: "/a", kind: "terminal" },
  ];
  const restored = restoreFileTabs(serializeFileTabs(tabs, "file:/a/c.md", true));
  assert.deepEqual(restored.tabs, tabs);
  assert.equal(restored.activeId, "file:/a/c.md");
  assert.equal(restored.open, true);
});

test("a tab that is mid-close is not persisted", () => {
  const tabs = [
    { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
    { id: "file:/b.ts", label: "b.ts", filePath: "/b.ts", closing: true },
  ];
  const restored = restoreFileTabs(serializeFileTabs(tabs, "file:/a.ts", true));
  assert.deepEqual(restored.tabs.map((tab) => tab.id), ["file:/a.ts"]);
});

test("malformed storage degrades to an empty strip instead of throwing", () => {
  for (const raw of [null, "", "not json", "[]", '{"tabs":"nope"}', "42"]) {
    assert.deepEqual(restoreFileTabs(raw), { tabs: [], activeId: null, open: false }, `raw=${String(raw)}`);
  }
});

test("entries missing id/filePath/label are dropped and duplicates collapse", () => {
  const raw = JSON.stringify({
    tabs: [
      { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
      { id: "file:/a.ts", label: "dup", filePath: "/a.ts" },
      { id: "", label: "no id", filePath: "/x" },
      { id: "file:/b.ts", label: "b.ts" },
      { id: "file:/c.ts", filePath: "/c.ts" },
      "junk",
    ],
    activeId: "file:/a.ts",
    open: true,
  });
  const restored = restoreFileTabs(raw);
  assert.deepEqual(restored.tabs.map((tab) => tab.id), ["file:/a.ts"]);
  assert.equal(restored.activeId, "file:/a.ts");
});

test("an activeId that no longer exists falls back to the last tab", () => {
  const raw = JSON.stringify({
    tabs: [
      { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
      { id: "file:/b.ts", label: "b.ts", filePath: "/b.ts" },
    ],
    activeId: "file:/gone.ts",
    open: true,
  });
  assert.equal(restoreFileTabs(raw).activeId, "file:/b.ts");
});

test("open is only true when there is at least one tab", () => {
  assert.equal(restoreFileTabs(JSON.stringify({ tabs: [], activeId: null, open: true })).open, false);
  assert.equal(restoreFileTabs(JSON.stringify({ tabs: [], activeId: null, open: false })).open, false);
});

test("storage key is namespaced with the pi-web prefix", () => {
  assert.equal(FILE_TABS_KEY, "pi-web:file-tabs");
});

test("a subagent tab round-trips on its session id, not a file path", () => {
  const tabs = [
    { id: "subagent:s1", label: "统计行数", filePath: "", kind: "subagent", sessionId: "s1" },
  ];
  const restored = restoreFileTabs(serializeFileTabs(tabs, "subagent:s1", true));
  assert.deepEqual(restored.tabs, tabs);
  assert.equal(restored.activeId, "subagent:s1");
  assert.equal(restored.open, true);
});

test("a subagent tab without a session id is dropped", () => {
  const raw = JSON.stringify({
    tabs: [
      { id: "subagent:s1", label: "no session", kind: "subagent" },
      { id: "subagent:s2", label: "ok", kind: "subagent", sessionId: "s2" },
    ],
    activeId: "subagent:s2",
    open: true,
  });
  assert.deepEqual(restoreFileTabs(raw).tabs.map((t) => t.id), ["subagent:s2"]);
});

test("a non-subagent tab still requires a file path", () => {
  const raw = JSON.stringify({
    tabs: [{ id: "file:/a.ts", label: "a.ts" }],
    activeId: null,
    open: true,
  });
  assert.deepEqual(restoreFileTabs(raw).tabs, []);
});
