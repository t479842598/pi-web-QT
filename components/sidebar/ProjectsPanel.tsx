"use client";
import { cancelSessionTitleRequest, generateSessionTitleRequest } from "@/lib/session-title-client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
// ZCode uses the lucide icon set; mirror its sidebar icon choices exactly.
import {
  Archive, ArchiveRestore, ArrowLeft, Check, ChevronRight, CirclePlus, Clock, Ellipsis,
  Folder, FolderClosed, FolderOpen, FolderPlus, Hash, LayoutList, ListFilter, ListTree, Maximize2,
  Minimize2, Plus, Search, Sparkles, Trash2, X,
} from "lucide-react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import {
  buildArchived, buildProjectGroups, buildSessionGroups, buildTimeline, filterVisibleSessions,
  loadCollapsedProjects, loadTaskPreferences, saveCollapsedProjects, saveTaskPreferences,
  PROJECT_PAGE_SIZE,
  type OrganizeBy, type ProjectGroup, type SortBy,
} from "@/lib/sidebar-projects-view";
import { formatRelativeTime, RunningSessionIndicator, UnreadSessionIndicator } from "./session-indicators";

export interface HiddenProjectEntry {
  key: string;
  path: string;
  name: string;
}

interface Props {
  sessions: SessionInfo[];
  loading: boolean;
  runningIds: Set<string>;
  unreadIds: Set<string>;
  /** projectRoot → display alias. */
  aliases: Record<string, string>;
  selectedSessionId: string | null;
  selectedProjectRoot: string | null;
  /** Live search value — on desktop the input lives in the title bar portal;
   *  on mobile the panel renders its own row below. */
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSelectSession: (s: SessionInfo) => void;
  onNewSessionInProject: (projectRoot: string) => void;
  onArchive: (session: SessionInfo, archived: boolean) => void;
  onDeleteForever: (session: SessionInfo) => void;
  /** Remove (hide) a project from the panel. Confirmation already handled. */
  onRemoveProject: (projectRoot: string, name: string) => void;
  hiddenProjects: HiddenProjectEntry[];
  onUnhideProject: (entry: HiddenProjectEntry) => void;
  onPickFolder: () => void;
  /** Cycle button in panel form → back to the dropdown 列表 form (keeps the
   *  button at the same top-left position across all three sidebar forms). */
  onCycleToList: () => void;
  /** Refresh after a session's title was (re)generated. */
  onRenamed: () => void;
  /** 新建任务 — on mobile the panel renders its own search row + button,
   *  because the title-bar strip (desktop) is too narrow there. */
  onNewTask: () => void;
  /** SessionSidebar-owned FileExplorer render for a project root. */
  renderFileTree: (cwd: string) => ReactNode;
  isMobile: boolean;
}

// ZCode-style icon buttons: background matches the sidebar (transparent),
// icon uses the body text color; hover only brightens the glyph, never swaps
// the background. The active (open-menu) state keeps a subtle pill.
const iconButtonStyle = (active: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, padding: 0,
  background: active ? "var(--bg-selected)" : "transparent",
  border: "none", borderRadius: 5, flexShrink: 0,
  color: active ? "var(--accent)" : "var(--text-muted)",
  cursor: "pointer",
  transition: "color 0.12s, background 0.12s",
});

