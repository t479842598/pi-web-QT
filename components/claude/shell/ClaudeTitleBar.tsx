"use client";

/**
 * Claude shell — title bar.
 *
 * Same prop contract as AppTitleBar (the slot derives it from the pi
 * implementation), so the registry can swap one for the other with no call-site
 * change. Only the chrome and the button order differ:
 *
 *   left   sidebar toggle (placement "sidebar") . workspace host
 *   centre session title . branch-chip host
 *   right  panels (task board, file panel) | appearance (kit, theme) |
 *          session actions (refresh, server switch), plus the sidebar toggle
 *          when the placement is "titlebar".
 *
 * Drag behaviour is not re-invented: the bar spreads the same
 * desktopChrome.dragRegionProps / windowDrag it receives and every control
 * keeps app-no-drag. Every aria-label and title string is the pi one, verbatim.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  Check,
  Copy,
  List,
  Moon,
  PlugsConnected,
  SidebarSimple,
  SquaresFour,
  Sun,
} from "@phosphor-icons/react";

import type { ComponentProps } from "react";
import type { AppTitleBar } from "@/components/AppTitleBar";
import { DynamicIsland } from "@/components/desktop";
import { DesktopServerHint } from "@/components/DesktopServerHint";
import { UiKitSwitch } from "@/components/UiKitSwitch";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useI18n } from "@/hooks/useI18n";
import { useSidebarTogglePlacement } from "./useSidebarTogglePlacement";

type ClaudeTitleBarProps = ComponentProps<typeof AppTitleBar>;
type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";

const ICON_SIZE = 15;

/** CDS icon button: 28px box, 8px radius, ghost fill on hover. */
function IconButton({ label, onClick, active = false, children }: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"app-no-drag claude-icon-button" + (active ? " is-active" : "")}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
    >
      {children}
    </button>
  );
}

/**
 * Theme toggle. Deferred to the client: the server always renders the dark
 * default, so an unguarded icon would disagree with the restored preference at
 * hydration time.
 */
