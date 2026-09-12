/**
 * Relay page: pairing, transport, home, and chat.
 *
 * The phone talks to the relay over one WebSocket; everything else goes through
 * the HTTP tunnel frames on that socket, so the desktop stays behind NAT.
 *
 * Layout follows ZCode's remote shell: projects are cards that expand to reveal
 * their sessions, with a collapse-all control and a switch between grouping by
 * project and by timeline. Message rendering has two switchable modes — ZCode's
 * colour-coded trajectory, or pi-web's folded process groups.
 */

const PROTOCOL_VERSION = 1;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const REQUEST_TIMEOUT_MS = 30_000;
/** A run can take a while, and its event stream stays open for the whole of it. */
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

const SESSION_KEY = "piweb_relay_session";
const MID_KEY = "piweb_relay_mid";
const EXPANDED_KEY = "piweb_relay_expanded";
const ORGANIZE_KEY = "piweb_relay_organize";
const SORT_KEY = "piweb_relay_sort";
const VIEW_MODE_KEY = "piweb_relay_view_mode";
const THEME_KEY = "piweb_relay_theme";
/** Projects expanded on a device we have not seen before. */
const DEFAULT_EXPANDED_PROJECTS = 2;

const $ = (id) => document.getElementById(id);

const ERROR_TEXT = {
  relayUnavailable: "中继暂时不可达，请稍后重试。",
  sessionExpired: "配对二维码已过期，请在桌面端重新生成。",
  sessionNotFound: "配对信息无效，请在桌面端重新扫码。",
  kicked: "该配对已被吊销或已使用，请在桌面端重新生成二维码。",
  desktopDisconnected: "桌面端已断开，请确认 Pi Web 正在运行。",
  invalidMobileConnection: "连接参数无效，请重新扫码。",
};

function tokenFromPath() {
  const match = /^\/r\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function deviceMidFromQuery() {
  return new URLSearchParams(window.location.search).get("mid") ?? "";
}

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

// ── Session credential ──────────────────────────────────────────────────────

/** Persist the durable credential so a reload does not need a fresh QR scan. */
function storeSession(session) {
  writeStore(SESSION_KEY, session);
  writeStore(MID_KEY, deviceMidFromQuery());
  // `/web/` is served by ordinary browser requests, which cannot present a
  // localStorage value — the credential has to be a cookie too.
  document.cookie = `${SESSION_KEY}=${encodeURIComponent(session)}; path=/; SameSite=Lax; max-age=2592000`;
}

function storedSession() {
  return { session: readStore(SESSION_KEY) ?? "", mid: readStore(MID_KEY) ?? "" };
}

// ── Tunnel ──────────────────────────────────────────────────────────────────

/**
 * HTTP requests over the WebSocket.
 *
 * SSE bodies arrive incrementally as chunks; `onChunk` fires before the request
 * settles so text can render as it streams.
 */
class Tunnel {
  constructor(socket) {
    this.socket = socket;
    this.nextRid = 1;
    this.pending = new Map();
  }

  request({ method = "GET", path, headers = {}, body, onHead, onChunk, timeoutMs = REQUEST_TIMEOUT_MS }) {
    const rid = String(this.nextRid++);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error("请求超时"));
      }, timeoutMs);
      this.pending.set(rid, { resolve, reject, onHead, onChunk, timer });
    });
    // The id travels with the promise so a caller can detach a stream later.
    promise.rid = rid;
    this.socket.send(JSON.stringify({ type: "http_request", rid, method, path, headers, body }));
    return promise;
  }

  /** Stop listening to a streamed request without failing it. */
  detach(rid) {
    const entry = this.pending.get(String(rid));
    if (entry) entry.onChunk = null;
  }

  handle(frame) {
    const entry = this.pending.get(String(frame.rid));
    if (!entry) return;
    if (frame.type === "http_response_head") {
      entry.status = frame.status;
      entry.headers = frame.headers ?? {};
      entry.onHead?.(frame.status, entry.headers);
      return;
    }
    if (frame.type === "http_response_chunk") {
      const text = frame.encoding === "base64"
        ? new TextDecoder().decode(Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0)))
        : String(frame.data ?? "");
      entry.body = (entry.body ?? "") + text;
      entry.onChunk?.(text);
      return;
    }
    if (frame.type === "http_response_end") {
      clearTimeout(entry.timer);
      this.pending.delete(String(frame.rid));
      entry.resolve({ status: entry.status ?? 0, headers: entry.headers ?? {}, body: entry.body ?? "" });
    }
  }

  failAll(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

// ── State ───────────────────────────────────────────────────────────────────

const state = {
  socket: null,
  tunnel: null,
  attempt: 0,
  stopped: false,
  connected: false,
  resuming: false,
  sessions: [],
  runningIds: new Set(),
  current: null,
  streamRid: null,
  organize: readStore(ORGANIZE_KEY) === "timeline" ? "timeline" : "project",
  sort: readStore(SORT_KEY) === "created" ? "created" : "updated",
  query: "",
  expanded: new Set(),
  expandedLoaded: false,
  defaultsApplied: false,
  viewMode: readStore(VIEW_MODE_KEY) === "trajectory" ? "trajectory" : "folded",
  theme: readStore(THEME_KEY) ?? "system",
};

/** Build an SVG icon reference from the sprite in index.html. */
function icon(name, extraClass = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", extraClass ? `icon ${extraClass}` : "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Apply the saved theme; "system" follows the OS preference. */
function applyTheme() {
  const root = document.documentElement;
  const effective = state.theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.theme;
  root.dataset.theme = effective;
  if (state.theme === "system") delete root.dataset.themeMode;
  else root.dataset.themeMode = state.theme;
}

function setTheme(next) {
  state.theme = next;
  writeStore(THEME_KEY, next);
  applyTheme();
  renderThemeMenu();
}

/** Theme switcher in the top bar, mirroring ZCode's theme menu. */
function renderThemeSlot(slotId) {
  const slot = $(slotId);
  if (!slot) return;
  slot.replaceChildren();
  slot.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.title = "选择主题";
  button.setAttribute("aria-label", "选择主题");
  const current = state.theme === "system" ? "monitor" : state.theme === "dark" ? "moon" : "sun";
  button.append(icon(current));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const existing = slot.querySelector(".theme-menu");
    if (existing) { existing.remove(); return; }
    slot.append(buildThemeMenu());
  });
  slot.append(button);
}

