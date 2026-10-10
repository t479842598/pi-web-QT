import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [modal, sidebar, titlebar, shell, css] = await Promise.all([
  "SettingsModal.tsx", "SessionSidebar.tsx", "AppTitleBar.tsx", "AppShell.tsx", "../app/settings.css",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("settings keeps all existing panels and close-time flush while using a searchable directory", () => {
  const ids = [...modal.matchAll(/\{ id: "([^"]+)", labelKey:/g)].map((match) => match[1]);
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
  for (const id of ids) assert.match(modal, new RegExp(`activeTab === "${id}"`));
  assert.match(modal, /groupSettingsDirectory\(navigableTabs, query, t\)/);
  assert.match(modal, /className="settings-modal-search-wrap"/);
  assert.match(modal, /groups\.length === 0/);
  assert.match(modal, /\(id === "skills" \|\| id === "plugins"\) && !cwd/);
  assert.match(modal, /isMobile && id === "import"/);
  assert.match(modal, /Promise\.allSettled\(\[\.\.\.flushRefs\.current\]/);
  assert.match(modal, /onCloseAction\(\)/);
  assert.match(modal, /useEscapeKey\(!closing, \(\) => \{/);
  assert.match(modal, /querySelector\("\[data-settings-child-dialog\]"\)\) void requestClose\(\)/);
  assert.match(modal, /searchRef\.current\?\.focus\(\)/);
  assert.match(modal, /return \(\) => previous\?\.focus\(\)/);
  assert.match(modal, /onKeyDown=\{keepFocusInSettings\}/);
  assert.match(modal, /event\.shiftKey && document\.activeElement === first/);
  assert.match(modal, /document\.activeElement === last/);
  assert.match(modal, /<AgentsConfig embedded cwd=/);
  assert.match(modal, /className="settings-modal-close-error" role="alert"/);
});

test("main sidebar has one icon-only footer and no repeated settings gear in title bar", () => {
  const footer = sidebar.match(/<footer className="sidebar-utility-bar"[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.match(footer, /<Gear size=\{16\}/);
  assert.match(footer, /onOpenSettings\("plugins"\)/);
  assert.match(footer, /tasksBoardEnabled && onToggleTasks/);
  assert.match(footer, /aria-pressed=\{showTasks\}/);
  assert.match(footer, /disabled=\{!selectedCwd && !selectedCwdProp\}/);
  assert.match(footer, /packageInfo\.version/);
  assert.doesNotMatch(sidebar, /gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.doesNotMatch(titlebar, /onOpenSettings|<Gear/);
  assert.match(shell, /onToggleTasks=\{handleToggleTasks\}/);
  assert.match(shell, /tasksBoardEnabled=\{tasksBoardEnabled\}/);
  assert.match(css, /\.sidebar-utility-bar \{[^}]*display: flex;[^}]*margin-top: auto;/);
  assert.doesNotMatch(css.match(/\.sidebar-utility-bar \{[^}]*\}/)?.[0] ?? "", /border-top/);
});

test("settings rail and narrow-screen styles preserve reachable navigation and theme tokens", () => {
  assert.match(css, /\.settings-modal-rail \{[^}]*flex: 0 0 275px;/);
  assert.match(css, /\.settings-modal-nav \{[^}]*overflow: auto;/);
  assert.match(css, /\.settings-content-panel:not\(:has\(> \.settings-content-surface\)\)/);
  assert.match(css, /\.settings-modal-nav-item:focus-visible/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.settings-modal-nav \{[^}]*overflow-x: auto;/);
  assert.match(css, /\.settings-modal \{[^}]*background: var\(--bg\);/);
  assert.match(css, /@media \(max-width: 767px\) and \(max-height: 500px\)/);
  assert.match(css, /settings-content-split > \.settings-content-sidebar \{ max-height: min\(30%, 160px\)/);
  assert.match(css, /\.settings-page-overlay \{ box-sizing: border-box; padding: max\(59px, env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.sidebar-utility-bar \{ padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /orientation: landscape/);
});

test("nested provider dialogs take Escape before the settings page", async () => {
  const models = await readFile(new URL("ModelsConfig.tsx", import.meta.url), "utf8");
  // AddProviderPicker, CustomProviderDialog, and the row-opened detail editor
  // each render a child dialog that must capture Escape before the page.
  assert.equal(models.match(/data-settings-child-dialog="true"/g)?.length, 3);
});
