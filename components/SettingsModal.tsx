"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { ArrowLeft, ChatCenteredText, ChartBar, Cpu, Database, DownloadSimple, Lightning, List, ListBullets, MagnifyingGlass, Monitor, Network, Plug, PlugsConnected, Robot, Stack, TerminalWindow, X } from "@phosphor-icons/react";
import { groupSettingsDirectory } from "@/lib/settings-directory";
import { BackupConfig } from "./BackupConfig";
import { ChatConfig } from "./ChatConfig";
import { DisplayConfig } from "./DisplayConfig";
import { FeaturesConfig } from "./FeaturesConfig";
import { ImportSessionsConfig } from "./ImportSessionsConfig";
import { McpConfig } from "./McpConfig";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ProxyConfig } from "./ProxyConfig";
import { SkillsConfig } from "./SkillsConfig";
import { LogsConfig } from "./LogsConfig";
import { SnippetsConfig } from "./SnippetsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { ToolsConfig } from "./ToolsConfig";
import { UsageConfig } from "./UsageConfig";
import { ServerSwitchConfig } from "./ServerSwitchConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

export type SettingsTab = "server" | "display" | "chat" | "models" | "skills" | "plugins" | "proxy" | "features" | "logs" | "snippets" | "usage" | "backup" | "import" | "mcp" | "subagents" | "tools";

interface SettingsModalProps {
  initialTab?: SettingsTab;
  cwd: string | null;
  sessionId: string | null;
  onCloseAction: () => void;
  onModelsSavedAction: () => void;
  onSessionReloadedAction: () => void;
  onSessionsChanged?: () => void;
}

/** The single source of truth for settings sections.
 *
 * Exported so other entry points (the sidebar footer) can offer the same set
 * instead of maintaining a second, drifting list. */
export const SETTINGS_TABS: { id: SettingsTab; labelKey: string; Icon: typeof Cpu }[] = [
  { id: "server", labelKey: "desktop.server", Icon: PlugsConnected },
  { id: "display", labelKey: "desktop.display", Icon: Monitor },
  { id: "chat", labelKey: "desktop.chat", Icon: ChatCenteredText },
  { id: "models", labelKey: "desktop.models", Icon: Cpu },
  { id: "skills", labelKey: "desktop.skills", Icon: Stack },
  { id: "plugins", labelKey: "desktop.plugins", Icon: Plug },
  { id: "proxy", labelKey: "desktop.proxy", Icon: Network },
  { id: "features", labelKey: "desktop.features", Icon: Lightning },
  { id: "logs", labelKey: "desktop.logs", Icon: List },
  { id: "snippets", labelKey: "desktop.snippets", Icon: ListBullets },
  { id: "usage", labelKey: "desktop.usage", Icon: ChartBar },
  { id: "mcp", labelKey: "desktop.mcp", Icon: TerminalWindow },
  { id: "subagents", labelKey: "desktop.subagents", Icon: Robot },
  { id: "tools", labelKey: "desktop.tools", Icon: TerminalWindow },
  { id: "backup", labelKey: "desktop.backup", Icon: Database },
  // Import stays desktop-only for now (Windows/macOS path handling).
  { id: "import", labelKey: "desktop.importSessions", Icon: DownloadSimple },
];