function buildThemeMenu() {
  const menu = document.createElement("div");
  menu.className = "menu theme-menu";
  const options = [
    { value: "light", label: "浅色", icon: "sun" },
    { value: "dark", label: "深色", icon: "moon" },
    { value: "system", label: "跟随系统", icon: "monitor" },
  ];
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    if (state.theme === option.value) item.classList.add("is-active");
    item.append(icon(option.icon));
    const label = document.createElement("span");
    label.textContent = option.label;
    item.append(label);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      setTheme(option.value);
    });
    menu.append(item);
  }
  return menu;
}

function renderThemeMenu() {
  renderThemeSlot("home-theme");
  renderThemeSlot("chat-theme");
}

function show(view) {
  for (const id of ["view-home", "view-chat", "view-status"]) {
    $(id).classList.toggle("hidden", id !== view);
  }
}

function showStatus(title, detail, isError) {
  show("view-status");
  $("status-title").textContent = title;
  $("status-detail").textContent = detail ?? "";
  $("status-error").classList.toggle("hidden", !isError);
}

function parseJson(response) {
  try { return JSON.parse(response.body); } catch { return null; }
}

// ── Expanded-project memory ─────────────────────────────────────────────────

function loadExpanded() {
  if (state.expandedLoaded) return;
  state.expandedLoaded = true;
  const raw = readStore(EXPANDED_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) state.expanded = new Set(parsed);
  } catch { /* fall through to defaults */ }
}

function saveExpanded() {
  writeStore(EXPANDED_KEY, JSON.stringify([...state.expanded]));
}

/**
 * Expand the most recently active projects on a device we have not seen.
 *
 * Runs once per device, tracked by its own flag: doing it whenever the set
 * happens to be empty made collapsing every project re-expand the first two on
 * the next tap.
 */
function applyDefaultExpansion(groups) {
  if (state.defaultsApplied) return;
  state.defaultsApplied = true;
  const recent = [...groups.entries()]
    .sort((a, b) => latestTime(b[1]) - latestTime(a[1]))
    .slice(0, DEFAULT_EXPANDED_PROJECTS);
  for (const [project] of recent) state.expanded.add(project);
  saveExpanded();
}

// ── Session helpers ─────────────────────────────────────────────────────────