function ThemeToggleButton({ isDark, toggleTheme, translate }: {
  isDark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  translate: (key: string) => string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const title = mounted
    ? (isDark ? translate("desktop.switchToLight") : translate("desktop.switchToDark"))
    : translate("desktop.switchToLight");

  return (
    <button
      type="button"
      className="app-no-drag claude-icon-button"
      suppressHydrationWarning
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      title={title}
      aria-label={title}
      aria-pressed={mounted ? isDark : true}
    >
      {mounted && !isDark ? <Moon size={ICON_SIZE} aria-hidden="true" /> : <Sun size={ICON_SIZE} aria-hidden="true" />}
    </button>
  );
}

function InfoRow({ label, value, copy }: { label: string; value: string; copy?: ReactNode }) {
  return (
    <>
      <span className="claude-info-label">{label}</span>
      <span className="claude-info-value">{value}</span>
      <span className="claude-info-action">{copy}</span>
    </>
  );
}

function CopyButton({ label, copied, onClick }: { label: string; copied: boolean; onClick: () => void }) {
  return (
    <button type="button" className="claude-copy-button" title={label} aria-label={label} onClick={onClick}>
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </button>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(0) + "k";
  return String(n);
}

export function ClaudeTitleBar({
  topBarRef,
  sidebarOpen,
  onSidebarToggle,
  isDark,
  toggleTheme,
  isMobile,
  showTasks,
  tasksBoardEnabled,
  onToggleTasks,
  systemPrompt,
  activeTopPanel,
  topPanelPos,
  sessionStats,
  selectedSession,
  contextUsage,
  copiedSessionField,
  onCopySessionField,
  rightPanelOpen,
  onToggleFilePanel,
  onRefreshSession,
  sessionTitle,
  onWorkspaceControlsHostChange,
  onTitleRightHostChange,
  desktopChrome,
  windowDrag,
}: ClaudeTitleBarProps) {
  const { t: translate } = useI18n();
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [desktopShell, setDesktopShell] = useState(false);
  const sidebarTogglePlacement = useSidebarTogglePlacement();

  useEscapeKey(titleModalOpen, () => setTitleModalOpen(false));

  useEffect(() => {
    try {
      setDesktopShell(new URLSearchParams(window.location.search).has("piweb_connected"));
    } catch {
      setDesktopShell(false);
    }
  }, []);

  const sidebarLabel = sidebarOpen ? translate("desktop.hideSidebar") : translate("desktop.showSidebar");
  const sidebarToggle = (
    <IconButton label={sidebarLabel} onClick={onSidebarToggle}>
      {sidebarOpen ? <SidebarSimple size={ICON_SIZE} aria-hidden="true" /> : <List size={ICON_SIZE} aria-hidden="true" />}
    </IconButton>
  );

  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;
  const copyTitleKey: Record<SessionCopyField, string> = {
    file: "desktop.copyFilePath",
    id: "desktop.copySessionId",
    projectDir: "desktop.copyProjectDir",
    gitBranch: "desktop.copyGitBranch",
    gitWorktree: "desktop.copyGitWorktree",
  };
  const copyFor = (field: SessionCopyField, value: string) => (
    <CopyButton
      label={copiedSessionField === field ? translate("desktop.copied") : translate(copyTitleKey[field])}
      copied={copiedSessionField === field}
      onClick={() => onCopySessionField(field, value)}
    />
  );

  return (
    <>
      {desktopShell && <DesktopServerHint />}
      <div
        ref={topBarRef}
        className="app-title-bar claude-title-bar"
        {...desktopChrome?.dragRegionProps}
        {...windowDrag}
      >
        <div className="claude-title-bar-zone claude-title-bar-left">
          {/* Placement "sidebar" keeps the control in the panel. A collapsed
              panel has no width, so the bar carries the reopen affordance —
              top-left, where a collapse control is expected to return. */}
          {sidebarTogglePlacement === "sidebar" && !sidebarOpen && sidebarToggle}
          <div className="app-no-drag claude-workspace-host" ref={onWorkspaceControlsHostChange} />
        </div>

        <div className="app-title-drag claude-title-bar-zone claude-title-bar-center">
          {sessionTitle && (
            <button
              type="button"
              className="app-no-drag claude-session-title"
              onClick={() => { if (isMobile) setTitleModalOpen(true); }}
              title={sessionTitle}
            >
              {sessionTitle}
            </button>
          )}
          <div className="app-no-drag claude-title-right-host" ref={onTitleRightHostChange} />
        </div>

        <div className="claude-title-bar-zone claude-title-bar-right">
          {tasksBoardEnabled && !isMobile && (
            <IconButton
              label={showTasks ? translate("desktop.hideTaskBoard") : translate("desktop.showTaskBoard")}
              onClick={onToggleTasks}
              active={showTasks}
            >
              <SquaresFour size={ICON_SIZE} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={rightPanelOpen ? translate("desktop.hideFilePanel") : translate("desktop.showFilePanel")}
            onClick={onToggleFilePanel}
            active={rightPanelOpen}
          >
            <SidebarSimple size={ICON_SIZE} aria-hidden="true" style={{ transform: "scaleX(-1)" }} />
          </IconButton>

          <span className="claude-title-bar-seam" aria-hidden="true" />

          {!isMobile && <UiKitSwitch />}
          <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} translate={translate} />

          <span className="claude-title-bar-seam" aria-hidden="true" />

          {desktopShell && (
            <IconButton
              label={translate("desktop.serverSwitch")}
              onClick={() => { window.location.href = "piweb-switch://manage"; }}
            >
              <PlugsConnected size={ICON_SIZE} aria-hidden="true" />
            </IconButton>
          )}
          {!desktopShell && !isMobile && (
            <IconButton label={translate("desktop.refreshSession")} onClick={onRefreshSession}>
              <ArrowClockwise size={ICON_SIZE} aria-hidden="true" />
            </IconButton>
          )}
          {sidebarTogglePlacement === "titlebar" && sidebarToggle}
        </div>
      </div>

      <DynamicIsland onRefreshSession={onRefreshSession} />

      {activeTopPanel && topPanelPos && (
        <div
          className="claude-top-panel"
          style={{ top: topPanelPos.top, left: topPanelPos.left, width: topPanelPos.width }}
        >
          {activeTopPanel === "system" && (
            <div className="claude-top-panel-surface">
              {systemPrompt === null || systemPrompt === undefined ? (
                <div className="claude-top-panel-empty">{translate("desktop.sendMessageForSessionInfo")}</div>
              ) : systemPrompt === "" ? (
                <div className="claude-top-panel-empty">System prompt is empty (tools are disabled)</div>
              ) : (
                <div className="claude-top-panel-system">{systemPrompt}</div>
              )}
            </div>
          )}
          {activeTopPanel === "session" && (
            <div className="claude-top-panel-surface">
              {!sessionStats ? (
                <div className="claude-top-panel-empty">{translate("desktop.sendMessageForSessionInfo")}</div>
              ) : (
                <div className="claude-info-grid">
                  <section className="claude-info-section">
                    <h3 className="claude-info-heading">{translate("desktop.sessionInfoTitle")}</h3>
                    <div className="claude-info-rows">
                      {sessionStats.sessionName && (
                        <InfoRow label={translate("desktop.name")} value={sessionStats.sessionName} />
                      )}
                      <InfoRow
                        label={translate("desktop.sessionInfoFile")}
                        value={sessionStats.sessionFile ?? translate("desktop.sessionInfoInMemory")}
                        copy={sessionStats.sessionFile ? copyFor("file", sessionStats.sessionFile) : null}
                      />
                      <InfoRow
                        label={translate("desktop.sessionInfoId")}
                        value={sessionStats.sessionId}
                        copy={copyFor("id", sessionStats.sessionId)}
                      />
                    </div>
                    {selectedSession && (
                      <>
                        <h3 className="claude-info-heading">{translate("desktop.projectSection")}</h3>
                        <div className="claude-info-rows">
                          <InfoRow
                            label={translate("desktop.projectDir")}
                            value={selectedSession.projectRoot ?? selectedSession.cwd}
                            copy={copyFor("projectDir", selectedSession.projectRoot ?? selectedSession.cwd)}
                          />
                          {selectedSession.branch && (
                            <InfoRow
                              label={translate("desktop.gitBranch")}
                              value={selectedSession.branch}
                              copy={copyFor("gitBranch", selectedSession.branch)}
                            />
                          )}
                          {selectedSession.isWorktree && (
                            <InfoRow
                              label={translate("desktop.gitWorktree")}
                              value={selectedSession.cwd}
                              copy={copyFor("gitWorktree", selectedSession.cwd)}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </section>

                  <section className="claude-info-section">
                    <h3 className="claude-info-heading">{translate("desktop.sessionInfoMessages")}</h3>
                    <div className="claude-info-rows is-compact">
                      <InfoRow label={translate("desktop.sessionInfoUser")} value={sessionStats.userMessages.toLocaleString()} />
                      <InfoRow label={translate("desktop.sessionInfoAssistant")} value={sessionStats.assistantMessages.toLocaleString()} />
                      <InfoRow label={translate("desktop.sessionInfoToolCalls")} value={sessionStats.toolCalls.toLocaleString()} />
                      <InfoRow label={translate("desktop.sessionInfoToolResults")} value={sessionStats.toolResults.toLocaleString()} />
                      <InfoRow label={translate("desktop.sessionInfoTotal")} value={sessionStats.totalMessages.toLocaleString()} />
                    </div>
                  </section>

                  <section className="claude-info-section">
                    <h3 className="claude-info-heading">{translate("desktop.sessionInfoTokens")}</h3>
                    <div className="claude-info-rows is-compact is-right">
                      <InfoRow label={translate("desktop.sessionInfoInput")} value={sessionStats.tokens.input.toLocaleString()} />
                      <InfoRow label={translate("desktop.sessionInfoOutput")} value={sessionStats.tokens.output.toLocaleString()} />
                      {sessionStats.tokens.cacheRead > 0 && (
                        <InfoRow label={translate("desktop.sessionInfoCacheRead")} value={sessionStats.tokens.cacheRead.toLocaleString()} />
                      )}
                      {sessionStats.tokens.cacheWrite > 0 && (
                        <InfoRow label={translate("desktop.sessionInfoCacheWrite")} value={sessionStats.tokens.cacheWrite.toLocaleString()} />
                      )}
                      <InfoRow label={translate("desktop.sessionInfoTotal")} value={sessionStats.tokens.total.toLocaleString()} />
                      {sessionStats.cost > 0 && (
                        <InfoRow label={translate("desktop.sessionInfoCost")} value={"$" + sessionStats.cost.toFixed(4)} />
                      )}
                      {ctx && ctx.contextWindow ? (
                        <InfoRow
                          label={translate("desktop.sessionInfoContext")}
                          value={(ctx.percent !== null ? ctx.percent.toFixed(1) + "%" : "?") + " / " + formatCompact(ctx.contextWindow)}
                        />
                      ) : null}
                    </div>
                  </section>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {titleModalOpen && sessionTitle && (
        <div className="app-no-drag claude-title-modal-veil" onClick={() => setTitleModalOpen(false)}>
          <div
            role="dialog"
            aria-label={sessionTitle}
            className="claude-title-modal"
            onClick={(event) => event.stopPropagation()}
          >
            {sessionTitle}
            <button
              type="button"
              aria-label={translate("i18n.close")}
              title={translate("i18n.close")}
              className="claude-title-modal-close"
              onClick={(event) => { event.stopPropagation(); setTitleModalOpen(false); }}
            >
              <span aria-hidden="true">{"\u2715"}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}