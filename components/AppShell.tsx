"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ArrowLeft, CaretLeft } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { SubagentsPanel } from "./SubagentsPanel";
import { SubagentDetail } from "./SubagentDetail";
import { TabBar, type Tab } from "./TabBar";
import { SettingsModal, type SettingsTab } from "./SettingsModal";
import { TasksViewProvider } from "@/contexts/tasks-view-context";
import { TasksBoard, TasksBoardTitle } from "./tasks/tasks-board";
import { OPEN_TASKS_VIEW_EVENT } from "./ChatWindow";
import { AppTitleBar } from "./AppTitleBar";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { samePath } from "@/lib/paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import type { SessionInfo, SubagentStatus } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { stripModeInstructionBlocks } from "@/lib/modes";

type SessionCopyField = "file" | "id";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Recomputes when the URL changes so SPA navigation between projects
  // (?session=... <-> ?cwd=...) is honored instead of only the initial mount.
  const initialNavigation = useMemo(() => getInitialNavigation(searchParams), [searchParams]);
  const { isDark, toggleTheme } = useTheme();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("models");
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const [titleWorkspaceControlsHost, setTitleWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);
  const [titleRightWorkspaceControlsHost, setTitleRightWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);
  const [welcomeWorkspaceControlsHost, setWelcomeWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);

  // Subagent fleet monitor — populated by ChatWindow, displayed in sidebar
  const [subagents, setSubagents] = useState<SubagentStatus[]>([]);
  const handleSubagentsChange = useCallback((list: SubagentStatus[]) => {
    setSubagents(list);
  }, []);
  const runningSubagentCount = subagents.filter((s) => s.status === "running").length;
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);


  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Right panel "subagent view": opened via the running bubble; shows the fleet
  // list, clicking a row drills into the read-only conversation detail.
  const [subagentViewOpen, setSubagentViewOpen] = useState(false);
  const [subagentViewAgentId, setSubagentViewAgentId] = useState<string | null>(null);
  const openSubagentView = useCallback((agentId?: string | null) => {
    setSubagentViewAgentId(agentId ?? null);
    setSubagentViewOpen(true);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  const closeSubagentView = useCallback(() => {
    setSubagentViewOpen(false);
    setSubagentViewAgentId(null);
  }, []);
  // Fullscreen subagent page: replaces the main chat area (input hidden) with
  // the subagent's running conversation; "Back" restores the main dialogue.
  const [subagentPageAgentId, setSubagentPageAgentId] = useState<string | null>(null);
  const openSubagentPage = useCallback((agentId: string) => setSubagentPageAgentId(agentId), []);
  const closeSubagentPage = useCallback(() => setSubagentPageAgentId(null), []);

  // While the fullscreen subagent overlay is open, Esc must close the overlay
  // — NOT abort the main agent (the global Esc handler in useKeyboardShortcuts
  // would otherwise stop the run underneath the overlay). Capture-phase
  // listener stops the event before it reaches the bubble listener.
  useEffect(() => {
    if (!subagentPageAgentId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        setSubagentPageAgentId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [subagentPageAgentId]);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(getDefaultRightPanelWidth(1366));
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined" ? getDefaultRightPanelWidth(1366) : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined" ? SIDEBAR_MAX_WIDTH : getSidebarMaxWidth({
      viewportWidth: window.innerWidth,
      rightPanelOpen,
      rightPanelWidth: rightPanelWidthRef.current,
    }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined" ? RIGHT_PANEL_MAX_WIDTH : getRightPanelMaxWidth({
      viewportWidth: window.innerWidth,
      sidebarOpen,
      sidebarWidth: sidebarWidthRef.current,
    }),
    [sidebarOpen],
  );
  const sidebarPanel = useResizablePanel({
    ariaLabel: t("desktop.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanel = useResizablePanel({
    ariaLabel: t("desktop.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: getDefaultRightPanelWidth(1366),
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarPanel.reclampWidth;
  const reclampRightPanelWidth = rightPanel.reclampWidth;
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const [initialSessionId, setInitialSessionId] = useState<string | null>(() => initialNavigation.sessionId);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Per-project last-open session memory: switching project tabs keeps each
  // tab's open session and restores it when switching back, instead of
  // landing on a blank new-session state.
  const lastSessionByProjectRef = useRef(new Map<string, string>());
  const [pendingRestore, setPendingRestore] = useState<{ projectRoot: string; sessionId: string } | null>(null);

  // Re-apply URL navigation when it changes after mount (SPA route between
  // projects: ?session=<a> -> ?cwd=<b> or another ?session=). Without this the
  // app would keep showing the previous project until a full page reload.
  const appliedNavigationKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${initialNavigation.requestedCwd ?? ""}|${initialNavigation.sessionId ?? ""}`;
    if (appliedNavigationKeyRef.current === key) return;
    appliedNavigationKeyRef.current = key;

    // Reset the session-restore gate so the sidebar re-resolves the new URL.
    setInitialSessionId(initialNavigation.sessionId);
    setInitialSessionRestored(!initialNavigation.sessionId);
    if (!initialNavigation.requestedCwd) setInitialCwdStatus("idle");
    setInitialCwdError(null);
  }, [initialNavigation]);

  // Validate and adopt a cwd requested via ?cwd= URL parameter, opening a new
  // session in that directory instead of restoring a ?session=.
  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    // A null cwd (initial mount / transient prop gap during session creation)
    // must never clobber the effective workspace, otherwise the tab title and
    // the sidebar session list lose the current project until a refresh.
    if (!cwd) return;
    setActiveCwd(cwd);
    // Consume the restore-echo suppression ONLY for the onCwdChange that a
    // session restore produces (same project as the restored session). A real
    // cross-project switch must never be swallowed by a stale flag (e.g. the
    // flag set by a restore whose cwd echo never arrived because the sidebar
    // cwd already matched — otherwise the switch would keep the old project's
    // session and URL).
    if (suppressCwdBumpRef.current && selectedSession && samePath(selectedSession.projectRoot ?? selectedSession.cwd, projectRoot ?? cwd)) {
      suppressCwdBumpRef.current = false;
      if (selectedSession) {
        const leaving = selectedSession.projectRoot ?? selectedSession.cwd;
        if (leaving) lastSessionByProjectRef.current.set(leaving, selectedSession.id);
      }
      return;
    }
    suppressCwdBumpRef.current = false;
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    const newProject = projectRoot ?? cwd;
    if (selectedSession && samePath(selectedSession.projectRoot ?? selectedSession.cwd, newProject)) {
      const current = selectedSession.projectRoot ?? selectedSession.cwd;
      if (current) lastSessionByProjectRef.current.set(newProject, selectedSession.id);
      return;
    }
    // Remember the session that was open in the project we are leaving, so
    // switching back to this tab restores it instead of a blank new-session
    // state (project tabs are expected to keep their open session).
    if (selectedSession) {
      const leavingProject = selectedSession.projectRoot ?? selectedSession.cwd;
      if (leavingProject) lastSessionByProjectRef.current.set(leavingProject, selectedSession.id);
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    // The previous URL pointed at a session of the old project — clear it so a
    // reload cannot jump back across projects.
    window.history.replaceState(null, "", "/");
    // Restore the session this tab had open last time (if any).
    const lastId = lastSessionByProjectRef.current.get(newProject);
    setPendingRestore(lastId ? { projectRoot: newProject, sessionId: lastId } : null);
  }, [selectedSession]);

  // Update browser tab title when workspace changes
  useEffect(() => {
    const name = activeCwd ? getFileName(activeCwd) || activeCwd : null;
    document.title = name ? `${name} — Pi Agent Web` : "Pi Agent Web";
  }, [activeCwd]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    if (!isRestore) setPendingRestore(null);
    if (!isRestore && selectedSession) {
      const sameProject = samePath(
        selectedSession.projectRoot ?? selectedSession.cwd,
        session.projectRoot ?? session.cwd,
      );
      if (selectedSession.id === session.id && sameProject) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    // Remember the session under its project root so a later project-tab
    // switch can restore it.
    const sessionProject = session.projectRoot ?? session.cwd;
    if (sessionProject) lastSessionByProjectRef.current.set(sessionProject, session.id);
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip the address-bar update when restoring from URL — the param is
    // already correct. Use history.replaceState (not router.replace): the
    // router call triggers a Suspense remount loop in production, which reset
    // the whole UI and lost the workspace.
    if (!isRestore) {
      window.history.replaceState(null, "", `?session=${encodeURIComponent(session.id)}`);
    }
  }, [isMobile, selectedSession]);

  // Restore the remembered session of the project just switched to (runs after
  // handleCwdChange cleared the selection). Cancelled by any explicit user
  // navigation: a new session select / new session / further cwd change.
  //
  // The restore itself is synchronous with a minimal session record: ChatWindow
  // loads the real content by id and the sidebar resolves the project root from
  // its own session list, so no network round-trip can delay or cancel it.
  // handleSelectSession is reached through a ref so a rebuild of that callback
  // (it depends on selectedSession) can never interfere.
  const handleSelectSessionRef = useRef<(session: SessionInfo, isRestore?: boolean) => void>(() => {});
  useEffect(() => { handleSelectSessionRef.current = handleSelectSession; }, [handleSelectSession]);

  // Client-built transient SessionInfo (new session / fork / tab restore) lacks
  // the server-computed projectRoot and/or name. Hydrate it from the session
  // list so the title shows the real name and worktree switching works.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) =>
          // 补全：新建/恢复时的最小记录缺 projectRoot 或缺 name
          prev && prev.id === sessionId && (!prev.projectRoot || !prev.name) ? full : prev
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pendingRestore) return;
    const { projectRoot, sessionId } = pendingRestore;
    handleSelectSessionRef.current({
      path: "",
      id: sessionId,
      cwd: projectRoot,
      created: "",
      modified: "",
      messageCount: 0,
      firstMessage: "",
      projectRoot,
    }, true);
    // 异步补全真实会话名（标题不应显示 id 片段）
    hydrateSelectedSession(sessionId);
    // handleCwdChange just cleared the address bar; point it back at the
    // restored session so a reload stays in this project.
    window.history.replaceState(null, "", `?session=${encodeURIComponent(sessionId)}`);
    setPendingRestore(null);
  }, [pendingRestore, hydrateSelectedSession]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setPendingRestore(null);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    window.history.replaceState(null, "", "/");
  }, [router, isMobile]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setPendingRestore(null);
    const sessionProject = session.projectRoot ?? session.cwd;
    if (sessionProject) lastSessionByProjectRef.current.set(sessionProject, session.id);
    setSelectedSession(session);
    // Keep the effective workspace in sync with the session's project. Without
    // this, switching to a brand-new project (no sessions yet) and sending the
    // first message left activeCwd null — the sidebar list went empty and the
    // tab title lost the project name until a refresh.
    if (session.cwd) setActiveCwd(session.cwd);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    // Update the address bar without going through Next.js router: router.replace
    // on this route triggers a Suspense remount loop in production (see the
    // comment in handleSelectSession), which reset the whole UI and lost the
    // workspace — the sidebar list went empty and the tab title reset until a
    // full page reload. history.replaceState is a pure address-bar update.
    window.history.replaceState(null, "", `?session=${encodeURIComponent(session.id)}`);
    // The session file is written by startRpcSession BEFORE the API response
    // (persistSessionFileIfMissing), so a refresh immediately finds it. Keep
    // two delayed retries for filesystems/cache layers where the scan lags
    // (e.g. antivirus, network mounts) so the sidebar never shows the old list
    // (or "no sessions") until the next agent_end refresh.
    window.setTimeout(() => setRefreshKey((k) => k + 1), 1200);
    window.setTimeout(() => setRefreshKey((k) => k + 1), 4000);
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setPendingRestore(null);
    setSelectedSession((prev) => {
      const fork: SessionInfo = {
        ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
        id: newSessionId,
      };
      const forkProject = fork.projectRoot ?? fork.cwd;
      if (forkProject) lastSessionByProjectRef.current.set(forkProject, newSessionId);
      return fork;
    });
    hydrateSelectedSession(newSessionId);
    window.history.replaceState(null, "", `?session=${encodeURIComponent(newSessionId)}`);
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      window.history.replaceState(null, "", "/");
    }
  }, [router, selectedSession]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceOrOptions?: string | null | { initialDisplayMode?: "diff" }, options?: { initialDisplayMode?: "diff" }) => {
    const sourceSessionId = typeof sourceOrOptions === "string" || sourceOrOptions === null ? sourceOrOptions : undefined;
    const openOptions = typeof sourceOrOptions === "object" && sourceOrOptions !== null ? sourceOrOptions : options;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId, initialDisplayMode: openOptions?.initialDisplayMode }];
      if ((!sourceSessionId || existing.sourceSessionId === sourceSessionId) && (!openOptions?.initialDisplayMode || existing.initialDisplayMode === openOptions.initialDisplayMode)) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId: sourceSessionId ?? t.sourceSessionId, initialDisplayMode: openOptions?.initialDisplayMode ?? t.initialDisplayMode } : t);
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const sessionTitle = selectedSession
    // 恢复的最小 SessionInfo 没有 name：回退到 ChatWindow 加载后回传的真实标题
    ? stripModeInstructionBlocks(selectedSession.name || sessionStats?.sessionName) ||
      selectedSession.firstMessage.slice(0, 50) ||
      selectedSession.id.slice(0, 12)
    : (() => {
        // No session selected (fresh project / right after switching a tab):
        // show the current project's name in the title instead.
        const cwd = activeCwd ?? newSessionCwd;
        if (!cwd) return null;
        const base = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop();
        return base || cwd;
      })();

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in.
  // While a ?cwd= URL parameter is still validating (or failed), keep the chat area hidden so
  // the validating/error panels render instead of a default workspace.
  const initialCwdPending = initialCwdStatus === "validating" || initialCwdStatus === "error";
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = !initialCwdPending && (selectedSession !== null || effectiveNewSessionCwd !== null);

  // The fullscreen subagent overlay targets a fleet row that belongs to the
  // current session. Switching sessions (or leaving the chat view entirely)
  // empties that fleet; leaving the overlay open would pin it to a stale
  // "ended" agent forever.
  const overlaySessionId = selectedSession?.id;
  useEffect(() => {
    if (!subagentPageAgentId) return;
    setSubagentPageAgentId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlaySessionId, showChat]);

  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;

  // Task board view toggle (desktop only — the button is hidden on mobile).
  const [showTasks, setShowTasks] = useState(false);
  const handleToggleTasks = useCallback(() => {
    if (isMobile) return;
    setShowTasks((v) => !v);
  }, [isMobile]);

  // Feature toggles: whether the Tasks board is enabled at all. When off, the
  // toolbar button is hidden and the board view is force-closed. Reloads when
  // the settings "Features" tab broadcasts FEATURES_CHANGED_EVENT so toggling
  // there takes effect in real time without a page refresh.
  const [tasksBoardEnabled, setTasksBoardEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch("/api/features")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.tasksBoard === "boolean") {
          setTasksBoardEnabled(data.tasksBoard);
          if (!data.tasksBoard) setShowTasks(false);
        }
      })
      .catch(() => {});
    load();
    const onFeaturesChanged = () => load();
    window.addEventListener("pi:features-changed", onFeaturesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("pi:features-changed", onFeaturesChanged);
    };
  }, []);
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  // "Task from message": AppShell opens the board view when the event fires
  // (ChatWindow parks the draft in the compose buffer first).
  useEffect(() => {
    const open = () => {
      if (isMobile) return;
      setShowTasks(true);
    };
    window.addEventListener(OPEN_TASKS_VIEW_EVENT, open);
    return () => window.removeEventListener(OPEN_TASKS_VIEW_EVENT, open);
  }, [isMobile]);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const settingsCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        selectedSessionStats={sessionStats}
        onOpenSettings={(tab) => {
          const supported: SettingsTab[] = ["models", "skills", "plugins", "chat", "features", "logs"];
          openSettings(supported.includes(tab as SettingsTab) ? tab as SettingsTab : "models");
        }}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        workspaceControlsHosts={{
          title: titleWorkspaceControlsHost,
          welcome: welcomeWorkspaceControlsHost,
          titleRight: titleRightWorkspaceControlsHost,
        }}
        // Workspace controls (title bar + welcome page) are always shown,
        // including before a project is active, so new users can pick a
        // project from the top-left corner instead of a sidebar-only button.
        showWorkspaceControls={true}
      />

    </>
  );

  return (
    <TasksViewProvider>
    <style>{`
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      <AppTitleBar
        topBarRef={topBarRef}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={handleSidebarToggle}
        isDark={isDark}
        toggleTheme={toggleTheme}
        isMobile={isMobile}
        showTasks={showTasks}
        tasksBoardEnabled={tasksBoardEnabled}
        onToggleTasks={handleToggleTasks}
        systemPrompt={systemPrompt}
        activeTopPanel={activeTopPanel}
        topPanelPos={topPanelPos}
        sessionStats={sessionStats}
        contextUsage={contextUsage}
        copiedSessionField={copiedSessionField}
        onCopySessionField={handleCopySessionField}
        rightPanelOpen={rightPanelOpen}
        onToggleFilePanel={() => setRightPanelOpen((v) => !v)}
        onOpenSettings={() => openSettings("models")}
        sessionTitle={sessionTitle}
        onWorkspaceControlsHostChange={setTitleWorkspaceControlsHost}
        onTitleRightHostChange={setTitleRightWorkspaceControlsHost}
      />
      {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
        <button
          type="button"
          onClick={() => {
            setProjectTrustError(null);
            setProjectTrustDialogOpen(true);
          }}
          title={t("desktop.projectResourcesRestricted")}
          aria-label={t("desktop.projectResourcesRestricted")}
          style={{
            position: "fixed",
            top: isMobile ? 48 : 48,
            right: isMobile ? 12 : 20,
            zIndex: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 11px",
            border: "1px solid color-mix(in srgb, var(--accent-orange) 52%, var(--border))",
            borderRadius: 7,
            background: "color-mix(in srgb, var(--accent-orange) 11%, var(--bg-panel))",
            color: "var(--accent-orange)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true">⚠</span>
          {t("desktop.trustProject")}
        </button>
      )}
      <div
        style={{
          "--right-panel-width": `${rightPanel.width}px`,
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minWidth: 0,
          position: "relative",
        } as React.CSSProperties}
      >
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarPanel.panelRef}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarPanel.isResizing ? " panel-is-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarPanel.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarPanel.separatorProps}
          className="workspace-panel-splitter sidebar-panel-splitter"
        />
      )}

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showTasks && tasksBoardEnabled ? (
            <>
              <TasksBoardTitle />
              <TasksBoard activeProject={activeCwd ?? undefined} />
            </>
          ) : showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              tasksBoardEnabled={tasksBoardEnabled}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSubagentsChange={handleSubagentsChange}
              subagents={subagents}
              onOpenSubagent={openSubagentPage}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
              onWorkspaceControlsHostChange={setWelcomeWorkspaceControlsHost}
              onViewFullHistory={handleViewFullHistory}
              systemPrompt={systemPrompt}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--text)" }}>{t("desktop.openingWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "#dc2626" }}>{t("desktop.unableToOpenWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                {t("desktop.selectSessionFromSidebar")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <ArrowLeft size={44} color="var(--accent)" aria-hidden="true" style={{ opacity: 0.7, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("desktop.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("desktop.selectProjectDirectory")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("desktop.addModelsFromBottom")}
                  </div>
                </div>
              </div>
            )
          ) : null}

          {/* Fullscreen subagent page — rendered as an overlay so ChatWindow
              (and its live AgentSession/SSE) stays mounted underneath. */}
          {subagentPageAgentId && (() => {
            const agent = subagents.find((s) => s.id === subagentPageAgentId) ?? null;
            return (
              <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
                {agent ? (
                  <SubagentDetail
                    agent={agent}
                    cwd={activeCwd ?? selectedSession?.cwd ?? undefined}
                    onBack={closeSubagentPage}
                  />
                ) : (
                  <>
                    <div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", padding: "6px 8px" }}>
                      <button
                        type="button"
                        onClick={closeSubagentPage}
                        title={t("desktop.subagentsBack")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "3px 6px", border: "none", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
                      >
                        <CaretLeft size={12} aria-hidden="true" />
                        {t("desktop.subagentsBack")}
                      </button>
                    </div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
                      {t("desktop.subagentsNotFound")}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Subagent running bubble — top-right, appears while agents are running */}
      {runningSubagentCount > 0 && (
        <button
          type="button"
          onClick={() => openSubagentView()}
          title={t("desktop.subagentsViewTitle")}
          aria-label={t("desktop.subagentsViewTitle")}
          style={{
            position: "fixed",
            top: 46,
            right: isMobile ? 12 : rightPanelOpen && !subagentViewOpen ? `calc(${rightPanel.width}px + 16px)` : 16,
            zIndex: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 12px",
            border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 12%, var(--bg-panel))",
            color: "var(--accent)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 20%, var(--bg-panel))"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 12%, var(--bg-panel))"; }}
        >
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 0 0 var(--accent)", animation: "subagent-pulse 1.4s ease-out infinite" }} />
          {runningSubagentCount} {t("desktop.subagentsRunningBubble")}
        </button>
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      {rightPanelOpen && (
        <div
          {...rightPanel.separatorProps}
          className="workspace-panel-splitter right-panel-splitter"
        />
      )}
      <div
        ref={rightPanel.panelRef}
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanel.isResizing ? " panel-is-resizing" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          {/* Switch between file view and subagent view */}
          <button
            type="button"
            onClick={() => subagentViewOpen ? closeSubagentView() : openSubagentView()}
            title={subagentViewOpen ? t("desktop.subagentsBackToFiles") : t("desktop.subagentsViewTitle")}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, height: 28, marginRight: 6, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: subagentViewOpen ? "var(--bg-selected)" : "transparent", color: subagentViewOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
          >
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: runningSubagentCount > 0 ? "var(--accent)" : "var(--text-dim)", boxShadow: runningSubagentCount > 0 ? "0 0 0 0 var(--accent)" : "none", animation: runningSubagentCount > 0 ? "subagent-pulse 1.4s ease-out infinite" : "none" }} />
            {subagentViewOpen ? t("desktop.subagentsBackToFiles") : t("desktop.subagentsViewTitle")}
          </button>

        </div>

        {/* Content: subagent view OR file viewer */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {subagentViewOpen ? (
            subagentViewAgentId ? (() => {
              const agent = subagents.find((s) => s.id === subagentViewAgentId) ?? null;
              return agent ? (
                <SubagentDetail
                  agent={agent}
                  cwd={activeCwd ?? selectedSession?.cwd ?? undefined}
                  onBack={() => setSubagentViewAgentId(null)}
                />
              ) : (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  {t("desktop.subagentsNotFound")}
                </div>
              );
            })() : (
              <SubagentsPanel
                subagents={subagents}
                selectedId={subagentViewAgentId}
                onSelect={(agent) => setSubagentViewAgentId(agent.id)}
              />
            )
          ) : activeFileTab?.filePath ? (
            <FileViewer
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              onOpenFile={(filePath) => handleOpenFile(
                filePath,
                getFileName(filePath),
                activeFileTab.sourceSessionId,
              )}
              onAtMention={handleAtMention}
              onMentionLines={handleFileLineMention}
            />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
              No file open
            </div>
          )}
        </div>
      </div>
    </div>
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancelAction={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirmAction={() => void handleTrustProject()}
      />
    )}
    {settingsOpen && (
      <SettingsModal
        initialTab={settingsTab}
        cwd={settingsCwd}
        sessionId={selectedSession?.id ?? null}
        onCloseAction={() => {
          setSettingsOpen(false);
          setModelsRefreshKey((k) => k + 1);
        }}
        onModelsSavedAction={() => setModelsRefreshKey((k) => k + 1)}
        onSessionReloadedAction={() => setSessionKey((k) => k + 1)}
        onSessionsChanged={() => setRefreshKey((k) => k + 1)}
      />
    )}
    </div>
    </TasksViewProvider>
  );
}