/** pi-web stores ISO strings in `modified`/`created`. */
function sessionTime(session) {
  const ms = Date.parse(session.modified ?? session.created ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

function createdTime(session) {
  const ms = Date.parse(session.created ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

function latestTime(sessions) {
  return sessions.reduce((max, session) => Math.max(max, sessionTime(session)), 0);
}

function projectKey(session) {
  if (session.relation?.kind === "subagent") return "__subagents__";
  return session.projectRoot || session.cwd || "(未知项目)";
}

function projectLabel(project) {
  if (project === "__subagents__") return "子代理";
  return project.split("/").filter(Boolean).pop() || project;
}

/**
 * A session's display title.
 *
 * pi writes the literal placeholder "(no messages)" into `firstMessage` for an
 * empty session, so showing that field blindly surfaces it as a title. An empty
 * session should read as a new session instead.
 */
function sessionLabel(session) {
  const first = (session.firstMessage ?? "").trim();
  const usable = first && !/^\(no messages\)$/i.test(first) ? first : "";
  return session.name || usable || "新会话";
}

function timeAgo(value) {
  const ms = typeof value === "number" ? value : Date.parse(value ?? "");
  if (!Number.isFinite(ms) || ms === 0) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

// ── Data ────────────────────────────────────────────────────────────────────

async function loadHome() {
  setHomeStatus("正在加载…");
  const [sessionsResponse, runningResponse] = await Promise.all([
    state.tunnel.request({ path: "/api/sessions" }),
    state.tunnel.request({ path: "/api/agent/running" }).catch(() => null),
  ]);
  const data = parseJson(sessionsResponse);
  if (!data || !Array.isArray(data.sessions)) {
    setHomeStatus("无法加载会话");
    return;
  }
  // Archived sessions are hidden from the sidebar; the phone should match.
  state.sessions = data.sessions.filter((session) => !session.archived);
  const running = runningResponse ? parseJson(runningResponse) : null;
  state.runningIds = new Set(Array.isArray(running?.runningSessionIds) ? running.runningSessionIds : []);
  renderHome();
  setHomeStatus("已连接到桌面端");
}

/** Sessions matching the search box, in the chosen sort order. */
function visibleSessions() {
  const query = state.query.trim().toLowerCase();
  const filtered = query
    ? state.sessions.filter((session) => {
      const title = sessionLabel(session).toLowerCase();
      const project = projectKey(session).toLowerCase();
      return title.includes(query) || project.includes(query);
    })
    : state.sessions;
  const key = state.sort === "created" ? createdTime : sessionTime;
  return [...filtered].sort((a, b) => key(b) - key(a));
}

// ── Home rendering ──────────────────────────────────────────────────────────

function renderHome() {
  loadExpanded();
  const body = $("home-body");
  body.replaceChildren();

  const sessions = visibleSessions();
  if (sessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state.query
      ? "没有匹配的会话。"
      : "暂无会话。在桌面端新建一个会话后回到这里刷新。";
    body.append(empty);
    return;
  }

  body.append(state.organize === "project" ? buildProjectsView(sessions) : buildTimelineView(sessions));
}

function buildProjectsView(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = projectKey(session);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  applyDefaultExpansion(groups);

  const container = document.createElement("div");
  const sortKey = state.sort === "created" ? createdTime : sessionTime;
  container.append(buildSectionHead(groups.size, sessions.length, true));

  const list = document.createElement("div");
  list.className = "list";
  const ordered = [...groups.entries()].sort((a, b) => (
    Math.max(...b[1].map(sortKey)) - Math.max(...a[1].map(sortKey))
  ));
  for (const [project, projectSessions] of ordered) {
    list.append(buildProjectGroup(project, projectSessions));
  }
  container.append(list);
  return container;
}

function buildSectionHead(projectCount, sessionCount, showCollapseAll) {
  const head = document.createElement("div");
  head.className = "section-head";

  const left = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "当前设备上的项目与会话";
  const summary = document.createElement("p");
  summary.textContent = state.organize === "project"
    ? `${projectCount} 个项目 · ${sessionCount} 个会话`
    : `${sessionCount} 个会话（按时间线）`;
  left.append(title, summary);

  const actions = document.createElement("div");
  actions.className = "section-actions";

  // ZCode only offers collapse-all in the grouped view; there is nothing to
  // expand or collapse in a flat timeline.
  if (showCollapseAll) {
    const collapse = state.expanded.size > 0;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "icon-btn";
    toggle.title = collapse ? "收起全部项目" : "展开全部项目";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.append(icon(collapse ? "chevrons-down-up" : "chevrons-up-down"));
    toggle.addEventListener("click", () => {
      if (state.expanded.size > 0) {
        state.expanded.clear();
      } else {
        for (const session of state.sessions) state.expanded.add(projectKey(session));
      }
      // An explicit choice, so the one-time default must not fire again.
      state.defaultsApplied = true;
      saveExpanded();
      renderHome();
    });
    actions.append(toggle);
  }

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "icon-btn";
  refresh.title = "刷新项目与会话";
  refresh.setAttribute("aria-label", "刷新项目与会话");
  refresh.append(icon("rotate-cw"));
  refresh.addEventListener("click", () => {
    void loadHome().catch(() => setHomeStatus("刷新失败"));
  });
  actions.append(refresh);

  // Hand off to the full pi-web UI. Kept in the section header rather than the
  // top bar so the bar matches ZCode's (title + theme menu only).
  const openApp = document.createElement("button");
  openApp.type = "button";
  openApp.className = "icon-btn";
  openApp.title = "打开完整界面";
  openApp.setAttribute("aria-label", "打开完整界面");
  openApp.append(icon("maximize"));
  openApp.addEventListener("click", () => goToFullApp());
  actions.append(openApp);

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "icon-btn";
  menuButton.title = "整理任务";
  menuButton.setAttribute("aria-label", "整理任务");
  menuButton.append(icon("sliders"));

  const menu = document.createElement("div");
  menu.className = "menu hidden";
  menu.append(
    menuSection("整理方式", [
      { label: "按项目", value: "project", group: "organize" },
      { label: "按时间线", value: "timeline", group: "organize" },
    ]),
    menuSection("排序方式", [
      { label: "更新时间", value: "updated", group: "sort" },
      { label: "创建时间", value: "created", group: "sort" },
    ]),
  );

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.classList.toggle("hidden");
  });
  // Anywhere else dismisses the menu, including another tap on the page.
  document.addEventListener("click", () => menu.classList.add("hidden"));

  actions.append(menuButton, menu);
  head.append(left, actions);
  return head;
}

function menuSection(title, options) {
  const section = document.createElement("div");
  section.className = "menu-section";
  const label = document.createElement("div");
  label.className = "menu-label";
  label.textContent = title;
  section.append(label);
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    const active = state[option.group] === option.value;
    if (active) item.classList.add("is-active");
    const label = document.createElement("span");
    label.textContent = option.label;
    item.append(label);
    if (active) item.append(icon("chevron-right", "menu-check"));
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state[option.group] = option.value;
      writeStore(option.group === "organize" ? ORGANIZE_KEY : SORT_KEY, option.value);
      renderHome();
    });
    section.append(item);
  }
  return section;
}

