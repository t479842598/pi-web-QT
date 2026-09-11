"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { Robot } from "@phosphor-icons/react/Robot";
import { useI18n } from "@/hooks/useI18n";
import { getFileIcon } from "./FileIcons";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal" | "subagent";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: "diff";
  /** Subagent run shown by a `kind: "subagent"` tab. */
  sessionId?: string;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  // Keep the selected tab visible when tabs are opened from elsewhere (a file
  // click in the explorer, a keyboard arrow, restoring a persisted strip).
  useEffect(() => {
    if (!activeTabId) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  // Track overflow so the edge fade is only applied when it is meaningful.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setOverflows(list.scrollWidth > list.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tabs.length]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, tab: Tab) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTab(tab.id);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === tab.id);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onSelectTab(tabs[next].id);
    const list = listRef.current;
    list?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabs[next].id)}"]`)?.focus();
  }, [onSelectTab, tabs]);

  return (
    <div
      ref={listRef}
      role="tablist"
      className={`file-tab-bar${overflows ? "" : " no-overflow"}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            data-tab-id={tab.id}
            aria-label={tab.kind === "terminal"
              ? t("terminal.tabLabel", { name: tab.label })
              : tab.kind === "subagent"
                ? t("subagent.transcriptTitle") + ": " + tab.label
                : tab.label}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            className="file-tab"
            onKeyDown={(event) => handleKeyDown(event, tab)}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              // Prevent the middle-click autoscroll default on the tab itself.
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              // Middle-click closes the tab.
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
          >
            <span className="file-tab-icon">
              {tab.kind === "subagent" ? (
                <Robot size={13} aria-hidden="true" />
              ) : tab.kind === "terminal" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : getFileIcon(tab.label, 13)}
            </span>
            <span className="file-tab-label" title={tab.filePath}>{tab.label}</span>
            <button
              type="button"
              className="file-tab-close"
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              title={t("desktop.closeTab")}
              aria-label={t("desktop.closeTabWithLabel", { label: tab.label })}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
