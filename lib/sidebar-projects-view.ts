import type { SessionInfo } from "./types";

/**
 * Sidebar project-panel view model (侧边栏「所有项目」面板的纯函数层).
 *
 * One pass over the session list produces every layout the panel needs —
 * project folders, time-grouped accordion, flat timeline, archived list —
 * so the render layer stays branch-free. All view preferences live in
 * localStorage (per browser), while archive/hidden state lives server-side.
 *
 * `buildSessionGroups` / `orderGroupRows` were extracted from
 * SessionSidebar.tsx so the legacy per-project view and the new panel share
 * one grouping implementation.
 */

export type SidebarMode = "dropdown" | "projects";
/** "grouped" = time accordion (今天/昨天/更早); "project" = folder list;
 *  "timeline" = flat chronological list. */
export type OrganizeBy = "grouped" | "project" | "timeline";
export type SortBy = "updated" | "created";

/** Sessions shown per expanded project folder before 「显示更多」. */
export const PROJECT_PAGE_SIZE = 5;

// ─── localStorage preferences ───────────────────────────────────────────────

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const SIDEBAR_MODE_KEY = "pi-web:sidebar-mode";
export const SIDEBAR_PREFS_KEY = "pi-web:sidebar-task-preferences";
export const SIDEBAR_COLLAPSED_KEY = "pi-web:sidebar-collapsed-projects";

export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === "dropdown" || value === "projects";
}

export function isOrganizeBy(value: unknown): value is OrganizeBy {
  return value === "grouped" || value === "project" || value === "timeline";
}

export function isSortBy(value: unknown): value is SortBy {
  return value === "updated" || value === "created";
}

/**
 * 默认侧边栏形态：ZCode 风格「全部项目」面板。
 *
 * 用户指定（2026-09-02）：面板形态是主推布局，新装/无记录时直接进面板，
 * 不再从普通列表开始。已手动切过形态的用户仍按 localStorage 里的选择走。
 */
export const DEFAULT_SIDEBAR_MODE: SidebarMode = "projects";

export function loadSidebarMode(storage: StorageLike | null = getBrowserStorage()): SidebarMode {
  if (!storage) return DEFAULT_SIDEBAR_MODE;
  try {
    const value = storage.getItem(SIDEBAR_MODE_KEY);
    return isSidebarMode(value) ? value : DEFAULT_SIDEBAR_MODE;
  } catch {
    return DEFAULT_SIDEBAR_MODE;
  }
}

export function saveSidebarMode(mode: SidebarMode, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_MODE_KEY, mode);
  } catch {
    // Browser storage is best-effort.
  }
}

export interface SidebarTaskPreferences {
  organizeBy: OrganizeBy;
  sortBy: SortBy;
}

const DEFAULT_PREFS: SidebarTaskPreferences = { organizeBy: "project", sortBy: "updated" };

export function loadTaskPreferences(storage: StorageLike | null = getBrowserStorage()): SidebarTaskPreferences {
  if (!storage) return DEFAULT_PREFS;
  try {
    const raw = storage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_PREFS;
    const { organizeBy, sortBy } = parsed as Record<string, unknown>;
    return {
      organizeBy: isOrganizeBy(organizeBy) ? organizeBy : DEFAULT_PREFS.organizeBy,
      sortBy: isSortBy(sortBy) ? sortBy : DEFAULT_PREFS.sortBy,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveTaskPreferences(prefs: SidebarTaskPreferences, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Browser storage is best-effort.
  }
}

/** Collapsed project keys (projectIdentityKey values). */
export function loadCollapsedProjects(storage: StorageLike | null = getBrowserStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Set();
    return new Set(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k));
  } catch {
    return new Set();
  }
}

export function saveCollapsedProjects(keys: Set<string>, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    if (keys.size === 0) storage.removeItem(SIDEBAR_COLLAPSED_KEY);
    else storage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(Object.fromEntries([...keys].map((k) => [k, true]))));
  } catch {
    // Browser storage is best-effort.
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

export function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage?.slice(0, 50) || session.id;
}

/** Same fuzzy rule the legacy search box uses: case-insensitive substring on
 *  title or worktree branch. Empty query matches everything. */