export function SettingsModal({
  initialTab = "models",
  cwd,
  sessionId,
  onCloseAction,
  onModelsSavedAction,
  onSessionReloadedAction,
  onSessionsChanged,
}: SettingsModalProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab === "skills" || initialTab === "plugins" ? (cwd ? initialTab : "display") : initialTab,
  );
  // 桌面壳环境（URL 带 ?piweb_connected=1）：显示「服务器」配置入口；纯浏览器隐藏。
  // 远程配对不在此列——它由网页端生成二维码给手机扫，浏览器里同样需要，
  // 面板自己会在未配置中继时给出提示。
  const [desktopShell, setDesktopShell] = useState(false);
  useEffect(() => {
    setDesktopShell(new URLSearchParams(window.location.search).has("piweb_connected"));
  }, []);
  const visibleTabs = desktopShell ? SETTINGS_TABS : SETTINGS_TABS.filter(({ id }) => id !== "server");
  const navigableTabs = visibleTabs.filter(({ id }) => !(isMobile && id === "import"));
  const [query, setQuery] = useState("");
  const groups = groupSettingsDirectory(navigableTabs, query, t);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const keepFocusInSettings = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || dialogRef.current?.querySelector("[data-settings-child-dialog]")) return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((item) => !item.hasAttribute("disabled") && item.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Multiple embedded configs can register a close-time flush (e.g. the
  // models.json editor needs to persist pending edits before the dialog
  // unmounts).
  const flushRefs = useRef(new Set<() => Promise<void>>());
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushRefs.current.add(flush);
    return () => {
      flushRefs.current.delete(flush);
    };
  }, []);

  const requestClose = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    setCloseError(null);
    try {
      // Flush every registered config independently: one failing flush must
      // not prevent the others from persisting.
      const results = await Promise.allSettled([...flushRefs.current].map((flush) => flush()));
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (firstError) throw firstError.reason;
      onCloseAction();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : String(error));
    } finally {
      setClosing(false);
    }
  }, [closing, onCloseAction]);

  useEscapeKey(!closing, () => {
    if (!dialogRef.current?.querySelector("[data-settings-child-dialog]")) void requestClose();
  });

  return (
    <div className="settings-page-overlay">
      <section
        ref={dialogRef}
        onKeyDown={keepFocusInSettings}
        role="dialog"
        aria-modal="true"
        aria-label={t("desktop.settings")}
        className="settings-modal"
      >
        <aside className="settings-modal-rail">
          <div className="settings-modal-rail-top">
            <div className="settings-modal-search-wrap">
              <MagnifyingGlass size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("desktop.settingsSearch")}
                aria-label={t("desktop.settingsSearch")}
              />
            </div>
          </div>
          <nav className="settings-modal-nav" aria-label={t("desktop.settingsSections")}>
            {groups.length === 0 ? (
              <p className="settings-modal-empty">{t("desktop.settingsNoResults")}</p>
            ) : groups.map((group) => (
              <div className="settings-modal-nav-group" key={group.id}>
                <div className="settings-modal-group-label">{t(group.labelKey)}</div>
                {group.tabs.map(({ id, labelKey, Icon }) => {
                  const disabled = (id === "skills" || id === "plugins") && !cwd;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="settings-modal-nav-item"
                      disabled={disabled}
                      onClick={() => setActiveTab(id)}
                      aria-current={activeTab === id ? "page" : undefined}
                      title={t(labelKey)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{t(labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="settings-modal-rail-footer">
            <button type="button" onClick={() => { void requestClose(); }} disabled={closing}>
              <ArrowLeft size={16} aria-hidden="true" />
              <span>{t("desktop.settingsBack")}</span>
            </button>
          </div>
        </aside>

        <main className="settings-modal-main">
          <header className="settings-modal-heading">
            <div className="settings-modal-heading-copy">
              <h1>{t(SETTINGS_TABS.find(({ id }) => id === activeTab)?.labelKey ?? "desktop.settings")}</h1>
              {activeTab === "models" ? (
                <code>~/.pi/agent/models.json</code>
              ) : cwd && (
                <code title={cwd}>{cwd}</code>
              )}
            </div>
            <button
              type="button"
              className="settings-modal-close"
              onClick={() => { void requestClose(); }}
              disabled={closing}
              title={t("desktop.closeSettings")}
              aria-label={t("desktop.closeSettings")}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          <div className="settings-modal-page" style={{ pointerEvents: closing ? "none" : undefined }}>
          <div style={{ display: activeTab === "server" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ServerSwitchConfig />
          </div>
          <div style={{ display: activeTab === "display" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <DisplayConfig />
          </div>
          <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ChatConfig />
          </div>
          <div style={{ display: activeTab === "models" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ModelsConfig embedded sessionId={sessionId} cwd={cwd} onSavedAction={onModelsSavedAction} onRegisterFlush={registerFlush} />
          </div>
          {cwd && (
            <div style={{ display: activeTab === "skills" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <SkillsConfig cwd={cwd} embedded sessionId={sessionId} />
            </div>
          )}
          {cwd && (
            <div style={{ display: activeTab === "plugins" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <PluginsConfig cwd={cwd} sessionId={sessionId} embedded onReloadedAction={onSessionReloadedAction} />
            </div>
          )}
          <div style={{ display: activeTab === "proxy" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ProxyConfig />
          </div>
          <div style={{ display: activeTab === "features" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <FeaturesConfig />
          </div>
          <div style={{ display: activeTab === "logs" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <LogsConfig />
          </div>
          <div style={{ display: activeTab === "snippets" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <SnippetsConfig />
          </div>
          <div style={{ display: activeTab === "usage" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <UsageConfig sessionId={sessionId} cwd={cwd} />
          </div>
          <div style={{ display: activeTab === "mcp" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <McpConfig sessionId={sessionId} />
          </div>
          <div style={{ display: activeTab === "subagents" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <AgentsConfig embedded cwd={cwd ?? ""} sessionId={sessionId} onClose={onCloseAction} />
          </div>
          <div style={{ display: activeTab === "tools" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ToolsConfig sessionId={sessionId} onSessionReloaded={onSessionReloadedAction} />
          </div>
          <div style={{ display: activeTab === "backup" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <BackupConfig cwd={cwd} />
          </div>
          <div style={{ display: activeTab === "import" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            <ImportSessionsConfig onSessionsChanged={onSessionsChanged} />
          </div>
          </div>
          {closeError && (
            <div className="settings-modal-close-error" role="alert">{closeError}</div>
          )}
        </main>
      </section>
    </div>
  );
}
