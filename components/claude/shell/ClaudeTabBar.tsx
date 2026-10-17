"use client";

/**
 * Claude shell — file tab strip.
 *
 * Same props and the same keyboard/overflow behaviour as TabBar (roving
 * tabindex, Home/End/arrow keys, middle-click close, overflow mask), so the
 * strip is not a regression in reachability. Only the skin and the close
 * affordance change: pills instead of rectangles, the selected pill filled with
 * the CDS secondary fill and no accent underline, and the close button appears
 * on hover/focus only (the pi strip keeps it visible on the active tab).
 *
 * The overflow mask is a CSS mask on the container; it reads a solid colour
 * because masks care about alpha, not palette.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Robot } from "@phosphor-icons/react/Robot";
import { X } from "@phosphor-icons/react";

import type { TabBar } from "@/components/TabBar";
import { getFileIcon } from "@/components/FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { ComponentProps } from "react";

type ClaudeTabBarProps = ComponentProps<typeof TabBar>;

export function ClaudeTabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: ClaudeTabBarProps) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!activeTabId) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[data-tab-id=\"" + CSS.escape(activeTabId) + "\"]");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setOverflows(list.scrollWidth > list.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tabs.length]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTab(id);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === id);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onSelectTab(tabs[next].id);
    listRef.current?.querySelector<HTMLElement>("[data-tab-id=\"" + CSS.escape(tabs[next].id) + "\"]")?.focus();
  }, [onSelectTab, tabs]);

  const tabLabel = (tab: ClaudeTabBarProps["tabs"][number]) => (
    tab.kind === "terminal"
      ? t("terminal.tabLabel", { name: tab.label })
      : tab.kind === "subagent"
        ? t("subagent.transcriptTitle") + ": " + tab.label
        : tab.label
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      className={"claude-tab-bar" + (overflows ? "" : " is-flush")}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            data-tab-id={tab.id}
            aria-label={tabLabel(tab)}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            className="claude-tab"
            onKeyDown={(event) => handleKeyDown(event, tab.id)}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(event) => {
              // Prevent the middle-click autoscroll default on the tab itself.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
          >
            <span className="claude-tab-icon">
              {tab.kind === "subagent" ? (
                <Robot size={12} aria-hidden="true" />
              ) : tab.kind === "terminal" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : getFileIcon(tab.label, 12)}
            </span>
            <span className="claude-tab-label" title={tab.filePath}>{tab.label}</span>
            <button
              type="button"
              className="claude-tab-close"
              disabled={tab.closing}
              onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}
              title={t("desktop.closeTab")}
              aria-label={t("desktop.closeTabWithLabel", { label: tab.label })}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
