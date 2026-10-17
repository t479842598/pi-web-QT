"use client";

/**
 * Claude shell — sidebar.
 *
 * The session tree, drag/rename/delete, the context menu and the @-mention
 * wiring all stay in the pi SessionSidebar: this component is the frame around
 * it, and it deliberately renders the pi component rather than a copy, so the
 * two kits can never disagree about behaviour.
 *
 * What the frame owns:
 *   - the CDS collapse rail, shown only when the toggle placement is "sidebar"
 *     (the title bar renders the same control when the placement is "titlebar");
 *   - a CDS utility footer with settings / plugins / task board, which replaces
 *     the pi footer inside this subtree (the pi one is hidden by CSS, never
 *     removed from its own markup);
 *   - a hairline seam and surface-1 fill for the whole column.
 *
 * The tree itself is restyled by the appended Claude layer in
 * app/settings-claude.css, which can only reach class-hooked nodes: pi renders
 * its header and search box with inline styles, so those keep their pi
 * geometry inside the Claude frame until they gain class hooks.
 *
 * The collapse button keeps the pi aria-labels verbatim ("Show sidebar" /
 * "Hide sidebar"); a shell may look different, it may not read differently.
 */

import type { ComponentProps, ReactNode } from "react";
import { Gear, Plug, SquaresFour } from "@phosphor-icons/react";

import { SessionSidebar } from "@/components/SessionSidebar";
import packageInfo from "@/package.json";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSidebarTogglePlacement } from "./useSidebarTogglePlacement";

/**
 * The slot passes exactly the pi props. The two extras are optional so this
 * component stays assignable to ComponentProps<typeof SessionSidebar>: the
 * collapse control lives in the shell, which is the only layer that knows
 * whether the sidebar is open.
 */
export type ClaudeSidebarProps = ComponentProps<typeof SessionSidebar> & {
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
};

function RailButton({ label, onClick, disabled = false, children }: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="claude-sidebar-rail-button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function ClaudeSidebar(props: ClaudeSidebarProps) {
  const {
    sidebarOpen = true,
    onSidebarToggle,
    selectedCwd,
    onOpenSettings,
    onToggleTasks,
    showTasks = false,
    tasksBoardEnabled = false,
    ...piProps
  } = props;
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const placement = useSidebarTogglePlacement();

  const collapseLabel = sidebarOpen ? t("desktop.hideSidebar") : t("desktop.showSidebar");

  return (
    <div className="claude-sidebar" data-claude-shell="sidebar">
      {placement === "sidebar" && onSidebarToggle && (
        <div className="claude-sidebar-rail">
          <button
            type="button"
            className="claude-sidebar-rail-button is-collapse"
            onClick={onSidebarToggle}
            title={collapseLabel}
            aria-label={collapseLabel}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <line x1="9" y1="4" x2="9" y2="20" />
            </svg>
          </button>
        </div>
      )}

      <div className="claude-sidebar-body">
        <SessionSidebar {...piProps} selectedCwd={selectedCwd} />
      </div>

      {onOpenSettings && (
        <footer className="claude-sidebar-footer" aria-label={t("desktop.settings")}>
          <div className="claude-sidebar-footer-actions">
            <RailButton label={t("desktop.settings")} onClick={() => onOpenSettings()}>
              <Gear size={15} aria-hidden="true" />
            </RailButton>
            <RailButton
              label={t("desktop.plugins")}
              onClick={() => onOpenSettings("plugins")}
              disabled={!selectedCwd}
            >
              <Plug size={15} aria-hidden="true" />
            </RailButton>
            {tasksBoardEnabled && !isMobile && onToggleTasks && (
              <RailButton
                label={showTasks ? t("desktop.hideTaskBoard") : t("desktop.showTaskBoard")}
                onClick={onToggleTasks}
              >
                <SquaresFour size={15} aria-hidden="true" />
              </RailButton>
            )}
          </div>
          <span className="claude-sidebar-version">{"v" + packageInfo.version}</span>
        </footer>
      )}
    </div>
  );
}