function buildProjectGroup(project, sessions) {
  const wrapper = document.createElement("div");
  wrapper.className = "group";

  const expanded = state.expanded.has(project);

  // The card is a div, not a button: it hosts a "new session" action, and a
  // button inside a button is invalid and swallows the inner click.
  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-expanded", String(expanded));

  const row = document.createElement("div");
  row.className = "card-row";

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = projectLabel(project);

  const meta = document.createElement("span");
  meta.className = "card-meta";
  const runningCount = sessions.filter((s) => state.runningIds.has(s.id)).length;
  if (runningCount > 0) {
    const badge = document.createElement("span");
    badge.className = "badge badge-live";
    badge.textContent = `${runningCount} 运行中`;
    meta.append(badge);
  }
  const count = document.createElement("span");
  count.textContent = `${sessions.length} 个会话`;
  // A chevron that rotates on expand, rather than swapping glyphs — matches how
  // the desktop list signals the same state change.
  const chevron = document.createElement("span");
  chevron.className = expanded ? "chevron-icon is-open" : "chevron-icon";
  chevron.append(icon("chevron-right"));
  meta.append(count, chevron);

  row.append(title, meta);
  card.append(row);

  const path = document.createElement("span");
  path.className = "card-path";
  path.textContent = project === "__subagents__" ? "由子代理运行产生" : project;
  card.append(path);

  const updated = document.createElement("span");
  updated.className = "card-path";
  updated.textContent = `更新于 ${timeAgo(new Date(latestTime(sessions)).toISOString())}`;
  card.append(updated);

  // Start a session here — ZCode puts the same affordance on each workspace
  // card (onStartDraftInWorkspace) rather than only in a global bar.
  const newSession = document.createElement("button");
  newSession.type = "button";
  newSession.className = "icon-btn card-action";
  newSession.title = `在「${projectLabel(project)}」新建会话`;
  newSession.setAttribute("aria-label", newSession.title);
  newSession.append(icon("plus"));
  newSession.addEventListener("click", (event) => {
    event.stopPropagation();
    void startNewSession(project);
  });
  card.append(newSession);

  const toggle = () => {
    if (state.expanded.has(project)) state.expanded.delete(project);
    else state.expanded.add(project);
    state.defaultsApplied = true;
    saveExpanded();
    renderHome();
  };
  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  });

  wrapper.append(card);

  if (expanded) {
    const list = document.createElement("ul");
    list.className = "sessions";
    if (sessions.length === 0) {
      const none = document.createElement("li");
      none.className = "empty";
      none.textContent = "这个项目暂无会话";
      list.append(none);
    } else {
      const ordered = [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a));
      for (const session of ordered) list.append(sessionRow(session));
    }
    // A trailing action keeps "new session" reachable when the list is long.
    const addRow = document.createElement("li");
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "session-row session-row-new";
    addButton.append(icon("plus"));
    const addLabel = document.createElement("span");
    addLabel.className = "session-main";
    const addTitle = document.createElement("span");
    addTitle.className = "session-title";
    addTitle.textContent = "新建会话";
    addLabel.append(addTitle);
    addButton.append(addLabel);
    addButton.addEventListener("click", () => { void startNewSession(project); });
    addRow.append(addButton);
    list.append(addRow);
    wrapper.append(list);
  }

  return wrapper;
}

/**
 * Create an empty session in a project and open it.
 *
 * `ensure_session` creates the session without sending a prompt, so the user
 * lands in an empty conversation ready to type — the same flow as the desktop
 * sidebar's "new session in this project".
 */
async function startNewSession(project) {
  if (project === "__subagents__") return;
  showLoading(true);
  try {
    const response = await state.tunnel.request({
      method: "POST",
      path: "/api/agent/new",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: project, type: "ensure_session" }),
    });
    const data = parseJson(response);
    if (!response.status || response.status >= 400 || !data?.sessionId) {
      setHomeStatus(data?.error ? `新建失败：${data.error}` : "新建会话失败");
      return;
    }
    // Refresh so the new session appears in the list once it has content.
    await loadHome().catch(() => {});
    const created = state.sessions.find((session) => session.id === data.sessionId);
    await openChat(created ?? {
      id: data.sessionId,
      cwd: project,
      projectRoot: project,
      name: "新会话",
      firstMessage: "",
      messageCount: 0,
    });
  } catch (error) {
    setHomeStatus(`新建失败：${error.message}`);
  } finally {
    showLoading(false);
  }
}

function buildTimelineView(sessions) {
  const container = document.createElement("div");
  container.append(buildSectionHead(0, sessions.length, false));
  const list = document.createElement("ul");
  list.className = "sessions sessions-flat";
  for (const session of sessions) list.append(sessionRow(session, true));
  container.append(list);
  return container;
}

/** One session row; `withProject` adds the project name for the flat timeline. */
function setHomeStatus(text) {
  $("home-status").textContent = text;
}

function sessionRow(session, withProject = false) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-row";

  const status = document.createElement("span");
  status.className = "session-status";
  if (state.runningIds.has(session.id)) status.classList.add("is-running");

  const main = document.createElement("span");
  main.className = "session-main";
  const title = document.createElement("span");
  title.className = "session-title";
  title.textContent = sessionLabel(session);
  const sub = document.createElement("span");
  sub.className = "session-sub";
  sub.textContent = [
    withProject ? projectLabel(projectKey(session)) : null,
    session.relation?.kind === "subagent" ? "子代理" : null,
    session.messageCount ? `${session.messageCount} 条` : null,
    timeAgo(session.modified),
  ].filter(Boolean).join(" · ");
  main.append(title, sub);

  button.append(status, main);

  if (state.runningIds.has(session.id)) {
    const badge = document.createElement("span");
    badge.className = "badge badge-live";
    badge.textContent = "运行中";
    button.append(badge);
  }

  button.addEventListener("click", () => { void openChat(session); });
  item.append(button);
  return item;
}

// ── Chat ────────────────────────────────────────────────────────────────────

async function openChat(session) {
  state.current = session;
  state.streamCarry = "";
  show("view-chat");
  $("chat-title").textContent = sessionLabel(session);
  $("chat-branch").textContent = "";
  $("chat-messages").replaceChildren();
  $("chat-input").value = "";
  setSendMode("send");
  renderPane(session);
  showLoading(true);
  try {
    await Promise.all([loadContext(session), loadModels()]);
  } finally {
    showLoading(false);
  }
}