export function sessionMatchesSearch(session: SessionInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (sessionTitle(session).toLowerCase().includes(q)) return true;
  return Boolean(session.branch?.toLowerCase().includes(q));
}

/** Stable grouping key for a session's project (server-computed when present). */
export function sessionProjectKey(session: SessionInfo): string {
  return session.projectKey ?? session.projectRoot ?? session.cwd ?? "";
}

export function sessionProjectRoot(session: SessionInfo): string {
  return session.projectRoot ?? session.cwd ?? "";
}

function compareBySort(a: SessionInfo, b: SessionInfo, sortBy: SortBy): number {
  return sortBy === "created"
    ? b.created.localeCompare(a.created)
    : b.modified.localeCompare(a.modified);
}

/** Active (non-archived) sessions matching the search, excluding hidden projects. */
export function filterVisibleSessions(
  sessions: SessionInfo[],
  options: { hiddenKeys?: Set<string>; search?: string } = {},
): SessionInfo[] {
  const { hiddenKeys, search } = options;
  return sessions.filter((s) => {
    if (s.archived) return false;
    if (hiddenKeys?.size && hiddenKeys.has(sessionProjectKey(s))) return false;
    return sessionMatchesSearch(s, search ?? "");
  });
}

// ─── Project folder view ────────────────────────────────────────────────────

export interface ProjectGroup {
  projectKey: string;
  projectRoot: string;
  name: string;
  /** Sorted active sessions of this project; EMPTY when collapsed (the caller
   *  still renders the header using totalCount/hasRunning/hasUnread). */
  sessions: SessionInfo[];
  /** Total active sessions before collapsing/paging. */
  totalCount: number;
  collapsed: boolean;
  hasRunning: boolean;
  hasUnread: boolean;
}

export interface BuildProjectGroupsInput {
  sessions: SessionInfo[];
  hiddenKeys?: Set<string>;
  /** projectRoot → display alias (from /api/project-aliases). */
  aliases?: Record<string, string>;
  sortBy: SortBy;
  collapsedKeys?: Set<string>;
  runningIds?: Set<string>;
  unreadIds?: Set<string>;
  search?: string;
  /** Project roots that must appear even with zero sessions (e.g. the
   *  currently selected project), mirroring getRecentProjects. */
  extraRoots?: string[];
}

/**
 * Group active sessions into project folders ordered by most recent activity.
 * Worktrees collapse into their main repo via projectKey/projectRoot.
 */
export function buildProjectGroups(input: BuildProjectGroupsInput): ProjectGroup[] {
  const {
    sessions, hiddenKeys, aliases = {}, sortBy,
    collapsedKeys, runningIds, unreadIds, search, extraRoots,
  } = input;
  const visible = filterVisibleSessions(sessions, { hiddenKeys, search });

  interface Bucket {
    projectRoot: string;
    sessions: SessionInfo[];
    latest: string;
  }
  const buckets = new Map<string, Bucket>();
  for (const s of visible) {
    const key = sessionProjectKey(s);
    if (!key) continue;
    const root = sessionProjectRoot(s);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { projectRoot: root, sessions: [], latest: "" };
      buckets.set(key, bucket);
    }
    bucket.sessions.push(s);
    if (s.modified > bucket.latest) bucket.latest = s.modified;
  }

  // Force-include empty projects (selected/picked roots) so they stay switchable.
  for (const root of extraRoots ?? []) {
    const key = root; // client-side fallback identity; server keys match for real sessions
    if (hiddenKeys?.has(key)) continue;
    if (!buckets.has(key)) buckets.set(key, { projectRoot: root, sessions: [], latest: "\uffff" });
  }

  const groups: ProjectGroup[] = [];
  for (const [projectKey, bucket] of buckets) {
    bucket.sessions.sort((a, b) => compareBySort(a, b, sortBy));
    const collapsed = collapsedKeys?.has(projectKey) ?? false;
    groups.push({
      projectKey,
      projectRoot: bucket.projectRoot,
      name: aliases[bucket.projectRoot]?.trim() || basenameOf(bucket.projectRoot),
      sessions: collapsed ? [] : bucket.sessions,
      totalCount: bucket.sessions.length,
      collapsed,
      hasRunning: bucket.sessions.some((s) => runningIds?.has(s.id) ?? false),
      hasUnread: bucket.sessions.some((s) => unreadIds?.has(s.id) ?? false),
    });
  }
  groups.sort((a, b) => {
    const la = latestModified(a, buckets);
    const lb = latestModified(b, buckets);
    return lb.localeCompare(la);
  });
  return groups;
}

