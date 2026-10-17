import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal, SETTINGS_TABS, type SettingsTab } from "../components/SettingsModal";
import { I18nContext } from "../hooks/useI18n";
import { zhCNLocale } from "../lib/i18n/messages/zh-CN";

/**
 * Offline settings-page fixture.
 *
 * The real `SettingsModal` and the real section components are mounted; only
 * the network is faked (`scripts/settings-shot.mjs` intercepts `/api/*`). That
 * is what makes these screenshots representative: the shell, the nav, and the
 * *contents* of each section are the shipping code paths, not stubs.
 */

const t = (key: string, vars?: Record<string, string | number>) => {
  const template = (zhCNLocale.messages as Record<string, string>)[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
};

function Fixture() {
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return (SETTINGS_TABS.find(({ id }) => id === requested)?.id ?? "display") as SettingsTab;
  });
  // SettingsModal owns its own tab state; remount on change so the requested
  // section is the one that renders.
  return (
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => {}, t, supportedLocales: [zhCNLocale] }}
    >
      <div style={{ position: "fixed", inset: 0 }}>
        <SettingsModal
          key={tab}
          initialTab={tab}
          cwd="/Users/demo/project"
          sessionId="fixture-session"
          onCloseAction={() => {}}
          onModelsSavedAction={() => {}}
          onSessionReloadedAction={() => {}}
        />
      </div>
      <select
        aria-label="section"
        value={tab}
        onChange={(event) => {
          const next = event.target.value as SettingsTab;
          const url = new URL(window.location.href);
          url.searchParams.set("tab", next);
          window.location.href = url.toString();
        }}
        style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999 }}
      >
        {SETTINGS_TABS.map(({ id }) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
    </I18nContext.Provider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("settings fixture: #root is missing");
// Mark the container before rendering: a black screenshot with "no errors" is
// otherwise indistinguishable from "the bundle never ran at all".
container.dataset.fixtureBooted = "1";
createRoot(container).render(<Fixture />);
container.dataset.fixtureRendered = "1";
