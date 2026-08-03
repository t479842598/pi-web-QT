"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Gear,
  List,
  Minus,
  Moon,
  SidebarSimple,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useElectronWindow } from "@/hooks/useElectronWindow";
import { useI18n } from "@/hooks/useI18n";

interface AppTitleBarProps {
  topBarRef: React.RefObject<HTMLDivElement | null>;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  isDark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  showChat: boolean;
  rightPanelOpen: boolean;
  onToggleFilePanel: () => void;
  onOpenSettings: () => void;
  sessionTitle: string | null;
  onWorkspaceControlsHostChange?: (node: HTMLDivElement | null) => void;
  /** Extra top-bar buttons (language, auto-name, etc.) rendered in the showChat slot. */
  children?: React.ReactNode;
}

/** Renders a placeholder icon until mounted, then the correct theme icon.
 *  Avoids SSR hydration mismatch caused by the server always defaulting
 *  to dark mode while the client inline script restores a stored preference. */
function ThemeToggleButton({
  isDark,
  toggleTheme,
  translate,
}: {
  isDark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  translate: (key: string) => string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const title = mounted
    ? (isDark ? translate("desktop.switchToLight") : translate("desktop.switchToDark"))
    : translate("desktop.switchToLight"); // SSR default: dark mode

  return (
    <button
      className="app-no-drag"
      suppressHydrationWarning
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      title={title}
      aria-label={title}
      aria-pressed={mounted ? isDark : true}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, padding: 0,
        background: "none", border: "none",
        color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      {mounted
        ? (isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />)
        : <Sun size={16} aria-hidden="true" />
      }
    </button>
  );
}

export function AppTitleBar({
  topBarRef,
  sidebarOpen,
  onSidebarToggle,
  isDark,
  toggleTheme,
  showChat,
  rightPanelOpen,
  onToggleFilePanel,
  onOpenSettings,
  sessionTitle,
  onWorkspaceControlsHostChange,
  children,
}: AppTitleBarProps) {
  const { isElectron, isMaximized, minimize, toggleMaximize, close } = useElectronWindow();
  const { t: translate } = useI18n();

  return (
    <>
      {/* Full-width app title bar — drag region for frameless Electron */}
      <div
        ref={topBarRef}
        className="app-title-bar"
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          height: 36,
          background: "var(--bg-panel)",
          position: "relative",
          zIndex: 600,
        }}
        onDoubleClick={(e) => {
          // Double-click title bar to toggle maximize (only in Electron)
          if (!isElectron) return;
          const target = e.target as HTMLElement;
          if (target.closest("button, a, input, select, textarea")) return;
          toggleMaximize();
        }}
      >
        {/* Sidebar toggle */}
        <button
          className="app-no-drag"
          onClick={onSidebarToggle}
          title={sidebarOpen ? translate("desktop.hideSidebar") : translate("desktop.showSidebar")}
          aria-label={sidebarOpen ? translate("desktop.hideSidebar") : translate("desktop.showSidebar")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: sidebarOpen ? "var(--bg-selected)" : "none", border: "none",
            color: sidebarOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = sidebarOpen ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = sidebarOpen ? "var(--text)" : "var(--text-muted)"; }}
        >
          {sidebarOpen ? <SidebarSimple size={16} aria-hidden="true" /> : <List size={16} aria-hidden="true" />}
        </button>

        <div
          className="app-no-drag"
          ref={onWorkspaceControlsHostChange}
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "min(52vw, 560px)",
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 8px 0 0",
            overflow: "visible",
          }}
        />

        {showChat && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", flex: 1, minWidth: 0, overflow: "visible" }}>
            {children}
          </div>
        )}

        {/* Flexible title spacer; in Electron this is the primary drag area. */}
        <div
          className="app-title-drag"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            minWidth: 0,
            padding: "0 12px",
            userSelect: "none",
          }}
        >
          {sessionTitle && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sessionTitle}
            </span>
          )}
        </div>



        {/* File panel toggle */}
        <button
          className="app-no-drag"
          onClick={onToggleFilePanel}
          title={rightPanelOpen ? translate("desktop.hideFilePanel") : translate("desktop.showFilePanel")}
          aria-label={rightPanelOpen ? translate("desktop.hideFilePanel") : translate("desktop.showFilePanel")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: rightPanelOpen ? "var(--bg-selected)" : "none", border: "none",
            color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = rightPanelOpen ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
        >
          <SidebarSimple size={16} aria-hidden="true" style={{ transform: "scaleX(-1)" }} />
        </button>

        {/* Theme toggle — defer render until client mount to avoid
            SSR hydration mismatch on icon and attributes. */}
        <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} translate={translate} />

        {/* Settings */}
        <button
          className="app-no-drag"
          type="button"
          onClick={onOpenSettings}
          title={translate("desktop.settings")}
          aria-label={translate("desktop.settings")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <Gear size={16} aria-hidden="true" />
        </button>

        {/* Window controls (Electron only) */}
        {isElectron && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", flexShrink: 0 }}>
            <button
              className="app-no-drag"
              onClick={minimize}
              title={translate("desktop.minimize")}
              aria-label={translate("desktop.minimize")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              className="app-no-drag"
              onClick={toggleMaximize}
              title={isMaximized ? translate("desktop.restore") : translate("desktop.maximize")}
              aria-label={isMaximized ? translate("desktop.restore") : translate("desktop.maximize")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              {isMaximized ? <Copy size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
            </button>
            <button
              className="app-no-drag"
              onClick={close}
              title={translate("desktop.close")}
              aria-label={translate("desktop.close")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#e81123"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

    </>
  );
}