function renderPane(session) {
  const pane = $("pane-body");
  pane.replaceChildren();
  const rows = [
    ["项目", projectLabel(projectKey(session))],
    ["目录", session.cwd ?? "—"],
    ["消息", session.messageCount ? `${session.messageCount} 条` : "—"],
    ["创建", session.created ? new Date(session.created).toLocaleString() : "—"],
    ["更新", session.modified ? new Date(session.modified).toLocaleString() : "—"],
    ["会话 ID", session.id ?? "—"],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "pane-kv";
    const left = document.createElement("span");
    left.textContent = label;
    const right = document.createElement("span");
    right.textContent = value;
    row.append(left, right);
    pane.append(row);
  }
}

async function loadContext(session) {
  const response = await state.tunnel.request({
    path: `/api/sessions/${encodeURIComponent(session.id)}/context`,
  });
  const data = parseJson(response);
  // messages live under `context`, not at the top level.
  const messages = Array.isArray(data?.context?.messages) ? data.context.messages : [];
  renderMessages(messages);
}

function renderMessages(messages) {
  const container = $("chat-messages");
  container.replaceChildren();
  if (state.viewMode === "trajectory") renderTrajectory(container, messages);
  else renderFolded(container, messages);
  scrollToBottom();
}

function scrollToBottom() {
  const container = $("chat-scroll");
  container.scrollTop = container.scrollHeight;
}

/** Split an assistant turn's blocks by kind, keeping their original order. */
function blocksOf(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === "object");
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function thinkingOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking)
    .join("\n");
}

function toolCallsOf(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && block.type === "toolCall");
}

/** Result text for a tool call, tolerating either shape pi stores. */
function toolResultText(result) {
  if (!result) return "";
  const text = textOf(result.content);
  if (text) return text;
  if (typeof result.content === "string") return result.content;
  return JSON.stringify(result.content ?? {}, null, 2);
}

/**
 * Index every tool result in the transcript by its tool call id.
 *
 * Results arrive as their own `toolResult` messages, so a call and its output
 * are only connected through `toolCallId`; without this index the output would
 * never be shown.
 */
function indexToolResults(messages) {
  const byId = new Map();
  for (const message of messages) {
    if (!message || message.role !== "toolResult") continue;
    if (typeof message.toolCallId === "string") byId.set(message.toolCallId, message);
  }
  return byId;
}

// ── Shared pieces (both view modes use the same surfaces) ───────────────────

/**
 * Render a message body as Markdown.
 *
 * Assistant output is Markdown (lists, inline code, emphasis) and ZCode shows
 * it rendered, so plain text would lose the structure. The HTML goes through an
 * allowlist rather than being injected raw: the text is model output, and this
 * page shares an origin with the relay.
 */
function renderMarkdown(target, text) {
  const marked = window.marked;
  if (!marked || typeof marked.parse !== "function") {
    target.textContent = text;
    return;
  }
  let html;
  try {
    html = marked.parse(text, { breaks: true, gfm: true });
  } catch {
    target.textContent = text;
    return;
  }
  target.innerHTML = sanitizeHtml(html);
}

/** Strip anything executable from rendered HTML, keeping the markdown tags. */
function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set([
    "P", "BR", "HR", "EM", "STRONG", "DEL", "CODE", "PRE", "BLOCKQUOTE",
    "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "SPAN",
  ]);
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!allowed.has(child.tagName)) {
        // Unwrap an unknown element rather than dropping its text.
        child.replaceWith(...child.childNodes);
        walk(node);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        if (child.tagName === "A" && name === "href") {
          // Only http(s) survives, which also rules out javascript: URLs.
          if (!/^https?:/i.test(attr.value)) child.removeAttribute("href");
          else {
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noreferrer noopener");
          }
          continue;
        }
        child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  walk(template.content);
  return template.innerHTML;
}

/**
 * The action row under a turn: copy plus the turn's timestamp.
 *
 * ZCode also shows like/dislike/fork here; those need endpoints this relay does
 * not expose, so only actions that actually work are rendered.
 */
function messageActions(text, timestamp) {
  const row = document.createElement("div");
  row.className = "msg-actions";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "msg-action";
  copy.title = "复制";
  copy.setAttribute("aria-label", "复制");
  copy.append(icon("copy"));
  copy.addEventListener("click", () => {
    Promise.resolve(navigator.clipboard?.writeText(text)).then(() => {
      copy.replaceChildren(icon("check"));
      setTimeout(() => copy.replaceChildren(icon("copy")), 1200);
    }).catch(() => {});
  });
  row.append(copy);

  if (timestamp) {
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = timestamp;
    row.append(time);
  }
  return row;
}

/** Short clock label for a message timestamp, or "" when unknown. */
function clockOf(timestamp) {
  const ms = typeof timestamp === "number" ? timestamp : Date.parse(timestamp ?? "");
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A user turn: full-width card, left aligned, top-right corner eased. */
function userCard(text, timestamp) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-user";
  const body = document.createElement("div");
  body.className = "msg-body";
  renderMarkdown(body, text);
  wrapper.append(body, messageActions(text, clockOf(timestamp)));
  return wrapper;
}

/** Assistant prose: plain text, no bubble — ZCode renders it as prose. */
function assistantText(text, timestamp) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-assistant";
  const body = document.createElement("div");
  body.className = "msg-body";
  renderMarkdown(body, text);
  wrapper.append(body, messageActions(text, clockOf(timestamp)));
  return wrapper;
}

/**
 * A reasoning block: bare summary text when collapsed, and when opened a thin
 * left rule over dimmed, height-capped text — matching ZCode's treatment.
 */
