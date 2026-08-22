"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef, memo, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, CaretDown, CaretRight, Check, Cpu, DownloadSimple, FolderOpen, GitBranch, GitFork, Lightning, List, MagnifyingGlass, PencilSimple, Plug, Plus, PushPin, Sparkle, Stack, StackSimple, Trash, UploadSimple, X } from "@phosphor-icons/react";
import type { SessionInfo } from "@/lib/types";
import { sameIdSet } from "@/lib/id-set";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { QuickChangesPanel } from "./QuickChangesPanel";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { samePath } from "@/lib/paths";
import { stripModeInstructionBlocks } from "@/lib/modes";
import { showBrowserNotification } from "@/lib/browser-notifications";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string, options?: { initialDisplayMode?: "diff" }) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onFileCreated?: (filePath: string) => void;
  onFileDeleted?: (filePath: string, isDir: boolean) => void;
  /** Open the settings modal (used by the title-generation failure banner). */
  onOpenSettings?: (tab?: string) => void;
  selectedSessionStats?: SessionStatsInfo | null;
  workspaceControlsHosts?: {
    title?: HTMLElement | null;
    welcome?: HTMLElement | null;
    /** Slot beside the session title for the git-branch chip. */
    titleRight?: HTMLElement | null;
  };
  /** Hide both workspace controls on the empty welcome page. */
  showWorkspaceControls?: boolean;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function formatRelativeTime(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("desktop.justNow");
  if (mins < 60) return t("desktop.minutesAgo", { count: mins });
  if (hours < 24) return t("desktop.hoursAgo", { count: hours });
  if (days < 7) return t("desktop.daysAgo", { count: days });
  return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity. The currently selected
 * cwd and any explicitly picked project are always included — even when they
 * have no sessions yet — so a freshly picked project folder shows up in the
 * list instead of vanishing after switching away.
 */
function getRecentProjects(sessions: SessionInfo[], currentCwd?: string | null, pickedProjects: string[] = []): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  // A selected/picked project with no sessions yet must still appear, so
  // switching back to it is possible. Give it the newest timestamp so it
  // floats to top.
  const alwaysShow = new Set<string>();
  if (currentCwd) alwaysShow.add(currentCwd);
  for (const picked of pickedProjects) alwaysShow.add(picked);
  for (const project of alwaysShow) {
    if (!latestByRoot.has(project)) latestByRoot.set(project, "\uffff");
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel). */
function displayCwd(cwd: string, homeDir?: string): string {
  if (!homeDir) return cwd;
  // Windows paths are case-insensitive; compare lowercased.
  const normCwd = cwd.replace(/\\/g, "/").toLowerCase();
  const normHome = homeDir.replace(/\\/g, "/").toLowerCase();
  if (!normCwd.startsWith(normHome)) return cwd;
  const suffix = cwd.slice(homeDir.length);
  return "~" + (suffix.startsWith("/") || suffix.startsWith("\\") ? suffix : suffix);
}

function pathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** True for quick workspaces created by the default-cwd endpoint as
 *  ~/pi-cwd-<YYYYMMDD> (same shape the server uses to seed the allow-list). */
function isQuickWorkspace(cwd: string, homeDir?: string): boolean {
  if (!homeDir) return false;
  const normCwd = cwd.replace(/\\/g, "/").toLowerCase();
  const normHome = homeDir.replace(/\\/g, "/").toLowerCase();
  if (!normCwd.startsWith(normHome)) return false;
  const firstSegment = normCwd.slice(normHome.length).replace(/^\/+/, "").split("/")[0] ?? "";
  return /^pi-cwd-\d{8}$/.test(firstSegment);
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// ── Session grouped-accordion view ──────────────────────────────────────────

type SessionViewStyle = "list" | "groups";
const SESSION_VIEW_STYLE_KEY = "pi-web:session-view-style";

type GroupKey = "pinned" | "today" | "yesterday" | "older";

/** One row in a grouped session view — session plus its fork depth. */
interface SessionGroupRow {
  session: SessionInfo;
  /** Fork depth: 0 = not a fork (or flat group); 1 = direct fork of a listed session, etc. */
  forkDepth: number;
}

interface SessionGroup {
  key: GroupKey;
  rows: SessionGroupRow[];
}

const GROUP_LABEL_KEYS: Record<GroupKey, string> = {
  pinned: "desktop.pinned",
  today: "desktop.today",
  yesterday: "desktop.yesterday",
  older: "desktop.older",
};

/** Local-timezone YYYY-MM-DD key for a Date. */
function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Partition sessions into Pinned / Today / Yesterday / Older accordion groups.
 * Pinned sessions are shown BOTH in the pinned group and in their original
 * time-based group (double display).
 *
 * Within each group, fork children are ordered right below their parent
 * (depth-first), and every row carries its fork depth so the compact row can
 * indent forks the way the tree view does. The pinned group is rendered flat
 * (forkDepth forced to 0 — no indent there).
 */
function buildSessionGroups(sessions: SessionInfo[], allSessions: SessionInfo[]): SessionGroup[] {
  const now = new Date();
  const todayKey = toLocalDayKey(now);
  const yesterdayKey = toLocalDayKey(new Date(now.getTime() - 86400000));

  const groups: Record<GroupKey, SessionInfo[]> = { pinned: [], today: [], yesterday: [], older: [] };
  for (const s of sessions) {
    const day = toLocalDayKey(new Date(s.modified));
    if (s.pinned) groups.pinned.push(s);
    if (day === todayKey) groups.today.push(s);
    else if (day === yesterdayKey) groups.yesterday.push(s);
    else groups.older.push(s);
  }

  const order: GroupKey[] = ["pinned", "today", "yesterday", "older"];
  return order
    .map((key) => ({
      key,
      rows: orderGroupRows(groups[key], allSessions, key === "pinned"),
    }))
    .filter((g) => g.rows.length > 0);
}

/**
 * Order one group's sessions so fork children sit immediately below their
 * parent (depth-first, roots sorted by modified desc, children of one parent
 * sorted the same way). Computes each row's fork depth by walking the
 * parentSessionId chain in the FULL session list (parents may live in another
 * group). `flat` (pinned group) keeps the ordering but forces forkDepth to 0.
 */
function orderGroupRows(sessions: SessionInfo[], allSessions: SessionInfo[], flat: boolean): SessionGroupRow[] {
  if (sessions.length === 0) return [];
  const byId = new Map(allSessions.map((s) => [s.id, s]));

  const forkDepthOf = (session: SessionInfo): number => {
    let depth = 0;
    let cur: SessionInfo | undefined = session;
    const visited = new Set<string>();
    while (cur?.parentSessionId && !visited.has(cur.id)) {
      visited.add(cur.id);
      const parent = byId.get(cur.parentSessionId);
      if (!parent) break;
      cur = parent;
      depth++;
    }
    return depth;
  };

  // Map of in-group parent id → its fork children.
  const inGroup = new Set(sessions.map((s) => s.id));
  const children = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    if (s.parentSessionId && inGroup.has(s.parentSessionId)) {
      const arr = children.get(s.parentSessionId) ?? [];
      arr.push(s);
      children.set(s.parentSessionId, arr);
    }
  }
  const byModifiedDesc = (a: SessionInfo, b: SessionInfo) => b.modified.localeCompare(a.modified);
  const roots = sessions.filter((s) => !(s.parentSessionId && inGroup.has(s.parentSessionId))).sort(byModifiedDesc);
  for (const arr of children.values()) arr.sort(byModifiedDesc);

  const rows: SessionGroupRow[] = [];
  const emitted = new Set<string>();
  const visit = (s: SessionInfo) => {
    if (emitted.has(s.id)) return;
    emitted.add(s.id);
    rows.push({ session: s, forkDepth: flat ? 0 : forkDepthOf(s) });
    for (const child of children.get(s.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  // Safety net for cyclic parent chains — never drop a row.
  for (const s of sessions) visit(s);
  return rows;
}



export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention, onAtMentions, onFileCreated, onFileDeleted, onOpenSettings, selectedSessionStats, workspaceControlsHosts, showWorkspaceControls = true }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  // Projects the user has explicitly picked (folder picker / project list /
  // new-session). Kept separate from allSessions so a brand-new project with
  // no sessions yet still appears in the project dropdown — otherwise it would
  // vanish right after switching away, which is exactly what users hit when
  // they picked a fresh folder, started chatting, then could not find the
  // project in the list anymore.
  const [pickedProjects, setPickedProjects] = useState<string[]>([]);
  const rememberPickedProject = useCallback((cwd: string | null) => {
    if (!cwd) return;
    setPickedProjects((prev) => (prev.includes(cwd) ? prev : [...prev, cwd]));
  }, []);

  // ── Project tab bar state (desktop top bar) ──────────────────────────────
  const isMobile = useIsMobile();
  const PROJECT_TABS_KEY = "pi-project-tabs";
  // Mirrored in lib/project-tab-state.ts (server-side cap) — keep in sync.
  const MAX_PROJECT_TABS = 4;
  const [projectTabs, setProjectTabs] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(PROJECT_TABS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, MAX_PROJECT_TABS);
      }
    } catch {}
    return [];
  });
  const persistProjectTabs = useCallback((tabs: string[]) => {
    setProjectTabs(tabs);
    try { window.localStorage.setItem(PROJECT_TABS_KEY, JSON.stringify(tabs)); } catch {}
    // Cross-device sync: the server file is the shared source of truth for
    // every window/device connected to this pi-web server.
    void fetch("/api/project-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabs }),
    }).catch(() => { /* offline — localStorage keeps the local copy */ });
  }, []);

  // ── Cross-device sync of the project tab bar / dropdown pin ─────────────
  // Refs mirroring state that stable callbacks / SSE handlers must read
  // without stale closures (and without re-subscribing EventSource on change).
  const projectTabsRef = useRef<string[]>(projectTabs);
  useEffect(() => { projectTabsRef.current = projectTabs; }, [projectTabs]);
  const selectedCwdRef = useRef<string | null>(selectedCwd);
  useEffect(() => { selectedCwdRef.current = selectedCwd; }, [selectedCwd]);
  /** Dropdown pin last seen from the server (remote-change detection). */
  const serverPinnedRef = useRef<string | null>(null);

  /**
   * Fetch the server-side project state (tabs + dropdown pin) and apply it.
   * - tabs: server always wins (it is the shared source of truth).
   * - pinnedProject: applied to the dropdown pin always; the current project
   *   is switched only when the pin genuinely changed remotely (`adoptSelection`
   *   && pin differs from the last seen server pin) — a plain tab-list edit
   *   on another device must not yank this device's project, and neither may
   *   the echo of our own dropdown selection (selectProject marks the pin as
   *   seen at PUT time). `adoptFirst` is the mount-restore case: with a clean
   *   URL the first pin ever observed may set the current project, since there
   *   is no user interaction to yank yet.
   * - `pushLocal`: first sync on a server with no stored tabs migrates this
   *   device's pre-sync localStorage tabs to the server.
   */
  const syncProjectStateFromServer = useCallback(async (opts: { adoptSelection?: boolean; adoptFirst?: boolean; pushLocal?: boolean }) => {
    try {
      const res = await fetch("/api/project-state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({})) as { tabs?: string[]; pinnedProject?: string | null };
      let remoteTabs = Array.isArray(data.tabs)
        ? data.tabs.filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, MAX_PROJECT_TABS)
        : null;
      const pinned = typeof data.pinnedProject === "string" && data.pinnedProject ? data.pinnedProject : null;

      if (opts.pushLocal && remoteTabs !== null && remoteTabs.length === 0 && projectTabsRef.current.length > 0) {
        // Fresh server: publish this device's pre-sync localStorage tabs, and
        // adopt the sanitized pushed list from the PUT response — the stale
        // pre-push read ([]) must not wipe the just-pushed tabs from state.
        try {
          const putRes = await fetch("/api/project-state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabs: projectTabsRef.current }),
          });
          const putData = putRes.ok ? await putRes.json().catch(() => null) as { tabs?: string[] } | null : null;
          remoteTabs = putData && Array.isArray(putData.tabs)
            ? putData.tabs.filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, MAX_PROJECT_TABS)
            : projectTabsRef.current; // PUT failed — keep the local list
        } catch {
          remoteTabs = projectTabsRef.current;
        }
      }

      if (remoteTabs !== null) {
        setProjectTabs(remoteTabs);
        try { window.localStorage.setItem(PROJECT_TABS_KEY, JSON.stringify(remoteTabs)); } catch {}
      }
      if (pinned) {
        const seen = serverPinnedRef.current;
        const pinChanged = seen !== null && !samePath(seen, pinned);
        serverPinnedRef.current = pinned;
        setDropdownPinnedProject(pinned);
        if (opts.adoptFirst || (opts.adoptSelection && pinChanged)) {
          if (!samePath(pinned, selectedCwdRef.current ?? "")) setSelectedCwd(pinned);
        }
      }
    } catch {
      // Server unavailable — keep the local copy; the next event/refetch retries.
    }
  }, []);

  // Pull the server state once on mount: adopt the tab list always; adopt the
  // dropdown pin as the current project only when no explicit ?session= / ?cwd=
  // URL restore is in flight (so a shared link is never yanked to the pin).
  useEffect(() => {
    let adoptSelection = true;
    try {
      const params = new URLSearchParams(window.location.search);
      adoptSelection = !params.has("session") && !params.has("cwd");
    } catch { /* URL unreadable — adopt */ }
    void syncProjectStateFromServer({ adoptSelection: false, adoptFirst: adoptSelection, pushLocal: true });
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Drop persisted tabs whose directory no longer exists (e.g. a volume was
  // unmounted or the project was moved). Clicking such a tab used to surface
  // a "Directory does not exist" console error from the project-trust check.
  useEffect(() => {
    if (projectTabs.length === 0) return;
    let cancelled = false;
    const validate = async () => {
      const results = await Promise.all(projectTabs.map(async (project) => {
        try {
          const res = await fetch("/api/cwd/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cwd: project }),
          });
          if (!res.ok) return false;
          const data = await res.json().catch(() => ({})) as { cwd?: string };
          return typeof data.cwd === "string";
        } catch {
          return false;
        }
      }));
      if (cancelled) return;
      const kept = projectTabs.filter((_, i) => results[i]);
      if (kept.length !== projectTabs.length) {
        try { window.localStorage.setItem(PROJECT_TABS_KEY, JSON.stringify(kept)); } catch {}
        setProjectTabs(kept);
      }
    };
    void validate();
    return () => { cancelled = true; };
    // Run once on mount against the initial tabs (server-side state is already
    // pruned by /api/project-state, so this only covers the localStorage copy).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [workspaceProjectDropdownOpen, setWorkspaceProjectDropdownOpen] = useState<"title" | "welcome" | null>(null);
  const [workspaceWorktreeDropdownOpen, setWorkspaceWorktreeDropdownOpen] = useState<"title" | "welcome" | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Wrapper nodes of the two workspace-control portals (title bar / welcome).
  // One ref per location: it contains both dropdowns of that location, so a
  // single outside-click check covers the project and worktree menus.
  const workspaceDropdownRefs = useRef<Record<"title" | "welcome" | "titleRight", HTMLDivElement | null>>({ title: null, welcome: null, titleRight: null });
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [viewStyle, setViewStyle] = useState<SessionViewStyle>(() => {
    if (typeof window === "undefined") return "list";
    try {
      return window.localStorage.getItem(SESSION_VIEW_STYLE_KEY) === "groups" ? "groups" : "list";
    } catch {
      return "list";
    }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [groupOpen, setGroupOpen] = useState<Record<GroupKey, boolean>>({ pinned: true, today: true, yesterday: true, older: false });
  const setViewStyleAndPersist = useCallback((style: SessionViewStyle) => {
    setViewStyle(style);
    try {
      window.localStorage.setItem(SESSION_VIEW_STYLE_KEY, style);
    } catch {
      // ignore storage errors
    }
  }, []);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once a lightweight running snapshot arrives it owns the dynamic state;
  // late /api/sessions responses cannot revive an older embedded snapshot.
  const runningSnapshotAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // This is only an initial fallback. The dedicated snapshot route owns
      // running state once it has responded, so a slow list reload stays stale.
      if (!runningSnapshotAuthoritativeRef.current) {
        setRunningSessionIds((prev) => {
          const next = new Set(data.runningSessionIds ?? []);
          return sameIdSet(prev, next) ? prev : next;
        });
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Project display aliases (备注) — fetched from the server, keyed by
  // project root. Used everywhere the project name is shown; the dropdown
  // additionally shows the real folder name next to the alias.
  const [projectAliases, setProjectAliases] = useState<Record<string, string>>({});
  const loadProjectAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/project-aliases");
      if (!res.ok) return;
      const data = await res.json() as { aliases?: Record<string, string> };
      setProjectAliases(data.aliases ?? {});
    } catch {
      // Aliases are display-only; a failed load degrades to folder names.
    }
  }, []);
  useEffect(() => {
    void loadProjectAliases();
  }, [loadProjectAliases, refreshKey]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active || document.visibilityState !== "visible") return;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      try {
        const response = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: currentController.signal,
        });
        if (!response.ok || !active || controller !== currentController) return;
        const data = await response.json() as { runningSessionIds?: string[]; sessions?: Array<{ id: string; running: boolean }> };
        if (!active || controller !== currentController) return;
        runningSnapshotAuthoritativeRef.current = true;
        setRunningSessionIds((prev) => {
          const next = new Set((data.sessions ?? []).filter((session) => session.running).map((session) => session.id));
          return sameIdSet(prev, next) ? prev : next;
        });
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") console.warn("Failed to poll running sessions", error);
      } finally {
        if (active && controller === currentController && document.visibilityState === "visible") {
          timer = setTimeout(poll, 2500);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      } else {
        controller?.abort();
        if (timer) clearTimeout(timer);
        timer = null;
      }
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/agent/running/events");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { sessions?: Array<{ id: string; running: boolean }>; runningSessionIds?: string[] };
        const ids = data.sessions
          ? data.sessions.filter((session) => session.running).map((session) => session.id)
          : data.runningSessionIds ?? [];
        runningSnapshotAuthoritativeRef.current = true;
        setRunningSessionIds((prev) => {
          const next = new Set(ids);
          return sameIdSet(prev, next) ? prev : next;
        });
      } catch {
        // EventSource reconnects; a malformed frame must not alter state.
      }
    };
    return () => source.close();
  }, []);

  // Cross-client session list sync: any whitelisted session event (message
  // end, new entry, session info change) invalidates the list. Throttled so a
  // burst of streaming updates triggers at most one reload per 2s, and only
  // the ones that can change list shape/state drive a refetch.
  useEffect(() => {
    const source = new EventSource("/api/events");
    const LIST_REFRESH_EVENT_TYPES = new Set([
      "message_end",
      "agent_end",
      "entry_appended",
      "session_info_changed",
      "agent_settled",
      "auto_compaction_end",
      "session_pin_changed",
    ]);
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let scheduled = false;
    const scheduleReload = () => {
      if (scheduled) return;
      scheduled = true;
      throttleTimer = setTimeout(() => {
        scheduled = false;
        void loadSessions(false);
      }, 2000);
    };
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string } | null;
        if (data && data.type && LIST_REFRESH_EVENT_TYPES.has(data.type)) {
          scheduleReload();
        } else if (data && data.type === "project_alias_changed") {
          // Alias edits in another window update this window's alias map
          // without reloading the session list.
          void loadProjectAliases();
        } else if (data && data.type === "project_state_changed") {
          // Project tab / dropdown-pin edits in another window or device apply
          // immediately (and switch the current project when the pin changed).
          void syncProjectStateFromServer({ adoptSelection: true });
        }
      } catch {
        // EventSource reconnects; a malformed frame must not alter state.
      }
    };
    return () => {
      source.close();
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [loadSessions, loadProjectAliases, syncProjectStateFromServer]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    // 后台会话跑完时（且当前标签页隐藏/失焦）弹浏览器通知，避免切换工作区
    // 才发现任务早已结束。
    if (completedInBackground.length > 0 && (document.visibilityState !== "visible" || !document.hasFocus())) {
      const finished = allSessions.filter((s) => completedInBackground.includes(s.id));
      const label = finished.length === 1
        ? (finished[0]?.name || "Pi Web")
        : `${finished.length} conversations`;
      void showBrowserNotification({
        title: "Pi Web",
        body: finished.length === 1 ? "Agent finished" : `${label} finished`,
        sessionUrl: `/?session=${completedInBackground[0]}`,
        onClick: () => window.focus(),
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, allSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => samePath(w.path, cwd))) return worktreeState.projectRoot;
    const match = allSessions.find((s) => samePath(s.cwd, cwd));
    return match?.projectRoot ?? cwd;
  }, [worktreeState, allSessions]);

  // Remember every cwd the user lands on (picker / project list / worktree /
  // session click) so projects without sessions stay in the project list.
  useEffect(() => {
    if (selectedCwd) rememberPickedProject(selectedCwd);
  }, [selectedCwd, rememberPickedProject]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      // Honour a cwd passed in via the URL (?cwd=...) instead of blindly
      // picking the most-recent project. Otherwise a freshly opened project
      // (which has no sessions yet and is not in getRecentProjects) would be
      // replaced by an unrelated project once allSessions loads — the sidebar
      // then filters to the wrong project and new sessions stay invisible.
      if (selectedCwdProp) {
        setSelectedCwd(selectedCwdProp);
        return;
      }
      const projects = getRecentProjects(allSessions, null);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, selectedCwdProp, onSelectSession, onInitialRestoreDone]);

  // Re-arm the URL restore when the user navigates to a different ?session=
  // through SPA routes — otherwise restoredRef stays true and the new session
  // is never opened.
  useEffect(() => {
    if (initialSessionId) restoredRef.current = false;
  }, [initialSessionId]);

  const commitCustomPath = useCallback(async (candidate: string) => {
    const path = candidate.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSelectedCwd(data.cwd ?? path);
      setDirectoryPickerOpen(false);
      setDropdownOpen(false);
      setWorkspaceProjectDropdownOpen(null);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathError(null);
    setDirectoryPickerOpen(true);
  }, []);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setDirectoryPickerOpen(false);
        setCustomPathError(null);
        setDropdownOpen(false);
        setWorkspaceProjectDropdownOpen(null);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      setWorkspaceWorktreeDropdownOpen(null);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // Close dropdowns on outside click — the project and worktree menus of the
  // sidebar and of both workspace-control portals all share one rule.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inAnyDropdown = dropdownRef.current?.contains(target)
        || wtDropdownRef.current?.contains(target)
        || Object.values(workspaceDropdownRefs.current).some((node) => node?.contains(target));
      if (inAnyDropdown) return;
      setDropdownOpen(false);
      setWorkspaceProjectDropdownOpen(null);
      setWtDropdownOpen(false);
      setWorkspaceWorktreeDropdownOpen(null);
      setProjectFilter("");
      setCustomPathError(null);
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtError(null);
      setWtConfirmRemove(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s);
  }, [onSelectSession]);

  // Stable delete handler shared by the tree and grouped views — an inline
  // arrow would change identity every render and defeat memo(SessionTreeItem).
  const handleSessionDeleted = useCallback((id: string) => {
    onSessionDeleted?.(id);
    loadSessions();
  }, [onSessionDeleted, loadSessions]);

  /**
   * Optimistic pin/unpin: flip the local row immediately so the grouped view
   * reorders without waiting for the server round-trip, then persist in the
   * background and roll back (with a resync) if the PATCH fails.
   */
  const handlePinChange = useCallback((session: SessionInfo, pinned: boolean) => {
    setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned } : s)));
    void fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch(() => {
      // Roll back the optimistic flip and resync from the server.
      setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: !pinned } : s)));
      void loadSessions(false);
    });
  }, [loadSessions]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const selectedProject = projectRootFor(selectedCwd);
  // Project tabs are user-managed: every tab is added via the + button and
  // closed via its ✕. The leading project dropdown shows the current project;
  // a tab is highlighted only when its project is the current one (sync is
  // purely visual via the `active` check at render time).
  const recentProjects = getRecentProjects(allSessions, selectedCwd ? projectRootFor(selectedCwd) ?? selectedCwd : null, pickedProjects);

  // ── Project tab bar handlers ─────────────────────────────────────────────
  const [addTabDropdownOpen, setAddTabDropdownOpen] = useState(false);
  const addTabDropdownRef = useRef<HTMLDivElement | null>(null);
  /** Project shown in the leading dropdown. It is pinned here on first load
   *  and whenever the user switches via the dropdown itself; clicking a tab
   *  does NOT change it (the tab's project is shown in the session title
   *  instead). The dropdown button switches to its pinned project on click
   *  unless that project is already the current one (then it opens the list). */
  const [dropdownPinnedProject, setDropdownPinnedProject] = useState<string | null>(null);
  // Pin the leading dropdown to the initial project once, so clicking tabs
  // later never changes what the dropdown shows.
  useEffect(() => {
    if (!dropdownPinnedProject && selectedProject) {
      setDropdownPinnedProject(selectedProject);
    }
  }, [selectedProject, dropdownPinnedProject]);
  const removeProjectTab = (project: string) => {
    const next = projectTabs.filter((p) => p !== project);
    persistProjectTabs(next);
    // All tabs closed: fall back to the leading dropdown's pinned project.
    if (next.length === 0 && dropdownPinnedProject && !samePath(dropdownPinnedProject, selectedCwd ?? "")) {
      selectProject(dropdownPinnedProject, true);
    }
  };
  const addProjectTab = (project: string) => {
    // Already the dropdown's pinned project or an open tab? Just switch to it
    // (no duplicate tab, no error).
    if ((dropdownPinnedProject && samePath(dropdownPinnedProject, project))
      || projectTabs.some((p) => samePath(p, project))) {
      selectProject(project);
      return;
    }
    const next = [...projectTabs, project].slice(0, MAX_PROJECT_TABS);
    persistProjectTabs(next);
    // Append the tab (it stays where it was added — no reordering) and switch
    // to the newly added project immediately.
    selectProject(project);
  };
  // Close the + dropdown on outside click.
  useEffect(() => {
    if (!addTabDropdownOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!addTabDropdownRef.current?.contains(event.target as Node)) {
        setAddTabDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [addTabDropdownOpen]);
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Sessions of every worktree in the selected project are shown together.
  // Memoized: the session-tree memo downstream keys on these identities — an
  // inline filter would rebuild the tree on every render and defeat it.
  const filteredSessions = useMemo(
    () => selectedProject
      ? allSessions.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject)
      : allSessions,
    [allSessions, selectedProject],
  );

  // 批量生成当前项目所有会话的标题（并发池并行，单条失败跳过）
  const [batchNaming, setBatchNaming] = useState(false);
  const [batchNameProgress, setBatchNameProgress] = useState({ done: 0, total: 0 });

  const handleBatchAutoName = useCallback(async () => {
    if (batchNaming) return;
    const ids = filteredSessions
      .filter((s) => s.messageCount > 0)
      .map((s) => s.id);
    if (ids.length === 0) return;

    setBatchNaming(true);
    setBatchNameProgress({ done: 0, total: ids.length });

    // Conservative concurrency: title generation is a full model call per
    // session; 4 parallel runs frequently tripped provider rate limits /
    // context errors and stalled the UI. 2 keeps progress steady.
    const CONCURRENCY = 2;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < ids.length) {
        const index = nextIndex++;
        const id = ids[index];
        if (!id) continue;
        try {
          await fetch(`/api/sessions/${encodeURIComponent(id)}/auto-name`, { method: "POST" });
        } catch { /* skip errors */ }
        setBatchNameProgress({ done: index + 1, total: ids.length });
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker);
    await Promise.all(workers);

    setBatchNaming(false);
    void loadSessions(false);
  }, [batchNaming, filteredSessions, loadSessions]);
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject === worktreeState.projectRoot
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
            label: t("desktop.openRepoRoot"),
            title: t("desktop.openRepoRootDescription"),
          }
        : {
            label: t("desktop.gitRepoRootOnly"),
            title: t("desktop.gitRepoRootOnlyDescription"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: t("desktop.worktreesLoading"),
          title: t("desktop.checkingWorktrees"),
        }
      : null);

  // Search filter — applies to BOTH views (title or branch name, fuzzy substring)
  const searchFilteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredSessions;
    return filteredSessions.filter((s) => {
      const title = (s.name || s.firstMessage || "").toLowerCase();
      const branch = (s.worktreeBranch || "").toLowerCase();
      return title.includes(q) || branch.includes(q);
    });
  }, [searchQuery, filteredSessions]);

  // Build parent-child tree within the filtered set
  const sessionTree = useMemo(() => buildSessionTree(searchFilteredSessions), [searchFilteredSessions]);

  // Grouped accordion view partitions the search-filtered set.
  // timeTick forces re-evaluation every 60 s so Today / Yesterday / Older
  // automatically update when the day changes.
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sessionGroups = useMemo(() => buildSessionGroups(searchFilteredSessions, allSessions), [searchFilteredSessions, allSessions, timeTick]);

  const currentWt = worktreeState?.worktrees.find((w) => samePath(w.path, selectedCwd ?? ""))
    ?? worktreeState?.worktrees.find((w) => w.isMain)
    ?? null;
  // Look up a project's alias by its root path (samePath so Windows path
  // forms and case differences still match).
  const aliasFor = useCallback((project: string): string | undefined => {
    for (const key of Object.keys(projectAliases)) {
      if (samePath(key, project)) return projectAliases[key];
    }
    return undefined;
  }, [projectAliases]);
  // Inline alias editing inside the project dropdown (single row at a time).
  const [aliasEditingProject, setAliasEditingProject] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const aliasInputRef = useRef<HTMLInputElement | null>(null);
  const startEditAlias = useCallback((project: string) => {
    setAliasEditingProject(project);
    setAliasDraft(aliasFor(project) ?? "");
    setTimeout(() => aliasInputRef.current?.focus(), 0);
  }, [aliasFor]);
  const saveAlias = useCallback(async (project: string) => {
    setAliasEditingProject(null);
    const alias = aliasDraft.trim();
    // Optimistic update; the PUT response (server truth) replaces it on
    // success, and a failure rolls back to the last fetched map.
    setProjectAliases((prev) => {
      const key = Object.keys(prev).find((k) => samePath(k, project)) ?? project;
      const next = { ...prev };
      if (alias) next[key] = alias;
      else delete next[key];
      return next;
    });
    try {
      const res = await fetch("/api/project-aliases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: project, alias }),
      });
      const data = await res.json().catch(() => null) as { aliases?: Record<string, string> } | null;
      if (!res.ok || !data?.aliases) throw new Error(`HTTP ${res.status}`);
      setProjectAliases(data.aliases);
    } catch {
      void loadProjectAliases();
    }
  }, [aliasDraft, loadProjectAliases]);
  const compactProjectLabel = dropdownPinnedProject
    ? aliasFor(dropdownPinnedProject) ?? pathBaseName(dropdownPinnedProject)
    : (initialSessionId && !restoredRef.current ? "" : `${t("desktop.selectProject")}…`);
  const selectProject = (project: string, fromDropdown = false) => {
    setSelectedCwd(project);
    if (fromDropdown) {
      setDropdownPinnedProject(project);
      // Mark the pin as seen by the server so the echo of this very PUT can
      // never look like a remote change and yank the selection back.
      serverPinnedRef.current = project;
      // Cross-device sync of the dropdown's pinned project (the top project
      // picker area), so other windows/devices follow the selection.
      void fetch("/api/project-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinnedProject: project }),
      }).catch(() => {});
    }
    setProjectFilter("");
    setDirectoryPickerOpen(false);
    setCustomPathError(null);
    setDropdownOpen(false);
    setWorkspaceProjectDropdownOpen(null);
  };
  const projectSearch = (
    <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <MagnifyingGlass size={13} color="var(--text-dim)" style={{ position: "absolute", left: 12, pointerEvents: "none" }} aria-hidden="true" />
        <input
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (projectFilter) setProjectFilter("");
              else {
                setDropdownOpen(false);
                setWorkspaceProjectDropdownOpen(null);
              }
            }
          }}
          placeholder={t("desktop.searchProjects")}
          aria-label={t("desktop.searchProjects")}
          autoFocus
          style={{ width: "100%", padding: "8px 12px 8px 34px", background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
        />
      </div>
    </div>
  );
  const projectItem = (project: string) => {
    const isSelected = project === selectedProject;
    const isQuick = isQuickWorkspace(project, homeDir);
    const alias = aliasFor(project);
    const isEditing = aliasEditingProject === project;
    if (isEditing) {
      return (
        <div key={project} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px" }}>
          <input
            ref={aliasInputRef}
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void saveAlias(project); }
              if (e.key === "Escape") { setAliasEditingProject(null); setAliasDraft(alias ?? ""); }
            }}
            onBlur={() => void saveAlias(project)}
            placeholder={t("desktop.projectAliasPlaceholder")}
            aria-label={t("desktop.projectAliasPlaceholder")}
            maxLength={80}
            style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "var(--font-mono)", padding: "4px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
          />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setAliasEditingProject(null); setAliasDraft(alias ?? ""); }}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 5, flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-selected)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      );
    }
    return (
      <div
        key={project}
        style={{ display: "flex", alignItems: "center", width: "100%", background: isSelected ? "var(--bg-selected)" : "transparent", borderRadius: 5, minWidth: 0 }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
      >
        <button onClick={() => selectProject(project, true)} title={project} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", background: "transparent", border: "none", color: isSelected ? "var(--accent)" : "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, fontFamily: "var(--font-mono)", transition: "background 0.1s" }}
          onMouseDown={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; }}
        >
          {isQuick ? (
            <Lightning size={12} color={isSelected ? "var(--accent)" : "var(--text-dim)"} weight={isSelected ? "fill" : "regular"} style={{ flexShrink: 0 }} aria-hidden="true" />
          ) : isSelected ? (
            <Check size={12} color="var(--accent)" weight="bold" style={{ flexShrink: 0 }} aria-hidden="true" />
          ) : (
            <span style={{ width: 12, flexShrink: 0 }} />
          )}
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, flex: 1, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: alias ? "0 1 auto" : "1 1 0" }}>{alias ?? pathBaseName(project)}</span>
            {alias && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{pathBaseName(project)}</span>}
          </span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); startEditAlias(project); }}
          title={t("desktop.editProjectAlias")}
          aria-label={t("desktop.editProjectAlias")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, marginRight: 4, background: "none", border: "none", color: isSelected ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", borderRadius: 5, flexShrink: 0, opacity: 0.7 }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = isSelected ? "var(--accent)" : "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-selected)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.color = isSelected ? "var(--accent)" : "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
        >
          <PencilSimple size={12} weight="regular" aria-hidden="true" />
        </button>
      </div>
    );
  };
  const projectList = (
    <div className="scroll-overlay" style={{ maxHeight: "min(32vh, 240px)", flex: 1, minHeight: 0, padding: "4px" }}>
      {visibleProjects.length > 0 && (
        <div style={{ padding: "5px 8px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {t("desktop.recentProjects")}
        </div>
      )}
      {visibleProjects.map(projectItem)}
      {visibleProjects.length === 0 && <div style={{ padding: "8px", fontSize: 12, color: "var(--text-dim)" }}>{projectFilter.trim() ? t("desktop.noMatchingProjects") : t("desktop.noProjectsYet")}</div>}
    </div>
  );
  const projectActions = (
    <div style={{ borderTop: "1px solid var(--border)", padding: "4px", flexShrink: 0 }}>
      <button onClick={(e) => { e.stopPropagation(); void handleDefaultCwd(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
        <Lightning size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
        <span>{t("desktop.quickWorkspace")}</span>
      </button>
      <button onClick={(e) => { e.stopPropagation(); handleCustomPathClick(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
        <FolderOpen size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
        <span>{t("desktop.selectFolder")}</span>
      </button>
    </div>
  );
  const compactWorktreeLabel = currentWt
    ? (currentWt.branch ?? pathBaseName(currentWt.path))
    : inactiveWorktreeSelector?.label;
  const hasWorkspaceControlsHosts = Boolean(workspaceControlsHosts?.title || workspaceControlsHosts?.welcome);

  // ── Project tab bar (desktop top bar) ────────────────────────────────────
  // Candidate projects for the + dropdown: recent projects not already open
  // as a tab and not the dropdown's own pinned project.
  const addTabCandidates = recentProjects.filter((p) =>
    !projectTabs.includes(p) && !(dropdownPinnedProject && samePath(dropdownPinnedProject, p)),
  );
  const projectTabBar = !isMobile ? (
    <div className="app-no-drag" style={{ display: "flex", alignItems: "center", height: "100%", gap: 2, flexShrink: 1, minWidth: 0 }}>
      {/* Leading project picker — the original dropdown kept at the far left. */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}>
        <button
          className="app-no-drag app-titlebar-context-control workspace-project-control"
          onClick={() => {
            // The dropdown is independent of the tabs: clicking it switches to
            // its pinned project unless that is already the current one — in
            // that case it just opens/closes the project list.
            if (dropdownPinnedProject && selectedCwd && !samePath(dropdownPinnedProject, selectedCwd)) {
              selectProject(dropdownPinnedProject, true);
              return;
            }
            setWorkspaceProjectDropdownOpen((open) => (open === "title" ? null : "title"));
          }}
          title={dropdownPinnedProject ?? selectedCwd ?? t("desktop.selectProject")}
          aria-label={t("desktop.selectProject")}
          aria-expanded={workspaceProjectDropdownOpen === "title"}
          style={{
            height: "100%",
            maxWidth: 220,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px",
            background: workspaceProjectDropdownOpen === "title" ? "var(--bg-selected)" : "none",
            border: "none",
            color: workspaceProjectDropdownOpen === "title" ? "var(--text)" : selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
            lineHeight: 1,
            letterSpacing: 0,
            textAlign: "left",
            flexShrink: 0,
            transition: "background 0.12s, color 0.12s, border-color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = selectedCwd ? "var(--text)" : "var(--text-muted)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = workspaceProjectDropdownOpen === "title" ? "var(--bg-selected)" : "none";
            e.currentTarget.style.color = workspaceProjectDropdownOpen === "title" ? "var(--text)" : selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
          }}
        >
          <PathLabel text={compactProjectLabel} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
          <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: workspaceProjectDropdownOpen === "title" ? "rotate(180deg)" : "none" }} aria-hidden="true" />
        </button>
        <AnimatedDropdown open={workspaceProjectDropdownOpen === "title"} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(38vh, 300px)" }}>
          {projectSearch}
          {projectList}
          {projectActions}
        </AnimatedDropdown>
      </div>
      {projectTabs.map((project) => {
        const active = samePath(project, selectedProject ?? selectedCwd ?? "");
        const label = aliasFor(project) ?? pathBaseName(project);
        return (
          <div
            key={project}
            className="project-tab"
            title={project}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              height: 28,
              maxWidth: 220,
              flexShrink: 0,
              padding: "0 4px 0 10px",
              borderRadius: 7,
              background: active ? "var(--bg-selected)" : "var(--bg-card)",
              border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 45%, var(--border))" : "var(--border)"}`,
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = active ? "var(--bg-selected)" : "var(--bg-hover)";
              e.currentTarget.style.borderColor = active ? "color-mix(in srgb, var(--accent) 60%, var(--border))" : "var(--border-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = active ? "var(--bg-selected)" : "var(--bg-card)";
              e.currentTarget.style.borderColor = active ? "color-mix(in srgb, var(--accent) 45%, var(--border))" : "var(--border)";
            }}
          >
            <button
              type="button"
              onClick={() => selectProject(project)}
              aria-label={label}
              style={{
                display: "flex", alignItems: "center", flex: 1, minWidth: 0,
                height: "100%", padding: 0,
                background: "none", border: "none",
                color: "inherit", cursor: "pointer",
                fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
            </button>
            <button
              type="button"
              onClick={() => removeProjectTab(project)}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 18, height: 18, padding: 0,
                borderRadius: 5,
                background: "none", border: "none",
                color: "var(--text-dim)",
                cursor: "pointer", flexShrink: 0,
                opacity: active ? 1 : 0.75,
                transition: "background 0.12s, color 0.12s, opacity 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--text) 12%, transparent)"; e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.opacity = active ? "1" : "0.75"; }}
            >
              <X size={11} weight="bold" aria-hidden="true" />
            </button>
          </div>
        );      })}
      {/* + button: only after the last tab; hidden at the 5-tab cap. */}
      {projectTabs.length < MAX_PROJECT_TABS && (
        <div ref={addTabDropdownRef} style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setAddTabDropdownOpen((open) => !open)}
            title={t("desktop.addProjectTab")}
            aria-label={t("desktop.addProjectTab")}
            aria-expanded={addTabDropdownOpen}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 30, height: "100%", padding: 0,
              background: addTabDropdownOpen ? "var(--bg-selected)" : "none",
              border: "none",
              borderLeft: "1px solid var(--border)",
              color: addTabDropdownOpen ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = addTabDropdownOpen ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = addTabDropdownOpen ? "var(--text)" : "var(--text-muted)"; }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          <AnimatedDropdown open={addTabDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(38vh, 300px)" }}>
            <div className="scroll-overlay" style={{ maxHeight: "min(32vh, 240px)", flex: 1, minHeight: 0, padding: "4px" }}>
              {addTabCandidates.length > 0 && (
                <div style={{ padding: "5px 8px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  {t("desktop.recentProjects")}
                </div>
              )}
              {addTabCandidates.map((project) => (
                <button
                  key={project}
                  type="button"
                  onClick={() => { addProjectTab(project); setAddTabDropdownOpen(false); }}
                  title={project}
                  style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, fontFamily: "var(--font-mono)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{aliasFor(project) ?? pathBaseName(project)}</span>
                  {aliasFor(project) && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{pathBaseName(project)}</span>}
                </button>
              ))}
              {addTabCandidates.length === 0 && projectTabs.length >= MAX_PROJECT_TABS && (
                <div style={{ padding: "8px", fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.maxProjectTabs")}</div>
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--border)", padding: "4px", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => { setAddTabDropdownOpen(false); handleCustomPathClick(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <FolderOpen size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                <span>{t("desktop.selectFolder")}</span>
              </button>
            </div>
          </AnimatedDropdown>
        </div>
      )}
    </div>
  ) : null;

  // Git-branch chip shown to the right of the session title (moved out of the
  // title-bar worktree switcher per the top-bar redesign).
  const branchChip = currentWt?.branch ? (
    <span
      title={`${t("desktop.branch")}: ${currentWt.branch}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        maxWidth: 160,
        padding: "2px 8px",
        border: "1px solid var(--border)",
        borderRadius: 999,
        background: "var(--bg-card)",
        color: "var(--text-muted)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flexShrink: 0,
      }}
    >
      <GitBranch size={11} weight="regular" aria-hidden="true" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentWt.branch}</span>
    </span>
  ) : null;

  // Compact worktree switcher shown beside the branch chip (right of the
  // session title). The branch name lives in the chip; this is the action
  // button that switches worktrees.
  const titleWorktreeControl = showWorktreeSwitcher ? (
    <div style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        className="app-no-drag"
        onClick={() => setWorkspaceWorktreeDropdownOpen((open) => (open === "title" ? null : "title"))}
        aria-label={t("desktop.switchWorktree")}
        aria-expanded={workspaceWorktreeDropdownOpen === "title"}
        title={currentWt ? t("desktop.switchWorktreeWithPath", { path: currentWt.path }) : t("desktop.switchWorktree")}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, padding: 0,
          background: workspaceWorktreeDropdownOpen === "title" ? "var(--bg-selected)" : "none",
          border: "1px solid var(--border)",
          borderRadius: 999,
          color: workspaceWorktreeDropdownOpen === "title" ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.12s, color 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = workspaceWorktreeDropdownOpen === "title" ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = workspaceWorktreeDropdownOpen === "title" ? "var(--text)" : "var(--text-muted)"; }}
      >
        <GitBranch size={14} weight="regular" aria-hidden="true" />
      </button>
      <AnimatedDropdown open={workspaceWorktreeDropdownOpen === "title"} style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden" }}>
        <div className="scroll-overlay" style={{ maxHeight: "min(40vh, 300px)" }}>
          {worktreeState?.worktrees.map((wt) => {
            const isCurrent = samePath(wt.path, selectedCwd ?? "") || (wt.isMain && !worktreeState.worktrees.some((w) => samePath(w.path, selectedCwd ?? "")));
            return (
              <button key={wt.path} onClick={() => { setSelectedCwd(wt.path); setWtDropdownOpen(false); setWorkspaceWorktreeDropdownOpen(null); setWtError(null); }} title={wt.path} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "var(--bg)", border: "none", borderBottom: "1px solid var(--border)", color: isCurrent ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {isCurrent ? <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" /> : <span style={{ width: 10, flexShrink: 0 }} />}
                <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
              </button>
            );
          })}
        </div>
        {!wtNewOpen ? (
          <button onClick={(e) => { e.stopPropagation(); setWtNewOpen(true); setWtError(null); setTimeout(() => wtNewInputRef.current?.focus(), 0); }} title={t("desktop.createWorktree")} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "none", border: "none", borderTop: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
            <span>{t("desktop.newWorktree")}</span>
          </button>
        ) : (
          <div style={{ padding: "6px 8px", borderTop: "1px solid var(--border)" }}>
            <input
              ref={wtNewInputRef}
              value={wtNewBranch}
              onChange={(e) => { setWtNewBranch(e.target.value); setWtError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void handleCreateWorktree(); }
                if (e.key === "Escape") { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }
              }}
              placeholder={t("desktop.branchName")}
              style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
              <button onClick={() => void handleCreateWorktree()} disabled={wtBusy || !wtNewBranch.trim()} style={{ flex: 1, padding: "4px 0", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer", opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1 }}>{wtBusy ? t("desktop.creating") : t("desktop.create")}</button>
              <button onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }} style={{ flex: 1, padding: "4px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{t("desktop.cancel")}</button>
            </div>
            {wtError && <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{wtError}</div>}
          </div>
        )}
      </AnimatedDropdown>
    </div>
  ) : null;

  const workspaceControls = (location: "title" | "welcome") => {
    const isLargeWorkspaceControl = location === "welcome";
    const isProjectDropdownOpen = workspaceProjectDropdownOpen === location;
    const isWorktreeDropdownOpen = workspaceWorktreeDropdownOpen === location;
    // The welcome (new-session) project button must show the CURRENT project
    // (selectedCwd/selectedProject), not the leading dropdown's pinned one:
    // switching via a project tab changes selectedCwd but leaves
    // dropdownPinnedProject untouched, which previously left a stale name on
    // the new-session page. The title bar keeps the pinned label on purpose.
    const currentProjectLabel = selectedProject
      ? aliasFor(selectedProject) ?? pathBaseName(selectedProject)
      : compactProjectLabel;
    // The standalone project dropdown button lives at the front of the tab bar
    // on desktop; hide it here so it is not duplicated (welcome keeps it).
    const hideProjectButton = location === "title" && !isMobile;
    return showWorkspaceControls ? (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: isLargeWorkspaceControl ? 6 : 2, height: isLargeWorkspaceControl ? "auto" : "100%", minWidth: 0, width: isLargeWorkspaceControl ? "100%" : undefined }}>
        {!hideProjectButton && (
        <div style={{ position: "relative", minWidth: 0, width: isLargeWorkspaceControl ? "fit-content" : undefined, maxWidth: isLargeWorkspaceControl ? "min(100%, 560px)" : undefined }}>
          <button
            className={`app-no-drag app-titlebar-context-control workspace-project-control${isLargeWorkspaceControl ? " workspace-project-control-large" : ""}`}
            onClick={() => setWorkspaceProjectDropdownOpen((open) => open === location ? null : location)}
            title={selectedProject ?? selectedCwd ?? t("desktop.selectProject")}
            aria-label={t("desktop.selectProject")}
            aria-expanded={isProjectDropdownOpen}
            style={{
              height: isLargeWorkspaceControl ? 48 : 36,
              width: isLargeWorkspaceControl ? "100%" : undefined,
              maxWidth: isLargeWorkspaceControl ? "100%" : 260,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: isLargeWorkspaceControl ? 10 : 6,
              padding: isLargeWorkspaceControl ? "0 12px" : "0 8px",
              background: isProjectDropdownOpen ? "var(--bg-selected)" : "none",
              border: "none",
              borderRadius: isLargeWorkspaceControl ? 8 : 0,
              color: isProjectDropdownOpen ? "var(--text)" : selectedCwd ? (isLargeWorkspaceControl ? "var(--text)" : "var(--text-muted)") : "var(--text-dim)",
              cursor: "pointer",
              fontSize: isLargeWorkspaceControl ? 24 : 12,
              fontWeight: 500,
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
              letterSpacing: 0,
              textAlign: "left",
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = selectedCwd ? "var(--text)" : "var(--text-muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isProjectDropdownOpen ? "var(--bg-selected)" : "none";
              e.currentTarget.style.color = isProjectDropdownOpen ? "var(--text)" : selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
            }}
          >
            <PathLabel text={isLargeWorkspaceControl ? currentProjectLabel : compactProjectLabel} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
            <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: isProjectDropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
          </button>
          <AnimatedDropdown open={isProjectDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(38vh, 300px)" }}>
            {projectSearch}
            {projectList}
            {projectActions}
          </AnimatedDropdown>
        </div>
        )}

        {/* Worktree switcher — shown only in the welcome (large) layout; in the
            title bar it lives beside the branch chip on the right of the
            session title. */}
        {isLargeWorkspaceControl && (showWorktreeSwitcher || inactiveWorktreeSelector) && (
          <div style={{ position: "relative", minWidth: 0 }}>
            <button
              className="app-no-drag app-titlebar-context-control workspace-worktree-control"
              onClick={() => { if (showWorktreeSwitcher) setWorkspaceWorktreeDropdownOpen((open) => open === location ? null : location); }}
              aria-label={t("desktop.switchWorktree")}
              aria-expanded={showWorktreeSwitcher ? isWorktreeDropdownOpen : undefined}
              aria-disabled={!showWorktreeSwitcher}
              tabIndex={showWorktreeSwitcher ? 0 : -1}
              title={showWorktreeSwitcher && currentWt ? t("desktop.switchWorktreeWithPath", { path: currentWt.path }) : inactiveWorktreeSelector?.title}
              style={{
                height: 36,
                maxWidth: 220,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px",
                background: isWorktreeDropdownOpen ? "var(--bg-selected)" : "none",
                border: "none",
                color: isWorktreeDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)",
                cursor: showWorktreeSwitcher ? "pointer" : "default",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "var(--font-mono)",
                lineHeight: 1,
                letterSpacing: 0,
                opacity: showWorktreeSwitcher ? 1 : 0.82,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (!showWorktreeSwitcher) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isWorktreeDropdownOpen ? "var(--bg-selected)" : "none";
                e.currentTarget.style.color = isWorktreeDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)";
              }}
            >
              <GitBranch size={16} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
              {/* Branch text moved to the session-title-right chip; the welcome
                  location keeps its full label. */}
              {isLargeWorkspaceControl && <span className="worktree-title-label"><PathLabel text={compactWorktreeLabel ?? ""} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} /></span>}
              {showWorktreeSwitcher && <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: isWorktreeDropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />}
            </button>
            <AnimatedDropdown open={showWorktreeSwitcher && isWorktreeDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden" }}>
              <div className="scroll-overlay" style={{ maxHeight: "min(40vh, 300px)" }}>
                {worktreeState?.worktrees.map((wt) => {
                  const isCurrent = samePath(wt.path, selectedCwd ?? "") || (wt.isMain && !worktreeState.worktrees.some((w) => samePath(w.path, selectedCwd ?? "")));
                  return (
                    <button key={wt.path} onClick={() => { setSelectedCwd(wt.path); setWtDropdownOpen(false); setWorkspaceWorktreeDropdownOpen(null); setWtError(null); }} title={wt.path} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "var(--bg)", border: "none", borderBottom: "1px solid var(--border)", color: isCurrent ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                      {isCurrent ? <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" /> : <span style={{ width: 10, flexShrink: 0 }} />}
                      <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                      {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
                    </button>
                  );
                })}
              </div>
              {!wtNewOpen ? (
                <button onClick={(e) => { e.stopPropagation(); setWtNewOpen(true); setWtError(null); setTimeout(() => wtNewInputRef.current?.focus(), 0); }} title={t("desktop.createWorktree")} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
                  <span>{t("desktop.newWorktree")}</span>
                </button>
              ) : (
                <div style={{ padding: "6px 8px" }}>
                  <input
                    ref={wtNewInputRef}
                    value={wtNewBranch}
                    onChange={(e) => { setWtNewBranch(e.target.value); setWtError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleCreateWorktree(); }
                      if (e.key === "Escape") { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }
                    }}
                    placeholder={t("desktop.branchName")}
                    style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button onClick={() => void handleCreateWorktree()} disabled={wtBusy || !wtNewBranch.trim()} style={{ flex: 1, padding: "4px 0", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer", opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1 }}>{wtBusy ? t("desktop.creating") : t("desktop.create")}</button>
                    <button onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }} style={{ flex: 1, padding: "4px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{t("desktop.cancel")}</button>
                  </div>
                  {wtError && <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{wtError}</div>}
                </div>
              )}
            </AnimatedDropdown>
          </div>
        )}
      </div>
    ) : null;
  };

  return (
    <>
      {directoryPickerOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            if (customPathValidating) return;
            setDirectoryPickerOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {(Object.entries(workspaceControlsHosts ?? {}) as Array<[string, HTMLElement | null | undefined]>)
        .filter(([location]) => location === "title" || location === "welcome")
        .map(([location, host]) => host && createPortal(
        <div ref={(node) => { workspaceDropdownRefs.current[location as "title" | "welcome"] = node; }} style={{ height: "100%", display: "flex" }}>
          {location === "title" && projectTabBar}
          {workspaceControls(location as "title" | "welcome")}
        </div>,
        host,
        location,
      ))}
      {workspaceControlsHosts?.titleRight && !isMobile && createPortal(
        <div ref={(node) => { workspaceDropdownRefs.current.titleRight = node; }} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {branchChip}
          {titleWorktreeControl}
        </div>,
        workspaceControlsHosts.titleRight,
        "titleRight",
      )}
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            onClick={() => setSessionsOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              padding: "6px 10px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            <CaretRight size={9} weight="regular" style={{ transform: sessionsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
            {t("desktop.sessions")}
          </button>
          {/* View style switcher — list / grouped accordion */}
          <div style={{ display: "flex", gap: 2, flexShrink: 0, marginRight: 2 }} role="group" aria-label="Session view">
            <button
              onClick={() => setViewStyleAndPersist("list")}
              title={t("desktop.sessionViewList")}
              aria-label={t("desktop.sessionViewList")}
              aria-pressed={viewStyle === "list"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, padding: 0,
                background: viewStyle === "list" ? "var(--bg-selected)" : "none",
                border: "none", borderRadius: 5, flexShrink: 0,
                color: viewStyle === "list" ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { if (viewStyle !== "list") { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; } }}
              onMouseLeave={(e) => { if (viewStyle !== "list") { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; } }}
            >
              <List size={12} weight="regular" aria-hidden="true" />
            </button>
            <button
              onClick={() => setViewStyleAndPersist("groups")}
              title={t("desktop.sessionViewGroups")}
              aria-label={t("desktop.sessionViewGroups")}
              aria-pressed={viewStyle === "groups"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, padding: 0,
                background: viewStyle === "groups" ? "var(--bg-selected)" : "none",
                border: "none", borderRadius: 5, flexShrink: 0,
                color: viewStyle === "groups" ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { if (viewStyle !== "groups") { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; } }}
              onMouseLeave={(e) => { if (viewStyle !== "groups") { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; } }}
            >
              <StackSimple size={12} weight="regular" aria-hidden="true" />
            </button>
          </div>
          <button
            onClick={handleNewSession}
            disabled={!selectedCwd}
            title={selectedCwd ? t("desktop.newSessionIn", { cwd: selectedCwd }) : t("desktop.selectProjectFirst")}
            aria-label={t("desktop.newSession")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none",
              border: "none",
              color: selectedCwd ? "var(--text-dim)" : "var(--text-dim)",
              cursor: selectedCwd ? "pointer" : "default",
              borderRadius: 5,
              flexShrink: 0,
              opacity: selectedCwd ? 1 : 0.6,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { if (selectedCwd) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <Plus size={13} weight="regular" aria-hidden="true" />
          </button>
          <button
            onClick={() => void handleBatchAutoName()}
            disabled={batchNaming || !selectedCwd || filteredSessions.filter((s) => s.messageCount > 0).length === 0}
            title={batchNaming
              ? `${t("desktop.generatingTitlesProgress", { done: batchNameProgress.done, total: batchNameProgress.total })}`
              : t("desktop.generateAllTitles")}
            aria-label={t("desktop.generateAllTitles")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: batchNaming ? "default" : "pointer",
              borderRadius: 5,
              flexShrink: 0,
              opacity: (!selectedCwd || filteredSessions.filter((s) => s.messageCount > 0).length === 0) ? 0.5 : 1,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { if (!batchNaming) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            {batchNaming ? (
              <svg
                style={{ animation: "spin 1s linear infinite" }}
                width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <Sparkle size={13} weight="regular" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={() => loadSessions(false)}
            title={t("desktop.refresh")}
            aria-label={t("desktop.refresh")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0, marginRight: 6,
              background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "none",
              border: "none",
              color: sessionRefreshDone ? "#4ade80" : "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 5,
              flexShrink: 0,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { if (!sessionRefreshDone) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
            onMouseLeave={(e) => { if (!sessionRefreshDone) { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; } }}
          >
            {sessionRefreshDone ? (
              <Check size={13} color="#4ade80" weight="regular" aria-hidden="true" />
            ) : (
              <ArrowClockwise size={13} weight="regular" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* CWD picker — fallback only when no portal hosts exist. With hosts,
            project selection always lives in the title/welcome workspace
            control, which is now shown regardless of whether a project is
            selected. */}
        {!hasWorkspaceControlsHosts && <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={selectedProject ?? selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {selectedCwd ? (
              <PathLabel
                text={aliasFor(selectedProject ?? selectedCwd ?? "") ?? displayCwd(selectedProject ?? selectedCwd, homeDir)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text)",
                }}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {initialSessionId && !restoredRef.current ? "" : `${t("desktop.selectProject")}…`}
              </span>
            )}
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: "min(38vh, 300px)",
            }}
          >
            {projectSearch}
            {projectList}
            {projectActions}
          </AnimatedDropdown>
        </div>}

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {!hasWorkspaceControlsHosts && showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const currentWt = worktreeState.worktrees.find((w) => samePath(w.path, selectedCwd ?? ""))
            ?? worktreeState.worktrees.find((w) => w.isMain);
          return (
            <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 6 }}>
              <button
                onClick={() => setWtDropdownOpen((v) => !v)}
                title={currentWt ? t("desktop.switchWorktreeWithPath", { path: currentWt.path }) : t("desktop.switchWorktree")}
                style={{
                  width: "100%",
                  height: 29,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: "var(--text-muted)",
                  textAlign: "left",
                }}
              >
                <GitBranch size={11} weight="regular" style={{ flexShrink: 0, color: currentWt && !currentWt.isMain ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true" />
                <PathLabel
                  text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
                />
                {currentWt?.isMain && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <CaretDown size={9} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                  <div className="scroll-overlay" style={{ maxHeight: "min(40vh, 300px)" }}>
                    {worktreeState.worktrees.map((wt) => {
                      const isCurrent = samePath(wt.path, selectedCwd ?? "") || (wt.isMain && !worktreeState.worktrees.some((w) => samePath(w.path, selectedCwd ?? "")));
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("desktop.uncommittedChanges")}
                            </span>
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, true)}
                              disabled={wtBusy}
                              style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("desktop.force")}
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("desktop.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, false)}
                              disabled={wtBusy}
                              title={t("desktop.removeWorktree", { path: wt.path })}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: 34, height: 28, padding: 0, marginRight: 4,
                                background: "none", border: "none",
                                color: "var(--text-dim)", cursor: "pointer",
                                borderRadius: 5, flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                            >
                              <Trash size={12} weight="regular" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("desktop.createWorktree")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <Plus size={10} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                      <span>{t("desktop.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                        placeholder={t("desktop.branchName")}
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: 5,
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                          {wtBusy ? t("desktop.creating") : t("desktop.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {t("desktop.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {!hasWorkspaceControlsHosts && inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
              opacity: 0.82,
            }}
          >
            <GitBranch size={11} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
          </button>
        )}
      </div>

      {/* Session list — when both panels open, uses intelligent max-height;
           when explorer is collapsed, expands to fill remaining space. */}
      {sessionsOpen && (
        <div className="scroll-overlay" style={{ flex: explorerOpen ? "0 1 auto" : "1 1 0", padding: "0", minHeight: 0, maxHeight: explorerOpen ? "min(40%, 360px)" : "none" }}>
          {/* Search bar — visible in both views, sticky under the header */}
          <div style={{ position: "sticky", top: 0, zIndex: 1, padding: "4px 10px 6px", background: "var(--bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-hover)", borderRadius: 8, padding: "0 9px", height: 30 }}>
              <MagnifyingGlass size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("desktop.searchSessions")}
                aria-label={t("desktop.searchSessions")}
                style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)" }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  aria-label={t("i18n.close")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-selected)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {loading && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("desktop.loading")}
            </div>
          )}
          {error && (
            <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
              {error}
            </div>
          )}
          {!loading && !error && viewStyle === "list" && (
            <>
              {searchFilteredSessions.length === 0 && (
                <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noSessionsFound")}
                </div>
              )}
              {sessionTree.map((node) => (
                <SessionTreeItem
                  key={node.session.id}
                  node={node}
                  selectedSessionId={selectedSessionId}
                  runningSessionIds={runningSessionIds}
                  unreadSessionIds={unreadSessionIds}
                  onSelectSession={handleSelectSessionFromList}
                  onRenamed={loadSessions}
                  selectedSessionStats={selectedSessionStats}
                  onSessionDeleted={handleSessionDeleted}
                  depth={0}
                />
              ))}
            </>
          )}
          {!loading && !error && viewStyle === "groups" && (
            <>
              {searchFilteredSessions.length === 0 && (
                <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  {t(searchQuery.trim() ? "desktop.noSearchResults" : "desktop.noSessionsFound")}
                </div>
              )}
              {sessionGroups.map((group) => {
                const searching = searchQuery.trim().length > 0;
                const isOpen = searching ? true : groupOpen[group.key];
                return (
                  <AccordionGroup
                    key={group.key}
                    groupKey={group.key}
                    label={t(GROUP_LABEL_KEYS[group.key])}
                    rows={group.rows}
                    isOpen={isOpen}
                    onToggle={() => setGroupOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                    onSelectSession={handleSelectSessionFromList}
                    selectedSessionId={selectedSessionId}
                    runningSessionIds={runningSessionIds}
                    unreadSessionIds={unreadSessionIds}
                    allSessions={allSessions}
                    onPinChange={handlePinChange}
                    onRenamed={loadSessions}
                    onSessionDeleted={handleSessionDeleted}
                  />
                );
              })}
            </>
          )}
        </div>
      )}

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <CaretRight size={9} weight="regular" style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
              {t("desktop.explorer")}
            </button>
            {explorerOpen && (
              <button
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("desktop.uploadFilesToProjectRoot")}
                aria-label={t("desktop.uploadFiles")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: explorerUploadBusy ? "default" : "pointer",
                  borderRadius: 5,
                  flexShrink: 0,
                  opacity: explorerUploadBusy ? 0.6 : 1,
                  transition: "color 0.3s, background 0.3s",
                }}
                onMouseEnter={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                <UploadSimple size={13} weight="regular" aria-hidden="true" />
              </button>
            )}
            <button
              onClick={() => {
                setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("desktop.refreshExplorer")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 6,
                background: explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none",
                color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 5,
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              {explorerRefreshDone ? (
                <Check size={13} color="#4ade80" weight="regular" aria-hidden="true" />
              ) : (
                <ArrowClockwise size={13} weight="regular" aria-hidden="true" />
              )}
            </button>
          </div>
          {explorerOpen && (
            <div className="scroll-overlay" style={{ flex: 1, overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                onFileCreated={onFileCreated}
                onFileDeleted={onFileDeleted}
              />
            </div>
          )}
        </div>
      )}

      {(selectedCwdProp || selectedCwd) && (
        <QuickChangesPanel
          cwd={selectedCwd ?? selectedCwdProp!}
          refreshKey={explorerKey}
          onOpenFile={onOpenFile ?? (() => {})}
        />
      )}
      {onOpenSettings && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, padding: "7px 8px", borderTop: "1px solid var(--border)", flexShrink: 0, marginTop: "auto" }}>
          {[
            { tab: "models", label: t("desktop.models"), Icon: Cpu },
            { tab: "skills", label: t("desktop.skills"), Icon: Stack },
            { tab: "plugins", label: t("desktop.plugins"), Icon: Plug },
          ].map(({ tab, label, Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onOpenSettings(tab)}
              title={label}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 0, padding: "6px 4px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer", fontSize: 10.5 }}
              onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = "var(--bg-panel)"; event.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <Icon size={13} aria-hidden="true" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

const SessionTreeItem = memo(function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  selectedSessionStats,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  selectedSessionStats?: SessionStatsInfo | null;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const isSelected = node.session.id === selectedSessionId;
  // Stable per-item callbacks so memo(SessionItem) can skip unchanged rows.
  const handleClick = useCallback(() => onSelectSession(node.session), [onSelectSession, node.session]);
  const handleDeleted = useCallback((id: string) => onSessionDeleted?.(id), [onSessionDeleted]);
  const handleToggleCollapse = useCallback(() => setCollapsed((v) => !v), []);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={isSelected}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={handleClick}
          onRenamed={onRenamed}
          onDeleted={handleDeleted}
          selectedSessionId={selectedSessionId}
          selectedSessionStats={isSelected ? selectedSessionStats : null}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              selectedSessionStats={selectedSessionStats}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function RunningSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.agentRunning")}
      aria-label={t("desktop.agentRunningLabel")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.newActivity")}
      aria-label={t("desktop.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="3" fill="currentColor">
          <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  selectedSessionId,
  selectedSessionStats,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  selectedSessionId?: string | null;
  selectedSessionStats?: SessionStatsInfo | null;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameCaretIndex, setRenameCaretIndex] = useState(0);
  const [renameCaretLeft, setRenameCaretLeft] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [autoNaming, setAutoNaming] = useState(false);
  const [autoNameError, setAutoNameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameMeasureRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [titleModelPickerOpen, setTitleModelPickerOpen] = useState(false);
  const [titleModels, setTitleModels] = useState<Array<{ id: string; name?: string; provider?: string }>>([]);
  const [titleModelError, setTitleModelError] = useState<string | null>(null);
  const [titleModelLoading, setTitleModelLoading] = useState(false);
  const [titleModelSaving, setTitleModelSaving] = useState(false);
  // Group models by provider, mirroring the composer's model picker layout.
  const titleModelGroups = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name?: string; provider?: string }>>();
    for (const m of titleModels) {
      const p = m.provider || "other";
      const list = map.get(p);
      if (list) list.push(m); else map.set(p, [m]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [titleModels]);

  const title = stripModeInstructionBlocks(session.name) || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const hasMessages = session.messageCount > 0
    || (session.id === selectedSessionId && (selectedSessionStats?.userMessages ?? 0) > 0);

  // A two-pixel overlay gives the otherwise native one-pixel input caret a
  // clearer visual weight while the title is edited in place.
  useLayoutEffect(() => {
    if (renaming) setRenameCaretLeft(renameMeasureRef.current?.getBoundingClientRect().width ?? 0);
  }, [renaming, renameValue, renameCaretIndex]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(title);
    setRenameCaretIndex(title.length);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [title]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleAutoName = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (autoNaming || !hasMessages) return;
    setAutoNaming(true);
    setAutoNameError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      onRenamed?.();
    } catch (error) {
      setAutoNameError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutoNaming(false);
    }
  }, [autoNaming, hasMessages, session.id, onRenamed]);

  /** Open the title-model picker (loads the model list from /api/models). */
  const openTitleModelPicker = useCallback(async () => {
    setTitleModelPickerOpen(true);
    setTitleModelLoading(true);
    setTitleModelError(null);
    try {
      const response = await fetch(`/api/models?cwd=${encodeURIComponent(session.cwd || "")}`);
      const body = (await response.json().catch(() => ({}))) as { modelList?: Array<{ id: string; name?: string; provider?: string }>; error?: string };
      if (!response.ok) {
        setTitleModels([]);
        setTitleModelError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setTitleModels(body.modelList ?? []);
    } catch {
      setTitleModels([]);
      setTitleModelError("HTTP request failed");
    } finally {
      setTitleModelLoading(false);
    }
  }, [session.cwd]);

  /** Save the chosen title model to settings. */
  const saveTitleModel = useCallback(async (modelId: string) => {
    setTitleModelSaving(true);
    try {
      await fetch("/api/settings/title-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      setTitleModelPickerOpen(false);
      setAutoNameError(null);
      // Retry immediately with the new model.
      setAutoNaming(true);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/auto-name`, { method: "POST" });
        const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
        if (!response.ok || !body.title) throw new Error(body.error || `HTTP ${response.status}`);
        onRenamed?.();
      } catch (error) {
        setAutoNameError(error instanceof Error ? error.message : String(error));
      } finally {
        setAutoNaming(false);
      }
    } catch {
      // ignore
    } finally {
      setTitleModelSaving(false);
    }
  }, [session.id, onRenamed]);

  const performDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 50;

  return (
    <div
      ref={rowRef}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("desktop.deleteSession", { title: `“${title.slice(0, 22)}${title.length > 22 ? "…" : ""}”` })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <Trash size={12} weight="regular" aria-hidden="true" />
              {t("desktop.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("desktop.cancel")}
            </button>
          </div>
        </>
      ) : (
        /* ── Session content; renaming swaps only the title text in place ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <GitBranch size={10} color="var(--text-dim)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Title row: indicator + text + collapse + action buttons — all inline, same height */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                height: 20,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: "20px",
                color: "var(--text)",
              }}
              title={isRunning ? `${title} · ${t("desktop.agentRunning")}` : isUnread ? `${title} · ${t("desktop.newActivity")}` : title}
            >
              {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}
              {renaming ? (
                <div
                  style={{
                    position: "relative",
                    flex: "1 1 0",
                    alignSelf: "stretch",
                    width: "100%",
                    minWidth: 0,
                    height: 20,
                    background: "color-mix(in srgb, var(--accent) 18%, var(--bg))",
                    borderRadius: 3,
                  }}
                >
                  <span
                    ref={renameMeasureRef}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      visibility: "hidden",
                      whiteSpace: "pre",
                      font: "inherit",
                      lineHeight: "inherit",
                    }}
                  >
                    {renameValue.slice(0, renameCaretIndex)}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: 2,
                      bottom: 2,
                      left: renameCaretLeft,
                      width: 2,
                      background: "var(--accent)",
                      borderRadius: 1,
                      animation: "blink 1s step-end infinite",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                  ref={inputRef}
                  value={renameValue}
                  onChange={(e) => {
                    setRenameValue(e.target.value);
                    setRenameCaretIndex(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onSelect={(e) => setRenameCaretIndex(e.currentTarget.selectionEnd ?? 0)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setRenaming(false);
                    }
                  }}
                  aria-label={t("desktop.rename")}
                  autoFocus
                  style={{
                    width: "100%",
                    minWidth: 0,
                    height: 20,
                    margin: 0,
                    padding: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    borderRadius: "inherit",
                    color: "inherit",
                    font: "inherit",
                    lineHeight: "inherit",
                    caretColor: "transparent",
                  }}
                  />
                </div>
              ) : (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                  {title}
                </span>
              )}
              {/* Collapse toggle — always visible when has children */}
              {hasChildren && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
                  title={collapsed ? t("desktop.expandForks") : t("desktop.collapseForks")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0, flexShrink: 0,
                    background: "none", border: "none",
                    color: "var(--text-dim)", cursor: "pointer",
                    transform: collapsed ? "rotate(-90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <CaretDown size={10} weight="regular" aria-hidden="true" />
                </button>
              )}
              {/* Action buttons — shown on hover */}
              {hovered && !renaming && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button
                  onClick={handleAutoName}
                  disabled={autoNaming || !hasMessages}
                  title={
                    autoNameError ??
                    (!hasMessages
                      ? t("desktop.titleNeedsMessages")
                      : autoNaming
                        ? t("desktop.generatingTitle")
                        : t("desktop.generateTitle"))
                  }
                  aria-label={t("desktop.generateTitle")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4,
                    color: autoNameError ? "#ef4444" : "var(--text-dim)",
                    cursor: autoNaming || !hasMessages ? "default" : "pointer",
                    flexShrink: 0,
                    opacity: autoNaming ? 0.7 : !hasMessages ? 0.35 : 1,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (autoNaming || !hasMessages) return;
                    e.currentTarget.style.color = autoNameError ? "#ef4444" : "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = autoNameError ? "#ef4444" : "var(--text-dim)";
                  }}
                >
                  {autoNaming ? (
                    <svg
                      style={{ animation: "spin 1s linear infinite" }}
                      width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <Sparkle size={13} weight="regular" aria-hidden="true" />
                  )}
                </button>
                <button
                  onClick={startRename}
                  title={t("desktop.rename")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4, color: "var(--text-dim)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <PencilSimple size={13} weight="regular" aria-hidden="true" />
                </button>
                <button
                  onClick={handleDeleteClick}
                  title={t("desktop.deleteWithShift")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4, color: "var(--text-dim)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ef4444";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <Trash size={13} weight="regular" aria-hidden="true" />
                </button>
                </div>
              )}
            </div>
            {/* Metadata row */}
            <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11, minWidth: 0, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
              <span title={session.modified} style={{ flexShrink: 0 }}>{formatRelativeTime(session.modified, t)}</span>
              <span style={{ flexShrink: 0 }}>{t("desktop.messagesCount", { count: session.messageCount })}</span>
              {session.worktreeBranch && (
                <span
                  title={t("desktop.worktree", { cwd: session.cwd })}
                  style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", minWidth: 0, overflow: "hidden", flex: "1 1 auto" }}
                >
                  <GitBranch size={9} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.worktreeBranch}</span>
                </span>
              )}
              {session.importedFrom && (
                <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)", minWidth: 0, overflow: "hidden", flexShrink: 1 }}>
                  <DownloadSimple size={9} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.importedFrom === "reasonix" ? (t("desktop.importFromReasonix") ?? "来自 Reasonix") : session.importedFrom}
                  </span>
                </span>
              )}
            </div>

            {/* Title-generation failure — shown as a floating bubble to the
                right of the session row (the row container clips overflow, so
                this uses fixed positioning anchored to the row's rect). */}
            {autoNameError && rowRef.current && (() => {
              const rect = rowRef.current.getBoundingClientRect();
              return (
                <div
                  style={{
                    position: "fixed",
                    top: Math.max(8, rect.top + rect.height / 2 - 34),
                    left: rect.right + 10,
                    zIndex: 3000,
                    width: 300,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--bg-panel)",
                    border: "1px solid color-mix(in srgb, #ef4444 40%, var(--border))",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                    animation: "plan-card-in 0.15s ease-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 650, color: "#ef4444", flex: 1, minWidth: 0 }}>
                      {t("desktop.titleGenerationFailed")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAutoNameError(null)}
                      aria-label={t("i18n.close")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text-muted)", wordBreak: "break-word", marginBottom: 8 }}>
                    {autoNameError}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={handleAutoName}
                      disabled={autoNaming}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "5px 10px", borderRadius: 6,
                        background: "#ef4444", border: "none",
                        color: "#fff", fontSize: 11.5, fontWeight: 600,
                        cursor: autoNaming ? "default" : "pointer",
                      }}
                    >
                      <ArrowClockwise size={11} aria-hidden="true" />
                      {t("desktop.retry")}
                    </button>
                    <button
                      type="button"
                      onClick={openTitleModelPicker}
                      disabled={titleModelSaving}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "5px 10px", borderRadius: 6,
                        background: "none", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 11.5,
                        cursor: titleModelSaving ? "default" : "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <Cpu size={11} aria-hidden="true" />
                      {t("desktop.changeTitleModel")}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Title-model picker modal */}
            {titleModelPickerOpen && (
              <div
                style={{
                  position: "fixed", inset: 0, zIndex: 3100,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.4)",
                  padding: 16,
                }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) setTitleModelPickerOpen(false); }}
              >
                <div
                  role="dialog"
                  aria-label={t("desktop.changeTitleModel")}
                  style={{
                    width: "min(420px, calc(100vw - 32px))",
                    maxHeight: "min(70vh, 480px)",
                    display: "flex", flexDirection: "column",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <Cpu size={15} aria-hidden="true" />
                    <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text)", flex: 1 }}>
                      {t("desktop.changeTitleModel")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTitleModelPickerOpen(false)}
                      aria-label={t("i18n.close")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 3, display: "flex" }}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="scroll-overlay" style={{ padding: "8px 6px", flex: 1 }}>
                    {titleModelLoading ? (
                      <div style={{ padding: "12px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loading")}</div>
                    ) : titleModelError ? (
                      <div style={{ padding: "12px 8px", fontSize: 12, color: "#ef4444" }}>
                        {t("desktop.modelsLoadFailed")}: {titleModelError}
                      </div>
                    ) : titleModels.length === 0 ? (
                      <div style={{ padding: "12px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.noModels")}</div>
                    ) : (
                      titleModelGroups.map(([provider, models]) => (
                        <div key={provider}>
                          <div style={{ padding: "6px 10px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "capitalize" }}>
                            {provider}
                          </div>
                          {models.map((model) => {
                            // Same model id can exist under several providers —
                            // key by provider+id so React never collides.
                            const modelKey = `${model.provider || "other"}\u0000${model.id}`;
                            return (
                              <button
                                key={modelKey}
                                type="button"
                                onClick={() => { void saveTitleModel(model.id); }}
                                disabled={titleModelSaving}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  width: "100%", padding: "7px 10px",
                                  background: "none", border: "none", borderRadius: 7,
                                  color: "var(--text)", fontSize: 12.5,
                                  cursor: titleModelSaving ? "default" : "pointer",
                                  textAlign: "left",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                              >
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {model.name || model.id}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

/**
 * Accordion group card for the grouped session view. Header toggles expansion
 * (chevron rotation + right-side Collapse/Expand hint), rows fade in with a
 * small stagger when the group opens.
 */
function AccordionGroup({
  groupKey, label, rows, isOpen, onToggle, onSelectSession, selectedSessionId,
  runningSessionIds, unreadSessionIds, allSessions, onPinChange, onRenamed, onSessionDeleted,
}: {
  groupKey: GroupKey;
  label: string;
  rows: SessionGroupRow[];
  isOpen: boolean;
  onToggle: () => void;
  onSelectSession: (s: SessionInfo) => void;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  allSessions: SessionInfo[];
  onPinChange?: (session: SessionInfo, pinned: boolean) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
}) {
  const { t } = useI18n();
  // All groups share the same card background — pinned is not tinted with the
  // accent color, and older groups keep the same shade as today/yesterday.
  const cardBg = "var(--bg-panel)";

  return (
    <div style={{ margin: "0 8px 6px", borderRadius: 10, background: cardBg, border: "1px solid var(--border)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "7px 10px",
          background: "none", border: "none",
          color: "var(--text)", cursor: "pointer", textAlign: "left",
        }}
      >
        <CaretDown size={11} weight="regular" aria-hidden="true" style={{ flexShrink: 0, transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
        <span style={{ background: "var(--bg-hover)", borderRadius: 999, padding: "0 6px", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", lineHeight: "16px", flexShrink: 0 }}>{rows.length}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{isOpen ? t("desktop.collapseGroup") : t("desktop.expandGroup")}</span>
      </button>
      {isOpen && (
        <div style={{ padding: "2px 4px 6px" }}>
          {rows.map((row, index) => (
            <div key={row.session.id} style={{ animation: "accordion-row-in 0.14s ease-out both", animationDelay: `${Math.min(index, 10) * 20}ms` }}>
              <SessionCompactRow
                session={row.session}
                forkDepth={row.forkDepth}
                isSelected={row.session.id === selectedSessionId}
                isRunning={runningSessionIds.has(row.session.id)}
                isUnread={unreadSessionIds.has(row.session.id)}
                onClick={() => onSelectSession(row.session)}
                allSessions={allSessions}
                onPinChange={onPinChange}
                onRenamed={onRenamed}
                onDeleted={onSessionDeleted}
                inPinnedGroup={groupKey === "pinned"}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact two-field row for the grouped view: title (line 1) + branch chip and
 * optional fork indicator (line 2). No inline time — the raw modified date is
 * exposed via the title's tooltip. Hover reveals pin / auto-name / rename /
 * delete actions.
 */
function SessionCompactRow({
  session, forkDepth = 0, isSelected, isRunning, isUnread, onClick, allSessions, onPinChange, onRenamed, onDeleted, inPinnedGroup = false,
}: {
  session: SessionInfo;
  /** Indent level for fork children — mirrors the tree view's padding. */
  forkDepth?: number;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  allSessions: SessionInfo[];
  onPinChange?: (session: SessionInfo, pinned: boolean) => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  /** True when this row renders inside the "pinned" accordion group — the
   *  persistent pin badge is redundant there, so it is hidden. */
  inPinnedGroup?: boolean;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [autoNaming, setAutoNaming] = useState(false);
  const [forkTooltip, setForkTooltip] = useState(false);
  const [forkTooltipPos, setForkTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const title = stripModeInstructionBlocks(session.name) || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const parentSession = session.parentSessionId ? allSessions.find((s) => s.id === session.parentSessionId) : undefined;

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(title);
    setRenaming(true);
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (!name || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  };

  const handleAutoName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (autoNaming || session.messageCount === 0) return;
    setAutoNaming(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/auto-name`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!res.ok || !body.title) throw new Error(body.error || `HTTP ${res.status}`);
      onRenamed?.();
    } catch {
      // ignore
    } finally {
      setAutoNaming(false);
    }
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Optimistic — the parent flips the row immediately and persists in the
    // background, so pinning feels instant instead of waiting for the fetch.
    onPinChange?.(session, !session.pinned);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) void performDelete();
    else setConfirmDelete(true);
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  };

  const showForkTooltip = (e: React.MouseEvent) => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    setForkTooltipPos({ top: rect.top + rect.height / 2 - 15, left: rect.right + 8 });
    setForkTooltip(true);
  };

  return (
    <div
      ref={rowRef}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setForkTooltip(false); }}
      style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "5px 8px 5px 10px",
        paddingLeft: 10 + forkDepth * 14,
        position: "relative",
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: 6,
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {/* Fork indent guide line — one vertical tick per depth level, aligned
          with the padding so forks read as children of the session above. */}
      {forkDepth > 0 && (
        <span aria-hidden="true" style={{ position: "absolute", left: 12 + (forkDepth - 1) * 14, top: 2, bottom: 2, width: 2, borderRadius: 1, background: "var(--border)", pointerEvents: "none" }} />
      )}
      {confirmDelete ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("desktop.deleteSession", { title: `"${title.slice(0, 22)}${title.length > 22 ? "…" : ""}"` })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button onClick={(e) => { e.stopPropagation(); void performDelete(); }} style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 11px", background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
              <Trash size={12} weight="regular" aria-hidden="true" />
              {t("desktop.delete")}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }} style={{ height: 28, padding: "0 11px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
              {t("desktop.cancel")}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Line 1: status indicator + title + hover actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, height: 20 }}>
            {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}
            {renaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                  if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
                }}
                aria-label={t("desktop.rename")}
                style={{ flex: 1, minWidth: 0, height: 18, margin: 0, padding: "0 4px", border: "1px solid var(--accent)", borderRadius: 3, outline: "none", background: "color-mix(in srgb, var(--accent) 18%, var(--bg))", color: "var(--text)", fontSize: 12 }}
              />
            ) : (
              <span title={session.modified} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1, fontSize: 12, fontWeight: isSelected ? 500 : 400, color: "var(--text)" }}>
                {title}
              </span>
            )}
            {hovered && !renaming && (
              <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
                <button
                  onClick={handlePin}
                  title={session.pinned ? t("desktop.unpin") : t("desktop.pin")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: session.pinned ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = session.pinned ? "var(--accent)" : "var(--text-muted)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = session.pinned ? "var(--accent)" : "var(--text-dim)"; }}
                >
                  <PushPin size={12} weight={session.pinned ? "fill" : "regular"} aria-hidden="true" />
                </button>
                <button
                  onClick={handleAutoName}
                  disabled={autoNaming || session.messageCount === 0}
                  title={session.messageCount === 0 ? t("desktop.titleNeedsMessages") : autoNaming ? t("desktop.generatingTitle") : t("desktop.generateTitle")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: autoNaming || session.messageCount === 0 ? "default" : "pointer", flexShrink: 0, opacity: autoNaming ? 0.7 : session.messageCount === 0 ? 0.35 : 1, transition: "color 0.12s" }}
                  onMouseEnter={(e) => { if (autoNaming || session.messageCount === 0) return; e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (autoNaming || session.messageCount === 0) return; e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  {autoNaming ? (
                    <svg style={{ animation: "spin 1s linear infinite" }} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <Sparkle size={12} weight="regular" aria-hidden="true" />
                  )}
                </button>
                <button
                  onClick={startRename}
                  title={t("desktop.rename")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <PencilSimple size={12} weight="regular" aria-hidden="true" />
                </button>
                <button
                  onClick={handleDeleteClick}
                  title={t("desktop.deleteWithShift")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <Trash size={12} weight="regular" aria-hidden="true" />
                </button>
              </div>
            )}
            {/* Persistent pin badge — shown for pinned sessions outside the
                pinned group; hidden while hovering (action buttons appear). */}
            {session.pinned && !inPinnedGroup && !hovered && (
              <span
                title={t("desktop.pinned")}
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", opacity: 0.85 }}
              >
                <PushPin size={11} weight="fill" color="var(--accent)" aria-hidden="true" />
              </span>
            )}
          </div>
          {/* Line 2: relative time · message count · git branch chip · fork indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1, minWidth: 0, height: 16, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{formatRelativeTime(session.modified, t)}</span>
            <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.messagesCount", { count: session.messageCount })}</span>
            {session.worktreeBranch && (
              <span title={session.worktreeBranch} style={{ display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "60%", background: "var(--bg-hover)", borderRadius: 4, padding: "0 5px", height: 15, minWidth: 0, overflow: "hidden" }}>
                <GitBranch size={8} weight="regular" color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", lineHeight: "15px" }}>{session.worktreeBranch}</span>
              </span>
            )}
            {session.parentSessionId && (
              <span
                style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center" }}
                onMouseEnter={showForkTooltip}
                onMouseLeave={() => setForkTooltip(false)}
              >
                <GitFork size={10} weight="regular" color="var(--text-dim)" style={{ cursor: "help" }} aria-hidden="true" />
              </span>
            )}
          </div>
          {forkTooltip && forkTooltipPos && (() => {
            const parentTitle = parentSession
              ? (stripModeInstructionBlocks(parentSession.name) || parentSession.firstMessage.slice(0, 30) || parentSession.id.slice(0, 8))
              : "";
            return (
              <div style={{ position: "fixed", top: forkTooltipPos.top, left: forkTooltipPos.left, zIndex: 3000, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", boxShadow: "0 6px 20px rgba(0,0,0,0.2)", fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap", pointerEvents: "none", animation: "plan-card-in 0.12s ease-out" }}>
                {t("desktop.forkedFrom", { title: parentTitle || "—" })}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
