import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  buildProjectGroups,
  buildTimeline,
  buildSessionGroups,
  buildArchived,
  filterVisibleSessions,
  sessionMatchesSearch,
  loadTaskPreferences,
  saveTaskPreferences,
  loadSidebarMode,
  saveSidebarMode,
  loadCollapsedProjects,
  saveCollapsedProjects,
  SIDEBAR_MODE_KEY,
  SIDEBAR_PREFS_KEY,
  SIDEBAR_COLLAPSED_KEY,
} = await createJiti(import.meta.url).import("./sidebar-projects-view.ts");

function session(over = {}) {
  return {
    id: over.id ?? "s-1",
    path: `/tmp/${over.id ?? "s-1"}.jsonl`,
    cwd: over.cwd ?? "/tmp/proj-a",
    projectRoot: over.projectRoot ?? over.cwd ?? "/tmp/proj-a",
    projectKey: over.projectKey ?? over.projectRoot ?? over.cwd ?? "/tmp/proj-a",
    created: over.created ?? "2026-08-01T00:00:00.000Z",
    modified: over.modified ?? "2026-08-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage: over.firstMessage ?? "hello",
    ...over,
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// ─── buildProjectGroups ─────────────────────────────────────────────────────

test("groups active sessions by project, ordered by latest activity", () => {
  const groups = buildProjectGroups({
    sessions: [
      session({ id: "a1", projectKey: "pa", projectRoot: "/tmp/proj-a", modified: "2026-08-01T00:00:00.000Z" }),
      session({ id: "b1", projectKey: "pb", projectRoot: "/tmp/proj-b", modified: "2026-08-05T00:00:00.000Z" }),
      session({ id: "b2", projectKey: "pb", projectRoot: "/tmp/proj-b", modified: "2026-08-03T00:00:00.000Z" }),
    ],
    sortBy: "updated",
  });
  assert.deepEqual(groups.map((g) => g.projectKey), ["pb", "pa"]);
  assert.equal(groups[0].totalCount, 2);
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ["b1", "b2"]);
});

test("archived and hidden projects are excluded; extraRoots still appear", () => {
  const groups = buildProjectGroups({
    sessions: [
      session({ id: "a1", projectKey: "pa" }),
      session({ id: "h1", projectKey: "ph", projectRoot: "/tmp/hidden" }),
      session({ id: "x1", projectKey: "px", projectRoot: "/tmp/archived", archived: true }),
    ],
    hiddenKeys: new Set(["ph"]),
    sortBy: "updated",
    extraRoots: ["/tmp/empty"],
  });
  assert.deepEqual(groups.map((g) => g.projectKey).sort(), ["/tmp/empty", "pa"]);
  const empty = groups.find((g) => g.projectKey === "/tmp/empty");
  assert.equal(empty.totalCount, 0);
});

test("collapsed groups keep counts but drop rows; running/unread roll up", () => {
  const groups = buildProjectGroups({
    sessions: [
      session({ id: "a1", projectKey: "pa" }),
      session({ id: "a2", projectKey: "pa" }),
    ],
    sortBy: "updated",
    collapsedKeys: new Set(["pa"]),
    runningIds: new Set(["a2"]),
    unreadIds: new Set(["a1"]),
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].collapsed, true);
  assert.deepEqual(groups[0].sessions, []);
  assert.equal(groups[0].totalCount, 2);
  assert.equal(groups[0].hasRunning, true);
  assert.equal(groups[0].hasUnread, true);
});

test("sortBy created orders sessions by creation time", () => {
  const groups = buildProjectGroups({
    sessions: [
      session({ id: "new", projectKey: "p", created: "2026-08-10T00:00:00.000Z", modified: "2026-08-01T00:00:00.000Z" }),
      session({ id: "old", projectKey: "p", created: "2026-08-02T00:00:00.000Z", modified: "2026-08-20T00:00:00.000Z" }),
    ],
    sortBy: "created",
  });
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ["new", "old"]);
});

test("search filters by title substring and branch", () => {
  const groups = buildProjectGroups({
    sessions: [
      session({ id: "a", projectKey: "p", firstMessage: "修复登录问题" }),
      session({ id: "b", projectKey: "p", firstMessage: "部署服务", branch: "feature/x" }),
    ],
    sortBy: "updated",
    search: "登录",
  });
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ["a"]);
  const byBranch = buildProjectGroups({
    sessions: [session({ id: "b", projectKey: "p", branch: "feature/x" })],
    sortBy: "updated",
    search: "FEATURE/X",
  });
  assert.equal(byBranch[0].totalCount, 1);
});

// ─── timeline / archived / filter ───────────────────────────────────────────