export function ProjectsPanel({
  sessions, loading, runningIds, unreadIds, aliases,
  selectedSessionId, selectedProjectRoot,
  searchQuery, onSearchQueryChange,
  onSelectSession, onNewSessionInProject, onArchive, onDeleteForever,
  onRemoveProject, hiddenProjects, onUnhideProject,
  onPickFolder, onCycleToList, onRenamed, onNewTask, renderFileTree, isMobile,
}: Props) {
  const { t } = useI18n();

  const [prefs, setPrefs] = useState(() => loadTaskPreferences());
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => loadCollapsedProjects());
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [fileTreeProject, setFileTreeProject] = useState<{ root: string; name: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuProjectKey, setMenuProjectKey] = useState<string | null>(null);
  // Hover is React state (not imperative style) so the folder actions' opacity
  // has a single source of truth: closing the ⋯ menu via a second click while
  // still hovering must not blank the buttons out.
  const [hoveredProjectKey, setHoveredProjectKey] = useState<string | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  // Default row style for the time-based views (grouped / timeline): ZCode
  // two-line rows (title / folder + time). The project view overrides to
  // "compact" single-line rows — see renderProjectGroup.
  const rowStyle = "detailed" as const;
  const filterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Day-boundary refresh for Today/Yesterday/ Older partitions.
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTimeTick((v) => v + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const updatePrefs = useCallback((patch: Partial<{ organizeBy: OrganizeBy; sortBy: SortBy }>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveTaskPreferences(next);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback((projectKey: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  const hiddenKeys = useMemo(() => new Set(hiddenProjects.map((h) => h.key)), [hiddenProjects]);

  const groups = useMemo(() => buildProjectGroups({
    sessions,
    hiddenKeys,
    aliases,
    sortBy: prefs.sortBy,
    collapsedKeys,
    runningIds,
    unreadIds,
    search: searchQuery,
    extraRoots: selectedProjectRoot ? [selectedProjectRoot] : [],
  // timeTick: day rollover changes nothing here, but keeps memo deps aligned with grouped view.
  }), [sessions, hiddenKeys, aliases, prefs.sortBy, collapsedKeys, runningIds, unreadIds, searchQuery, selectedProjectRoot]);

  const timeline = useMemo(() => buildTimeline({
    sessions, hiddenKeys, sortBy: prefs.sortBy, search: searchQuery,
  }), [sessions, hiddenKeys, prefs.sortBy, searchQuery]);

  const grouped = useMemo(() => buildSessionGroups(
    filterVisibleSessions(sessions, { hiddenKeys, search: searchQuery }),
    sessions,
    prefs.sortBy,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sessions, hiddenKeys, searchQuery, prefs.sortBy, timeTick]);

  const archived = useMemo(() => buildArchived({ sessions, hiddenKeys, search: searchQuery }),
    [sessions, hiddenKeys, searchQuery]);

  // Outside-click dismissal for the two popovers. The folder ⋯ trigger is
  // deliberately excluded: its own onClick toggles the menu, and counting it
  // as an outside click would close-then-reopen it on every second click.
  useEffect(() => {
    if (!filterOpen && !menuProjectKey) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (filterOpen && !filterRef.current?.contains(target)) setFilterOpen(false);
      if (menuProjectKey && !menuRef.current?.contains(target) && !(target instanceof Element && target.closest("[data-menu-trigger]"))) setMenuProjectKey(null);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [filterOpen, menuProjectKey]);

  const handleExpandAll = useCallback(() => {
    // Two-state: if anything is collapsed → expand all; otherwise collapse all.
    if (collapsedKeys.size > 0) {
      const empty = new Set<string>();
      setCollapsedKeys(empty);
      saveCollapsedProjects(empty);
    } else {
      const all = new Set(groups.map((g) => g.projectKey));
      setCollapsedKeys(all);
      saveCollapsedProjects(all);
    }
  }, [collapsedKeys, groups]);

  const bubbleStyle = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 3,
    height: 22, padding: "0 7px",
    background: active ? "var(--bg-selected)" : "none",
    border: "none", borderRadius: 11,
    color: active ? "var(--text)" : "var(--text-dim)",
    fontSize: 11.5, fontWeight: active ? 600 : 400,
    cursor: "pointer", whiteSpace: "nowrap",
    transition: "color 0.12s, background 0.12s",
  });

  const setBubble = (which: "grouped" | "project") => {
    setArchivedOpen(false);
    setFileTreeProject(null);
    updatePrefs({ organizeBy: which === "grouped" ? "grouped" : (prefs.organizeBy === "timeline" ? "timeline" : "project") });
  };

  const visibleCountFor = (projectKey: string) => visibleCounts[projectKey] ?? PROJECT_PAGE_SIZE;

  // ─── Row renderers ────────────────────────────────────────────────────────

  const folderNameFor = (session: SessionInfo): string => {
    const root = session.projectRoot ?? session.cwd ?? "";
    return aliases[root]?.trim() || root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || root || "?";
  };

  const renderSessionRow = (session: SessionInfo, indent = false, style: "detailed" | "compact" = rowStyle) => (
    <PanelSessionRow
      key={session.id}
      session={session}
      isSelected={session.id === selectedSessionId}
      isRunning={runningIds.has(session.id)}
      isUnread={unreadIds.has(session.id)}
      indent={indent}
      forceActionsVisible={isMobile}
      rowStyle={style}
      folderName={folderNameFor(session)}
      onSelect={() => onSelectSession(session)}
      onArchive={() => onArchive(session, true)}
      onRenamed={onRenamed}
    />
  );

  const renderProjectGroup = (group: ProjectGroup) => {
    const limit = visibleCountFor(group.projectKey);
    const shown = group.sessions.slice(0, limit);
    const remaining = group.sessions.length - shown.length;
    return (
      <div key={group.projectKey}>
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => setHoveredProjectKey(group.projectKey)}
          onMouseLeave={() => setHoveredProjectKey((k) => (k === group.projectKey ? null : k))}
        >
          <div
            onClick={() => toggleCollapsed(group.projectKey)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              height: 34, paddingLeft: 8, paddingRight: 66,
              cursor: "pointer", color: "var(--text)",
              borderRadius: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            <ChevronRight size={10} style={{ transform: group.collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s", flexShrink: 0, color: "var(--text-dim)" }} aria-hidden="true" />
            {group.collapsed && group.hasRunning ? (
              <RunningSessionIndicator />
            ) : group.collapsed ? (
              <FolderClosed size={14} style={{ flexShrink: 0, color: "var(--text-dim)" }} aria-hidden="true" />
            ) : (
              <FolderOpen size={14} style={{ flexShrink: 0, color: "var(--text-dim)" }} aria-hidden="true" />
            )}
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 500 }} title={group.projectRoot}>
              {group.name}
            </span>
            {group.collapsed && group.hasUnread && !group.hasRunning && <UnreadSessionIndicator />}
            <div
              data-folder-actions
              style={{
                position: "absolute", right: 6, top: 4, display: "flex", gap: 2,
                opacity: isMobile || menuProjectKey === group.projectKey || hoveredProjectKey === group.projectKey ? 1 : 0,
                transition: "opacity 0.12s",
              }}
            >
              <button
                data-menu-trigger
                onClick={(e) => { e.stopPropagation(); setMenuProjectKey(menuProjectKey === group.projectKey ? null : group.projectKey); }}
                title={t("desktop.moreActions")}
                aria-label={t("desktop.moreActions")}
                style={{ ...iconButtonStyle(menuProjectKey === group.projectKey), width: 24, height: 24 }}
              >
                <Ellipsis size={14} aria-hidden="true" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setFileTreeProject({ root: group.projectRoot, name: group.name }); }}
                title={t("desktop.viewFiles")}
                aria-label={t("desktop.viewFiles")}
                style={{ ...iconButtonStyle(false), width: 24, height: 24 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <ListTree size={14} aria-hidden="true" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onNewSessionInProject(group.projectRoot); }}
                title={t("desktop.newSessionHere")}
                aria-label={t("desktop.newSessionHere")}
                style={{ ...iconButtonStyle(false), width: 24, height: 24 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <CirclePlus size={14} aria-hidden="true" />
              </button>
            </div>
            {menuProjectKey === group.projectKey && (
              <div
                ref={menuRef}
                style={{
                  position: "absolute", right: 6, top: 30, zIndex: 30,
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
                  padding: 4, minWidth: 120,
                }}
              >
                <button
                  onClick={() => {
                    setMenuProjectKey(null);
                    const hasRunning = group.hasRunning || sessions.some((s) => (s.projectRoot ?? s.cwd) === group.projectRoot && runningIds.has(s.id) && !s.archived);
                    if (hasRunning && !window.confirm(t("desktop.removeProjectRunningConfirm"))) return;
                    onRemoveProject(group.projectRoot, group.name);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%",
                    padding: "6px 10px", background: "none", border: "none",
                    borderRadius: 6, color: "var(--text)", fontSize: 12, cursor: "pointer", textAlign: "left",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <X size={12} style={{ color: "var(--text-dim)" }} aria-hidden="true" />
                  {t("desktop.removeProject")}
                </button>
              </div>
            )}
          </div>
        </div>
        {!group.collapsed && (
          <div>
            {/* Project view rows are single-line (title + time): the project is
                already the group header, so repeating its name under every
                session is redundant (ZCode parity, user-confirmed 2026-08-31).
                Grouped/timeline views keep the two-line detailed style since
                they have no per-project header. */}
            {shown.map((s) => renderSessionRow(s, true, "compact"))}
            {remaining > 0 && (
              <button
                onClick={() => setVisibleCounts((prev) => ({ ...prev, [group.projectKey]: visibleCountFor(group.projectKey) + PROJECT_PAGE_SIZE }))}
                style={{
                  display: "block", width: "100%", padding: "5px 8px 5px 42px",
                  background: "none", border: "none", borderRadius: 6,
                  color: "var(--text-dim)", fontSize: 11, cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                {t("desktop.showMore")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderArchivedRow = (session: SessionInfo) => (
    <PanelArchivedRow
      key={session.id}
      session={session}
      folderName={aliases[session.projectRoot ?? session.cwd]?.trim()
        || (session.projectRoot ?? session.cwd ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop()
        || session.projectRoot || session.cwd || "?"}
      onUnarchive={() => onArchive(session, false)}
      onDeleteForever={() => {
        if (window.confirm(t("desktop.deleteArchivedConfirm"))) onDeleteForever(session);
      }}
    />
  );

  // ─── Body ────────────────────────────────────────────────────────────────

  const body = (() => {
    if (fileTreeProject) {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", flexShrink: 0 }}>
            <button
              onClick={() => setFileTreeProject(null)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", background: "none", border: "none", borderRadius: 6, color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              <ArrowLeft size={11} aria-hidden="true" />
              {t("desktop.backToSessions")}
            </button>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--text-dim)" }} title={fileTreeProject.root}>
              {fileTreeProject.name}
            </span>
          </div>
          <div className="scroll-overlay" style={{ flex: 1, minHeight: 0, overflowX: "hidden" }}>
            {renderFileTree(fileTreeProject.root)}
          </div>
        </div>
      );
    }

    if (archivedOpen) {
      return (
        <div style={{ padding: "0 4px" }}>
          {archived.length === 0 && (
            <div style={{ padding: "16px 10px", color: "var(--text-muted)", fontSize: 12 }}>
              {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noArchivedSessions")}
            </div>
          )}
          {archived.map(renderArchivedRow)}
        </div>
      );
    }

    if (prefs.organizeBy === "project") {
      return (
        <div style={{ padding: "0 4px" }}>
          <div style={{ padding: "6px 8px 2px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "0.04em" }}>
            {t("desktop.projectSectionHeader")}
          </div>
          {groups.length === 0 && !loading && (
            <div style={{ padding: "16px 10px", color: "var(--text-muted)", fontSize: 12 }}>
              {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noProjects")}
            </div>
          )}
          {groups.map(renderProjectGroup)}
        </div>
      );
    }

    if (prefs.organizeBy === "timeline") {
      return (
        <div style={{ padding: "0 4px" }}>
          {timeline.length === 0 && !loading && (
            <div style={{ padding: "16px 10px", color: "var(--text-muted)", fontSize: 12 }}>
              {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noSessionsFound")}
            </div>
          )}
          {timeline.map((s) => renderSessionRow(s))}
        </div>
      );
    }

    // grouped: time accordion across all projects
    return (
      <div style={{ padding: "0 4px" }}>
        {grouped.length === 0 && !loading && (
          <div style={{ padding: "16px 10px", color: "var(--text-muted)", fontSize: 12 }}>
            {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noSessionsFound")}
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.key}>
            <div style={{ padding: "8px 8px 2px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "0.04em" }}>
              {t(group.key === "pinned" ? "desktop.pinned" : group.key === "today" ? "desktop.today" : group.key === "yesterday" ? "desktop.yesterday" : "desktop.older")}
            </div>
            {group.rows.map((row) => renderSessionRow(row.session, row.forkDepth > 0))}
          </div>
        ))}
      </div>
    );
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
      {/* Panel top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 6px", flexShrink: 0 }}>
        {/* Panel's own view bubbles (分组/项目); the sidebar-form cycle button
            lives in the dropdown-mode header. */}
        <div style={{ display: "flex", alignItems: "center", gap: 1, background: "var(--bg-hover)", borderRadius: 12, padding: 2 }}>
          <button style={bubbleStyle(prefs.organizeBy === "grouped")} onClick={() => setBubble("grouped")} aria-pressed={prefs.organizeBy === "grouped"}>
            <Hash size={11} style={{ opacity: 0.7 }} aria-hidden="true" />
            {t("desktop.panelGroupBubble")}
          </button>
          <button style={bubbleStyle(prefs.organizeBy !== "grouped")} onClick={() => setBubble("project")} aria-pressed={prefs.organizeBy !== "grouped"}>
            <Folder size={11} aria-hidden="true" />
            {t("desktop.panelProjectBubble")}
          </button>
        </div>
        <button
          onClick={handleExpandAll}
          title={collapsedKeys.size > 0 ? t("desktop.expandAllFolders") : t("desktop.collapseAllFolders")}
          aria-label={collapsedKeys.size > 0 ? t("desktop.expandAllFolders") : t("desktop.collapseAllFolders")}
          style={{ ...iconButtonStyle(false), marginLeft: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          {collapsedKeys.size > 0
            ? <Maximize2 size={13} aria-hidden="true" />
            : <Minimize2 size={13} aria-hidden="true" />}
        </button>
        {/* Cycle button (icon-only, fixed slot right of expand-all): panel → 列表 form. */}
        <button
          onClick={onCycleToList}
          title={`${t("desktop.sidebarModeCycle")}：${t("desktop.sessionViewList")}`}
          aria-label={t("desktop.sidebarModeCycle")}
          style={{ ...iconButtonStyle(false), marginLeft: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <LayoutList size={13} aria-hidden="true" />
        </button>
        <div style={{ flex: 1 }} />
        <div ref={filterRef} style={{ position: "relative" }}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            title={t("desktop.filterMenu")}
            aria-label={t("desktop.filterMenu")}
            aria-expanded={filterOpen}
            style={iconButtonStyle(filterOpen)}
            onMouseEnter={(e) => { if (!filterOpen) { e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { if (!filterOpen) { e.currentTarget.style.color = "var(--text-muted)"; } }}
          >
            <ListFilter size={13} aria-hidden="true" />
          </button>
          {filterOpen && (
            <div
              style={{
                position: "absolute", right: 0, top: 28, zIndex: 40, width: 168,
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", padding: 5,
              }}
            >
              <div style={{ padding: "6px 8px 2px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>{t("desktop.viewSection")}</div>
              {([["project", "desktop.viewByProject", Folder], ["timeline", "desktop.viewTimeline", Clock]] as const).map(([value, labelKey, Icon]) => (
                <button
                  key={value}
                  onClick={() => { updatePrefs({ organizeBy: value }); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 7px", background: "none", border: "none", borderRadius: 6, color: "var(--text)", fontSize: 11.5, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <Icon size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ flex: 1 }}>{t(labelKey)}</span>
                  {prefs.organizeBy === value && <Check size={13} strokeWidth={2.5} style={{ color: "var(--accent)" }} aria-hidden="true" />}
                </button>
              ))}
              <div style={{ height: 1, background: "var(--border)", margin: "6px 4px" }} />
              <div style={{ padding: "2px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>{t("desktop.sortSection")}</div>
              {([["updated", "desktop.sortUpdated"], ["created", "desktop.sortCreated"]] as const).map(([value, labelKey]) => (
                <button
                  key={value}
                  onClick={() => { updatePrefs({ sortBy: value as SortBy }); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 7px", background: "none", border: "none", borderRadius: 6, color: "var(--text)", fontSize: 11.5, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <span style={{ flex: 1 }}>{t(labelKey)}</span>
                  {prefs.sortBy === value && <Check size={13} strokeWidth={2.5} style={{ color: "var(--accent)" }} aria-hidden="true" />}
                </button>
              ))}
              <div style={{ height: 1, background: "var(--border)", margin: "6px 4px" }} />
              <div style={{ padding: "2px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>{t("desktop.hiddenProjectsSection")}</div>
              {hiddenProjects.length === 0 ? (
                <div style={{ padding: "4px 8px 8px", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.noHiddenProjects")}</div>
              ) : hiddenProjects.map((h) => (
                <button
                  key={h.key}
                  onClick={() => { setFilterOpen(false); onUnhideProject(h); }}
                  title={h.path}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", background: "none", border: "none", borderRadius: 6, color: "var(--text)", fontSize: 12, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <Folder size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name || h.path}</span>
                  <span style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>{t("desktop.restoreProject")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setArchivedOpen((v) => !v); setFileTreeProject(null); }}
          title={t("desktop.archivedView")}
          aria-label={t("desktop.archivedView")}
          aria-pressed={archivedOpen}
          style={iconButtonStyle(archivedOpen)}
          onMouseEnter={(e) => { if (!archivedOpen) { e.currentTarget.style.color = "var(--text)"; } }}
          onMouseLeave={(e) => { if (!archivedOpen) { e.currentTarget.style.color = "var(--text-muted)"; } }}
        >
          {archivedOpen
            ? <X size={13} aria-hidden="true" />
            : <Archive size={13} aria-hidden="true" />}
        </button>
        <button
          onClick={onPickFolder}
          title={t("desktop.selectFolder")}
          aria-label={t("desktop.selectFolder")}
          style={{ ...iconButtonStyle(false), marginRight: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <FolderPlus size={13} aria-hidden="true" />
        </button>
      </div>

      {/* Mobile: the title-bar search/new-task strip is desktop-only, so the
          panel carries its own compact row here. */}
      {isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px 6px", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, background: "var(--bg-hover)", borderRadius: 8, padding: "0 9px", height: 30 }}>
            <Search size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder={archivedOpen ? t("desktop.searchArchived") : t("desktop.searchSessions")}
              aria-label={archivedOpen ? t("desktop.searchArchived") : t("desktop.searchSessions")}
              style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)" }}
            />
            {searchQuery && (
              <button
                onClick={() => onSearchQueryChange("")}
                aria-label={t("i18n.close")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 4, flexShrink: 0 }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            onClick={onNewTask}
            title={t("desktop.newTask")}
            aria-label={t("desktop.newTask")}
            style={{
              display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
              height: 30, padding: "0 10px",
              background: "var(--bg-selected)", border: "1px solid var(--border)", borderRadius: 5,
              color: "var(--text)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer",
            }}
          >
            <Plus size={13} aria-hidden="true" />
            {t("desktop.newTask")}
          </button>
        </div>
      )}

      {loading && sessions.length === 0 && (
        <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>{t("desktop.loading")}</div>
      )}
      <div className="scroll-overlay" style={{ flex: "1 1 0", minHeight: 0 }}>
        {body}
      </div>
    </div>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

function PanelSessionRow({
  session, isSelected, isRunning, isUnread, indent, forceActionsVisible, rowStyle, folderName, onSelect, onArchive, onRenamed,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning: boolean;
  isUnread: boolean;
  indent: boolean;
  forceActionsVisible: boolean;
  rowStyle: "detailed" | "compact";
  folderName: string;
  onSelect: () => void;
  onArchive: () => void;
  onRenamed: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [autoNaming, setAutoNaming] = useState(false);
  const [autoNameError, setAutoNameError] = useState<string | null>(null);
  const autoNameControllerRef = useRef<AbortController | null>(null);
  const title = session.name || session.firstMessage?.slice(0, 50) || session.id;
  const hasMessages = session.messageCount > 0;

  // 生成标题 — calls the model via the auto-name endpoint, which uses the
  // title-generation model configured in 设置 → 模型 → 标题生成模型.
  const handleAutoName = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (autoNaming) {
      autoNameControllerRef.current?.abort();
      void cancelSessionTitleRequest(session.id);
      return;
    }
    if (!hasMessages) return;
    const controller = new AbortController();
    autoNameControllerRef.current = controller;
    setAutoNaming(true);
    setAutoNameError(null);
    try {
      await generateSessionTitleRequest(session.id, controller.signal);
      onRenamed();
    } catch (err) {
      if (!controller.signal.aborted) setAutoNameError(err instanceof Error ? err.message : String(err));
    } finally {
      if (autoNameControllerRef.current === controller) autoNameControllerRef.current = null;
      setAutoNaming(false);
    }
  }, [autoNaming, hasMessages, session.id, onRenamed]);

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: 30, paddingLeft: indent ? 42 : 10, paddingRight: 6, background: "rgba(239,68,68,0.06)", borderRadius: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("desktop.archiveSessionConfirm", { title: `“${title.slice(0, 18)}${title.length > 18 ? "…" : ""}”` })}
        </span>
        <button
          onClick={() => { setConfirming(false); onArchive(); }}
          style={{ display: "flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <Archive size={11} aria-hidden="true" />
          {t("desktop.archiveSession")}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
          style={{ height: 24, padding: "0 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {t("desktop.cancel")}
        </button>
      </div>
    );
  }

  const actions = (
    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
      <button
        onClick={handleAutoName}
        disabled={!hasMessages}
        title={autoNameError ?? (!hasMessages ? t("desktop.titleNeedsMessages") : autoNaming ? t("desktop.generatingTitle") : t("desktop.generateTitle"))}
        aria-label={t("desktop.generateTitle")}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: autoNameError ? "#ef4444" : "var(--text-dim)", cursor: !hasMessages ? "default" : "pointer", flexShrink: 0, opacity: autoNaming ? 0.7 : !hasMessages ? 0.35 : 1, transition: "color 0.12s" }}
        onMouseEnter={(e) => { if (!autoNaming && hasMessages) e.currentTarget.style.color = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = autoNameError ? "#ef4444" : "var(--text-dim)"; }}
      >
        {autoNaming ? (
          <svg style={{ animation: "spin 1s linear infinite" }} width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <Sparkles size={13} aria-hidden="true" />
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
        title={t("desktop.archiveSession")}
        aria-label={t("desktop.archiveSession")}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
      >
        <Archive size={13} aria-hidden="true" />
      </button>
    </div>
  );

  const showActions = hovered || forceActionsVisible;
  const indicator = isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: `${rowStyle === "detailed" ? 5 : 0}px 6px ${rowStyle === "detailed" ? 5 : 0}px ${indent ? 42 : 18}px`,
        height: rowStyle === "detailed" ? 46 : 30,
        display: "flex", flexDirection: "column", justifyContent: "center",
        cursor: "pointer", borderRadius: 6,
        background: isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
      }}
      title={title}
    >
      {/* Indented (project-panel) rows: status indicator absolutely positioned
          into the folder-icon column (left ≈ chevron+gap+icon offset) so it
          lines up with the folder row's icon/spinner. The title text starts at
          the project-title column (4+2+42 = 48px = chevron+folder+gaps), which
          also leaves a 6px gap between the 14px indicator and the text.
          Non-indented rows (timeline / grouped top level) have no folder
          column, so the indicator renders inline before the title instead —
          an absolute gutter there would overlap the 18px-padded text. */}
      {indicator && indent && (
        <span style={{ position: "absolute", left: 22, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
          {indicator}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {indicator && !indent && indicator}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text)", fontWeight: isSelected ? 500 : 400 }}>
          {title}
        </span>
        {showActions ? actions : (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
            {formatRelativeTime(session.modified, t)}
          </span>
        )}
      </div>
      {rowStyle === "detailed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--text-dim)" }} title={session.projectRoot ?? session.cwd}>
            {folderName}
          </span>
          {showActions && (
            <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
              {formatRelativeTime(session.modified, t)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PanelArchivedRow({ session, folderName, onUnarchive, onDeleteForever }: {
  session: SessionInfo;
  folderName: string;
  onUnarchive: () => void;
  onDeleteForever: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const title = session.name || session.firstMessage?.slice(0, 50) || session.id;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: "6px 10px", borderRadius: 6, background: hovered ? "var(--bg-hover)" : "transparent" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text)" }} title={title}>{title}</span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>{formatRelativeTime(session.archivedAt ?? session.modified, t)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <Folder size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--text-dim)" }} title={session.projectRoot ?? session.cwd}>{folderName}</span>
        <button
          onClick={onUnarchive}
          title={t("desktop.unarchiveSession")}
          aria-label={t("desktop.unarchiveSession")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <ArchiveRestore size={13} aria-hidden="true" />
        </button>
        <button
          onClick={onDeleteForever}
          title={t("desktop.deleteForever")}
          aria-label={t("desktop.deleteForever")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, background: "none", border: "none", borderRadius: 4, color: "#ef4444", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#ef4444"; }}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