function reasoningBlock(thinking, { open = false } = {}) {
  const details = document.createElement("details");
  details.className = "reasoning";
  if (open) details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = "思考";

  const body = document.createElement("div");
  body.className = "reasoning-body";
  body.textContent = thinking;

  details.append(summary, body);
  return details;
}

/**
 * A tool call: borderless summary row, with the payload and its result inside
 * a card once expanded.
 */
function toolBlock(call, result) {
  const details = document.createElement("details");
  details.className = "tool";

  const summary = document.createElement("summary");
  const kind = document.createElement("span");
  kind.className = "tool-kind";
  kind.textContent = "工具";
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = call.toolName ?? "unknown";
  summary.append(kind, name);

  const card = document.createElement("div");
  card.className = "tool-card";
  const input = document.createElement("pre");
  input.textContent = JSON.stringify(call.input ?? {}, null, 2);
  card.append(input);

  // The output is the reason to expand a tool row, so it lives inside.
  if (result) {
    const resultBlock = document.createElement("div");
    resultBlock.className = result.isError ? "tool-result is-error" : "tool-result";
    const label = document.createElement("span");
    label.className = "tool-result-label";
    label.textContent = result.isError ? "结果 · 失败" : "结果";
    const output = document.createElement("pre");
    output.textContent = toolResultText(result).slice(0, 8000);
    const resultCard = document.createElement("div");
    resultCard.className = "tool-card";
    resultCard.append(label, output);
    details.append(summary, card, resultCard);
    return details;
  }

  details.append(summary, card);
  return details;
}

// ── ZCode trajectory mode ───────────────────────────────────────────────────

/**
 * Render the transcript as a timeline: reasoning, tool calls and text each
 * appear in order, with the same surfaces the folded mode uses.
 */
function renderTrajectory(container, messages) {
  const results = indexToolResults(messages);

  for (const message of messages) {
    if (!message || typeof message !== "object" || message.role === "toolResult") continue;

    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) container.append(userCard(text, message.timestamp));
      continue;
    }

    const thinking = thinkingOf(message.content);
    if (thinking) container.append(reasoningBlock(thinking, { open: true }));

    for (const call of toolCallsOf(message.content)) {
      container.append(toolBlock(call, results.get(call.toolCallId)));
    }

    const text = textOf(message.content);
    if (text) container.append(assistantText(text, message.timestamp));
  }
}

// ── pi-web folded mode ──────────────────────────────────────────────────────

/**
 * Render the way pi-web does: an assistant turn collapses its working steps
 * (reasoning + tool calls) into one expandable group, leaving the final answer
 * visible.
 */
function renderFolded(container, messages) {
  const results = indexToolResults(messages);

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;

    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) container.append(userCard(text, message.timestamp));
      continue;
    }
    if (message.role === "toolResult") continue;

    const thinking = thinkingOf(message.content);
    const tools = toolCallsOf(message.content);
    const text = textOf(message.content);

    if (thinking || tools.length > 0) {
      const details = document.createElement("details");
      details.className = "process";
      const summary = document.createElement("summary");
      summary.textContent = [
        "处理过程",
        thinking ? "思考" : null,
        tools.length > 0 ? `${tools.length} 个工具` : null,
      ].filter(Boolean).join(" · ");
      details.append(summary);

      const steps = document.createElement("div");
      steps.className = "process-steps";
      if (thinking) steps.append(reasoningBlock(thinking, { open: true }));
      for (const call of tools) steps.append(toolBlock(call, results.get(call.toolCallId)));
      details.append(steps);
      container.append(details);
    }

    if (text) container.append(assistantText(text, message.timestamp));
  }
}

// ── Composer ────────────────────────────────────────────────────────────────

