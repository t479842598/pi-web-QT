"use client";

import { useState } from "react";
import { ChatCenteredText, Monitor, X } from "@phosphor-icons/react";
import { ChatConfig } from "./ChatConfig";
import { DisplayConfig } from "./DisplayConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

export type SettingsTab = "chat" | "display";

interface SettingsModalProps {
  initialTab?: SettingsTab;
  onCloseAction: () => void;
}

const tabs: { id: SettingsTab; labelKey: string; Icon: typeof ChatCenteredText }[] = [
  { id: "chat", labelKey: "desktop.chat", Icon: ChatCenteredText },
  { id: "display", labelKey: "desktop.display", Icon: Monitor },
];

export function SettingsModal({
  initialTab = "chat",
  onCloseAction,
}: SettingsModalProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

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
        if (event.target === event.currentTarget) onCloseAction();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("desktop.settings")}
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 760,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "70vh",
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
          </div>
          <button
            type="button"
            onClick={onCloseAction}
            title={t("desktop.closeSettings")}
            aria-label={t("desktop.closeSettings")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, display: "flex" }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {tabs.length > 1 && (
          <nav
            aria-label={t("desktop.settingsSections")}
            style={{
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 4,
              width: isMobile ? "100%" : 150,
              padding: 8,
              flexShrink: 0,
              background: "var(--bg-panel)",
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
            }}
          >
            {tabs.map(({ id, labelKey, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: isMobile ? 1 : undefined,
                    width: isMobile ? undefined : "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 6,
                    background: active ? "var(--bg-selected)" : "none",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(event) => {
                    if (!active) {
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
                  <span>{t(labelKey)}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ChatConfig />
          </div>
          <div style={{ display: activeTab === "display" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <DisplayConfig />
          </div>
        </div>
      </section>
    </div>
  );
}
