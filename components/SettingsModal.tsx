"use client";

import { useCallback, useRef, useState } from "react";
import { ChatCenteredText, ChartBar, Cpu, Database, DownloadSimple, Lightning, List, ListBullets, Monitor, Network, Plug, Robot, Stack, TerminalWindow, X } from "@phosphor-icons/react";
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
import { SubagentsConfig } from "./SubagentsConfig";
import { UsageConfig } from "./UsageConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

export type SettingsTab = "display" | "chat" | "models" | "skills" | "plugins" | "proxy" | "features" | "logs" | "snippets" | "usage" | "backup" | "import" | "mcp" | "subagents";

interface SettingsModalProps {
  initialTab?: SettingsTab;
  cwd: string | null;
  sessionId: string | null;
  onCloseAction: () => void;
  onModelsSavedAction: () => void;
  onSessionReloadedAction: () => void;
  onSessionsChanged?: () => void;
}

const tabs: { id: SettingsTab; labelKey: string; Icon: typeof Cpu }[] = [
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) void requestClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("desktop.settings")}
        className="settings-modal"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 1000,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "80vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("desktop.settings")}</span>
            {activeTab === "models" ? (
              <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                ~/.pi/agent/models.json
              </code>
            ) : cwd && (
              <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cwd}
              </code>
            )}
          </div>
          <button
            type="button"
            onClick={() => { void requestClose(); }}
            disabled={closing}
            title={t("desktop.closeSettings")}
            aria-label={t("desktop.closeSettings")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, display: "flex" }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: 0, overflow: "hidden", pointerEvents: closing ? "none" : undefined }}>
          <nav
            aria-label={t("desktop.settingsSections")}
            style={{
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 4,
              width: isMobile ? "100%" : 150,
              padding: 8,
              flexShrink: 0,
              minWidth: 0,
              background: "var(--bg-panel)",
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              // On mobile all tabs cannot fit one row; allow horizontal
              // scrolling so every tab stays reachable (previously the
              // overflow was clipped with no scrollbar and the last tabs
              // were unreachable).
              overflowX: isMobile ? "auto" : undefined,
              overflowY: isMobile ? "hidden" : undefined,
              WebkitOverflowScrolling: isMobile ? "touch" : undefined,
            }}
          >
            {tabs.filter(({ id }) => !(isMobile && id === "import")).map(({ id, labelKey, Icon }) => {
              const disabled = (id === "skills" || id === "plugins") && !cwd;
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: isMobile ? "0 0 auto" : undefined,
                    whiteSpace: "nowrap",
                    width: isMobile ? undefined : "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 6,
                    background: active ? "var(--bg-selected)" : "none",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  title={t(labelKey)}
                  aria-label={t(labelKey)}
                  onMouseEnter={(event) => {
                    if (!active && !disabled) {
                      event.currentTarget.style.background = "var(--bg-hover)";
                      event.currentTarget.style.color = "var(--text)";
                    }
                  }}
                  onMouseLeave={(event) => {
                    if (!active) {
                      event.currentTarget.style.background = "none";
                      event.currentTarget.style.color = "var(--text-muted)";
                    }
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {!isMobile && <span>{t(labelKey)}</span>}
                </button>
              );
            })}
          </nav>

          <div style={{ display: activeTab === "display" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <DisplayConfig />
          </div>
          <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ChatConfig />
          </div>
          <div style={{ display: activeTab === "models" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ModelsConfig embedded sessionId={sessionId} onSavedAction={onModelsSavedAction} onRegisterFlush={registerFlush} />
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
            <SubagentsConfig cwd={cwd} sessionId={sessionId} />
          </div>
          <div style={{ display: activeTab === "backup" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <BackupConfig cwd={cwd} />
          </div>
          <div style={{ display: activeTab === "import" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            <ImportSessionsConfig onSessionsChanged={onSessionsChanged} />
          </div>
        </div>
        {closeError && (
          <div style={{ padding: "6px 18px", borderTop: "1px solid var(--border)", color: "#f87171", fontSize: 11 }}>
            {closeError}
          </div>
        )}
      </section>
    </div>
  );
}