async function loadModels() {
  const row = $("chat-model-row");
  row.replaceChildren();
  const response = await state.tunnel.request({ path: "/api/models" });
  const data = parseJson(response);
  if (!data) return;
  // `modelList` is the flat array; `models` is a keyed object and
  // `defaultModel` is a { provider, modelId } pair.
  const models = Array.isArray(data.modelList) ? data.modelList : [];
  if (models.length === 0) return;
  const defaultId = data.defaultModel?.modelId ?? data.defaultModel?.id ?? null;

  // A native select keeps the platform picker (reliable on a phone) while
  // rendering as a compact control in the composer's bottom row.
  const select = document.createElement("select");
  select.id = "chat-model";
  select.className = "composer-select";
  for (const model of models) {
    const value = model.id ?? model.modelId ?? "";
    if (!value) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = model.name ?? model.displayName ?? value;
    if (defaultId && value === defaultId) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => {
    void state.tunnel.request({
      method: "POST",
      path: `/api/agent/${encodeURIComponent(state.current.id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set_model", modelId: select.value }),
    });
  });
  row.append(select);
}

/**
 * Switch the send button between "send" and "stop".
 *
 * ZCode swaps the icon and fills the stop button, rather than relabelling text.
 */
function setSendMode(mode) {
  const button = $("chat-send");
  if (!button) return;
  button.dataset.mode = mode;
  button.classList.toggle("is-stop", mode === "stop");
  button.classList.toggle("is-primary", mode !== "stop");
  button.title = mode === "stop" ? "停止生成" : "发送";
  button.setAttribute("aria-label", button.title);
  button.replaceChildren(icon(mode === "stop" ? "square" : "send"));
}

function showLoading(visible) {
  $("loading-overlay").classList.toggle("hidden", !visible);
}

/**
 * Send a prompt and stream the reply.
 *
 * The prompt endpoint only *accepts* the command — it returns immediately and
 * does not stream. The model's output arrives on the session's event stream, so
 * the stream is opened first and the prompt sent after; doing it the other way
 * would miss the opening deltas.
 */
async function sendMessage() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || !state.current) return;
  const session = state.current;
  input.value = "";
  input.style.height = "auto";
  setSendMode("stop");

  const container = $("chat-messages");
  container.append(userCard(text));

  // Live region for the running turn. Reasoning and tool calls are rendered as
  // they stream in — previously only the final text updated, so the user saw
  // nothing until the whole run finished.
  const live = document.createElement("div");
  live.className = "msg msg-assistant";
  live.style.display = "flex";
  live.style.flexDirection = "column";
  live.style.gap = "12px";
  const liveSteps = document.createElement("div");
  liveSteps.style.display = "flex";
  liveSteps.style.flexDirection = "column";
  liveSteps.style.gap = "12px";
  const liveBody = document.createElement("div");
  liveBody.className = "msg-body";
  live.append(liveSteps, liveBody);
  container.append(live);
  $("chat-branch").textContent = "思考中…";
  scrollToBottom();

  /** Redraw the streaming steps from the latest assistant message. */
  const liveResults = new Map();
  const renderLive = (message, results) => {
    const thinking = thinkingOf(message?.content);
    const calls = toolCallsOf(message?.content);
    const signature = `${thinking.length}:${calls.map((c) => c.toolCallId).join(",")}`;
    if (signature === renderLive.lastSignature) return;
    renderLive.lastSignature = signature;
    liveSteps.replaceChildren();
    if (thinking) liveSteps.append(reasoningBlock(thinking, { open: true }));
    for (const call of calls) liveSteps.append(toolBlock(call, results.get(call.toolCallId)));
  };
  renderLive.lastSignature = "";

  let carry = "";
  let settled = false;
  try {
    // The stream must be listening before the prompt starts a run, or the
    // opening deltas are missed.
    const stream = state.tunnel.request({
      path: `/api/agent/${encodeURIComponent(session.id)}/events`,
      timeoutMs: STREAM_TIMEOUT_MS,
      onHead: () => { $("chat-branch").textContent = "生成中…"; },
      onChunk: (chunk) => {
        carry += chunk;
        const parts = carry.split("\n\n");
        carry = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let event;
            try { event = JSON.parse(payload); } catch { continue; }
            if (!event || typeof event !== "object") continue;
            if (event.type === "message_update" || event.type === "message_end") {
              const next = textOf(event.message?.content);
              if (next) { liveBody.textContent = next; scrollToBottom(); }
              // Reasoning and tool calls stream in too, so the running turn
              // shows its work instead of appearing empty until completion.
              renderLive(event.message, liveResults);
            } else if (event.type === "prompt_done" || event.type === "agent_settled") {
              settled = true;
            } else if (event.type === "error") {
              liveBody.textContent += `\n[错误：${event.message ?? "未知"}]`;
            }
          }
        }
      },
    });
    state.streamRid = stream.rid;

    await state.tunnel.request({
      method: "POST",
      path: `/api/agent/${encodeURIComponent(session.id)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "prompt", message: text }),
    });

    // Wait for the run to settle, then stop reading the stream.
    //
    // The stream is deliberately NOT awaited: it is a long-lived SSE that the
    // server may hold open after the run ends, so awaiting it kept the send
    // button stuck on "stop" forever. `detach` stops the chunk handler and the
    // request is simply left to finish on its own.
    //
    // Two signals are accepted, because a terminal SSE event can be missed:
    // the stream's own done event, or the server no longer reporting the
    // session as running.
    await waitForSettled(() => settled, STREAM_TIMEOUT_MS, async () => !(await sessionStillRunning(session.id)));
    state.tunnel.detach(stream.rid);
    stream.catch(() => {});
  } catch (error) {
    if (liveBody.textContent.length === 0) liveBody.textContent = `[发送失败：${error.message}]`;
  } finally {
    // Re-enable the composer BEFORE re-syncing: loadContext is another tunnel
    // round trip, and awaiting it first left the button stuck on "stop" until
    // that request returned.
    setSendMode("send");
    $("chat-branch").textContent = "";
    state.streamRid = null;
    // Re-sync from the session file so the final text and tool calls are exact.
    if (state.current?.id === session.id) void loadContext(session).catch(() => {});
  }
}

/**
 * Wait until the run is over.
 *
 * `isSettled` is the stream's own signal. `isIdle` is an optional fallback
 * polled against the server, so a missed terminal event cannot leave the
 * composer disabled. Either one ends the wait.
 */
function waitForSettled(isSettled, timeoutMs, isIdle) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      void (async () => {
        if (isSettled()) { clearInterval(timer); resolve(); return; }
        if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(); return; }
        if (isIdle && await isIdle().catch(() => false)) { clearInterval(timer); resolve(); }
      })();
    }, 1200);
  });
}

/**
 * Is this session still running, according to the server?
 *
 * A terminal SSE event can be missed (dropped socket, backgrounded tab), so the
 * composer also asks the server directly before re-enabling send.
 */
async function sessionStillRunning(sessionId) {
  try {
    const response = await state.tunnel.request({ path: "/api/agent/running", timeoutMs: 8_000 });
    const data = parseJson(response);
    const ids = Array.isArray(data?.runningSessionIds) ? data.runningSessionIds : [];
    return ids.includes(sessionId);
  } catch {
    return false;
  }
}

function stopRun() {
  if (!state.current) return;
  void state.tunnel.request({
    method: "POST",
    path: `/api/agent/${encodeURIComponent(state.current.id)}`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "abort" }),
  }).catch(() => {});
  setSendMode("send");
  $("chat-branch").textContent = "已请求停止";
}