function latestModified(group: ProjectGroup, buckets: Map<string, { latest: string }>): string {
  return buckets.get(group.projectKey)?.latest ?? "";
}

function basenameOf(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// ─── Timeline view ──────────────────────────────────────────────────────────

/** Flat chronological list across all (non-hidden, active) projects. */
export function buildTimeline(input: {
  sessions: SessionInfo[];
  hiddenKeys?: Set<string>;
  sortBy: SortBy;
  search?: string;
}): SessionInfo[] {
  const visible = filterVisibleSessions(input.sessions, { hiddenKeys: input.hiddenKeys, search: input.search });
  return visible.sort((a, b) => compareBySort(a, b, input.sortBy));
}

// ─── Time-grouped accordion (shared with the legacy per-project view) ───────

export type GroupKey = "pinned" | "today" | "yesterday" | "older";

/** One row in a grouped session view — session plus its fork depth. */
export interface SessionGroupRow {
  session: SessionInfo;
  /** Fork depth: 0 = not a fork (or flat group); 1 = direct fork of a listed session, etc. */
  forkDepth: number;
}

export interface SessionGroup {
  key: GroupKey;
  rows: SessionGroupRow[];
}

export const GROUP_LABEL_KEYS: Record<GroupKey, string> = {
  pinned: "desktop.pinned",
  today: "desktop.today",
  yesterday: "desktop.yesterday",
  older: "desktop.older",
};

/** Local-timezone YYYY-MM-DD key for a Date. */
export function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Partition sessions into Pinned / Today / Yesterday / Older accordion groups.
 * Pinned sessions are shown BOTH in the pinned group and in their original
 * time-based group (double display). `allSessions` supplies the fork parent
 * chain even when the parent lives in another group.
 */
export function buildSessionGroups(
  sessions: SessionInfo[],
  allSessions: SessionInfo[],
  sortBy: SortBy = "updated",
): SessionGroup[] {
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
      rows: orderGroupRows(groups[key], allSessions, key === "pinned", sortBy),
    }))
    .filter((g) => g.rows.length > 0);
}

/**
 * Order one group's sessions so fork children sit immediately below their
 * parent (depth-first, roots sorted by sortBy desc, children of one parent
 * sorted the same way). Computes each row's fork depth by walking the
 * parentSessionId chain in the FULL session list (parents may live in another
 * group). `flat` (pinned group) keeps the ordering but forces forkDepth to 0.
 */
export function orderGroupRows(
  sessions: SessionInfo[],
  allSessions: SessionInfo[],
  flat: boolean,
  sortBy: SortBy = "updated",
): SessionGroupRow[] {
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
  const bySortDesc = (a: SessionInfo, b: SessionInfo) => compareBySort(a, b, sortBy);
  const roots = sessions.filter((s) => !(s.parentSessionId && inGroup.has(s.parentSessionId))).sort(bySortDesc);
  for (const arr of children.values()) arr.sort(bySortDesc);

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

// ─── Archived view ──────────────────────────────────────────────────────────

/** Archived sessions (hidden projects stay hidden here too), newest archive first. */
export function buildArchived(input: {
  sessions: SessionInfo[];
  hiddenKeys?: Set<string>;
  search?: string;
}): SessionInfo[] {
  const { sessions, hiddenKeys, search } = input;
  return sessions
    .filter((s) => {
      if (!s.archived) return false;
      if (hiddenKeys?.size && hiddenKeys.has(sessionProjectKey(s))) return false;
      return sessionMatchesSearch(s, search ?? "");
    })
    .sort((a, b) => (b.archivedAt ?? b.modified).localeCompare(a.archivedAt ?? a.modified));
}