test("buildTimeline flattens non-hidden active sessions sorted", () => {
  const list = buildTimeline({
    sessions: [
      session({ id: "a", projectKey: "pa", modified: "2026-08-01T00:00:00.000Z" }),
      session({ id: "b", projectKey: "pb", modified: "2026-08-09T00:00:00.000Z" }),
      session({ id: "h", projectKey: "ph", modified: "2026-08-10T00:00:00.000Z" }),
      session({ id: "x", projectKey: "pa", archived: true }),
    ],
    hiddenKeys: new Set(["ph"]),
    sortBy: "updated",
  });
  assert.deepEqual(list.map((s) => s.id), ["b", "a"]);
});

test("buildArchived returns only archived, newest archive first", () => {
  const list = buildArchived({
    sessions: [
      session({ id: "old", archived: true, archivedAt: "2026-08-01T00:00:00.000Z" }),
      session({ id: "new", archived: true, archivedAt: "2026-08-20T00:00:00.000Z" }),
      session({ id: "live" }),
    ],
  });
  assert.deepEqual(list.map((s) => s.id), ["new", "old"]);
});

test("filterVisibleSessions drops archived/hidden/non-matching", () => {
  const kept = filterVisibleSessions(
    [session({ id: "a" }), session({ id: "b", archived: true }), session({ id: "c", projectKey: "ph" })],
    { hiddenKeys: new Set(["ph"]), search: "" },
  );
  assert.deepEqual(kept.map((s) => s.id), ["a"]);
});

test("sessionMatchesSearch treats blank query as match-all", () => {
  assert.equal(sessionMatchesSearch(session(), "   "), true);
});

// ─── grouped accordion ──────────────────────────────────────────────────────

test("buildSessionGroups partitions by local day and double-shows pinned", () => {
  const now = new Date();
  const iso = (offsetDays) => new Date(now.getTime() - offsetDays * 86400000).toISOString();
  const sessions = [
    session({ id: "t", modified: iso(0) }),
    session({ id: "y", modified: iso(1) }),
    session({ id: "o", modified: iso(30) }),
    session({ id: "p", modified: iso(0), pinned: true }),
  ];
  const groups = buildSessionGroups(sessions, sessions);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g.rows.map((r) => r.session.id)]));
  assert.deepEqual(byKey.pinned, ["p"]);
  assert.deepEqual(byKey.today.sort(), ["p", "t"]);
  assert.deepEqual(byKey.yesterday, ["y"]);
  assert.deepEqual(byKey.older, ["o"]);
});

test("fork children nest under parents with depth", () => {
  const parent = session({ id: "P", modified: "2026-08-05T00:00:00.000Z" });
  const child = session({ id: "C", parentSessionId: "P", modified: "2026-08-04T00:00:00.000Z" });
  const groups = buildSessionGroups([parent, child], [parent, child]);
  const rows = groups.find((g) => g.key !== "pinned").rows;
  assert.deepEqual(rows.map((r) => [r.session.id, r.forkDepth]), [["P", 0], ["C", 1]]);
});

// ─── preferences ────────────────────────────────────────────────────────────

test("mode/prefs/collapsed round-trip through storage", () => {
  const storage = fakeStorage();
  // 默认即 ZCode 项目面板（用户指定 2026-09-02）；显式存 dropdown 才回列表
  assert.equal(loadSidebarMode(storage), "projects");
  saveSidebarMode("dropdown", storage);
  assert.equal(loadSidebarMode(storage), "dropdown");
  saveSidebarMode("projects", storage);
  assert.equal(loadSidebarMode(storage), "projects");
  assert.ok(storage._map.get(SIDEBAR_MODE_KEY) === "projects");

  assert.deepEqual(loadTaskPreferences(storage), { organizeBy: "project", sortBy: "updated" });
  saveTaskPreferences({ organizeBy: "grouped", sortBy: "created" }, storage);
  assert.deepEqual(loadTaskPreferences(storage), { organizeBy: "grouped", sortBy: "created" });

  assert.equal(loadCollapsedProjects(storage).size, 0);
  saveCollapsedProjects(new Set(["pa", "pb"]), storage);
  assert.deepEqual([...loadCollapsedProjects(storage)].sort(), ["pa", "pb"]);
  saveCollapsedProjects(new Set(), storage);
  assert.equal(storage._map.has(SIDEBAR_COLLAPSED_KEY), false);
});

test("invalid stored values fall back to defaults", () => {
  const storage = fakeStorage();
  storage.setItem(SIDEBAR_MODE_KEY, "bogus");
  storage.setItem(SIDEBAR_PREFS_KEY, "{oops");
  storage.setItem(SIDEBAR_COLLAPSED_KEY, "[1,2]");
  assert.equal(loadSidebarMode(storage), "projects");
  assert.deepEqual(loadTaskPreferences(storage), { organizeBy: "project", sortBy: "updated" });
  assert.equal(loadCollapsedProjects(storage).size, 0);
});

test("partial prefs object keeps valid fields and defaults the rest", () => {
  const storage = fakeStorage();
  storage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify({ sortBy: "created" }));
  assert.deepEqual(loadTaskPreferences(storage), { organizeBy: "project", sortBy: "created" });
});