function toggleViewMode() {
  state.viewMode = state.viewMode === "trajectory" ? "folded" : "trajectory";
  writeStore(VIEW_MODE_KEY, state.viewMode);
  if (state.current) void loadContext(state.current);
}

// ── Transport ───────────────────────────────────────────────────────────────

function resumeWithStoredSession() {
  const { session, mid } = storedSession();
  if (!session || !mid) return false;
  if (state.resuming) return true;
  state.resuming = true;
  state.socket?.send(JSON.stringify({
    type: "client_resume",
    protocol_version: PROTOCOL_VERSION,
    device_mid: mid,
    session,
  }));
  return true;
}

function setReconnecting(visible) {
  $("reconnect-toast").classList.toggle("hidden", !visible);
}

function connect() {
  const token = tokenFromPath();
  const queryMid = deviceMidFromQuery();
  const stored = storedSession();
  const mid = queryMid || stored.mid;
  const useResume = !token && Boolean(stored.session);
  if ((!token && !useResume) || !mid) {
    showStatus("缺少配对信息", "请从桌面端重新扫描二维码。", true);
    return;
  }

  show("view-home");
  setHomeStatus("正在连接桌面端…");

  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${window.location.host}/ws?role=client`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify(useResume
      ? { type: "client_resume", protocol_version: PROTOCOL_VERSION, device_mid: mid, session: stored.session }
      : { type: "client_pair", protocol_version: PROTOCOL_VERSION, device_mid: mid, token }));
  });

  socket.addEventListener("message", (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }

    if (frame.type === "pair_result") {
      if (frame.ok === false) {
        if ((frame.code === "kicked" || frame.code === "sessionNotFound") && resumeWithStoredSession()) return;
        showStatus("无法连接", ERROR_TEXT[frame.code] ?? `连接失败：${frame.code}`, true);
        return;
      }
      state.connected = true;
      state.resuming = false;
      state.attempt = 0;
      state.tunnel = new Tunnel(socket);
      setReconnecting(false);
      if (typeof frame.session === "string" && frame.session.length > 0) storeSession(frame.session);
      void loadHome().catch((error) => setHomeStatus(`加载失败：${error.message}`));
      return;
    }
    state.tunnel?.handle(frame);
  });

  socket.addEventListener("close", () => {
    state.tunnel?.failAll("连接已断开");
    state.tunnel = null;
    if (state.stopped) return;
    if (!state.connected) return;
    setHomeStatus("连接已断开，正在重连…");
    setReconnecting(true);
    const delay = BACKOFF_MS[Math.min(state.attempt, BACKOFF_MS.length - 1)];
    state.attempt += 1;
    setTimeout(connect, delay);
  });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Hand off to the full pi-web UI.
 *
 * This is a plain page navigation on the relay's own origin — `/web/` is served
 * by the relay, not by a Next.js router, so an assignment is the right call
 * (the Next lint rule that flags it does not apply here).
 */
function goToFullApp() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/web/";
}

$("home-search").addEventListener("input", (event) => {
  state.query = event.currentTarget.value;
  renderHome();
});
$("chat-back").addEventListener("click", () => { state.streamRid = null; show("view-home"); });
/** The session header's "..." menu: view mode and the full-UI hop. */
function openChatMenu() {
  const slot = $("chat-menu");
  const existing = slot.querySelector(".menu");
  if (existing) { existing.remove(); return; }
  const menu = document.createElement("div");
  menu.className = "menu";

  const modeItem = document.createElement("button");
  modeItem.type = "button";
  modeItem.className = "menu-item";
  modeItem.textContent = state.viewMode === "trajectory" ? "改为折叠显示" : "改为轨迹显示";
  modeItem.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    toggleViewMode();
  });

  const webItem = document.createElement("button");
  webItem.type = "button";
  webItem.className = "menu-item";
  webItem.textContent = "打开完整界面";
  webItem.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    goToFullApp();
  });

  menu.append(modeItem, webItem);
  slot.append(menu);
  document.addEventListener("click", () => menu.remove(), { once: true });
}

$("chat-more").addEventListener("click", (event) => {
  event.stopPropagation();
  openChatMenu();
});
$("status-retry").addEventListener("click", () => { state.attempt = 0; connect(); });
$("chat-send").addEventListener("click", () => {
  if ($("chat-send").dataset.mode === "stop") stopRun();
  else void sendMessage();
});

$("pane-close").addEventListener("click", () => $("pane-overlay").classList.add("hidden"));
$("pane-backdrop").addEventListener("click", () => $("pane-overlay").classList.add("hidden"));
$("chat-pane-toggle").addEventListener("click", () => {
  $("pane-overlay").classList.remove("hidden");
  // Mirror ZCode: the chat behind an open pane is inert, so a stray tap cannot
  // act on the conversation.
  $("chat-main").setAttribute("inert", "");
});
$("pane-close").addEventListener("click", () => $("chat-main").removeAttribute("inert"));
$("pane-backdrop").addEventListener("click", () => $("chat-main").removeAttribute("inert"));

$("chat-input").addEventListener("keydown", (event) => {
  // Enter sends, Shift+Enter breaks the line — but never while an IME is
  // composing: a Chinese/Japanese user pressing Enter to accept a candidate
  // would otherwise fire the message off mid-word.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
});

$("chat-input").addEventListener("input", (event) => {
  const el = event.currentTarget;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
});

window.addEventListener("pagehide", () => {
  state.stopped = true;
  try { state.socket?.close(); } catch { /* already closed */ }
});

applyTheme();
renderThemeMenu();
// Follow the OS while in "system" mode, without a reload.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") applyTheme();
});
connect();
