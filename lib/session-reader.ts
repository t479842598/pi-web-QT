import {
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, createReadStream, existsSync, fstatSync, openSync, readSync, statSync, type Dirent } from "fs";
import { readdir, stat } from "fs/promises";
import { isAbsolute, join, normalize as normalizePath, relative, resolve as resolvePath, sep } from "path";
import { createInterface } from "readline";
import type { AgentMessage, ImageContent, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { stripModeInstructionBlocks } from "./modes";
import { getThinkingPreview } from "./message-display";
import { projectIdentityKey } from "./project-identity";
import { sessionPathKey } from "./session-path";
import { MAX_TOOL_RESULT_IMAGE_BYTES, TOOL_RESULT_IMAGE_MIMES } from "./tool-result-images";
import { resolveProject, type ProjectInfo } from "./worktree";
import { readSettingsJsonUnlocked } from "./settings-lock";
import { readSessionArchive } from "./session-archive";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import { listSessionsIncremental } from "./session-list-scanner";

/** Listing implementation (overridable via globalThis.__piListSessionsOverride for tests). */
export const listSessions: typeof listSessionsIncremental = listSessionsIncremental;

export { getAgentDir };

const SESSION_HEADER_MAX_BYTES = 64 * 1024;

const SESSION_RELATION_MAX_BYTES = 256 * 1024;
const SESSION_RELATION_MAX_LINES = 400;
const SESSION_RESULT_MAX_BYTES = 64 * 1024;

const SESSION_LIST_CACHE_TTL_MS = 10_000;

/** Upper bound on the firstMessage preview kept in the list cache snapshot. */
const FIRST_MESSAGE_MAX_CHARS = 300;

/** Coalescing window for invalidations: streaming emits session-info/message
 *  events every few seconds; without debouncing each one forces a full
 *  re-scan of every session file on the next list request. */
const SESSION_LIST_INVALIDATE_DEBOUNCE_MS = 300;

let invalidateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function readBoundedLines(filePath: string, maxBytes: number, maxLines: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    let newlineCount = 0;
    let reachedEof = false;

    while (position < maxBytes && newlineCount < maxLines) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        reachedEof = true;
        break;
      }
      position += bytesRead;
      const data = buffer.subarray(0, bytesRead);
      let end = data.length;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] !== 0x0a) continue;
        newlineCount += 1;
        if (newlineCount === maxLines) {
          end = index + 1;
          break;
        }
      }
      chunks.push(data.subarray(0, end));
    }

    const source = Buffer.concat(chunks).toString("utf8");
    const lines = source.split("\n");
    if (!reachedEof && !source.endsWith("\n")) lines.pop();
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function readBoundedTailLines(filePath: string, maxBytes: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const fileSize = fstatSync(fd).size;
    const start = Math.max(0, fileSize - maxBytes);
    const buffer = Buffer.allocUnsafe(fileSize - start);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    if (bytesRead === 0) return [];

    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start > 0) {
      const previousByte = Buffer.allocUnsafe(1);
      readSync(fd, previousByte, 0, 1, start - 1);
      if (previousByte[0] !== 0x0a) lines.shift();
    }
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function parseSessionEntries(lines: readonly string[]): SessionEntry[] {
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as SessionEntry;
      return [entry];
    } catch {
      return [];
    }
  });
}

function readSessionRelationEntries(filePath: string): SessionEntry[] {
  const prefixEntries = parseSessionEntries(
    readBoundedLines(filePath, SESSION_RELATION_MAX_BYTES, SESSION_RELATION_MAX_LINES).slice(1),
  );
  const isSubagent = prefixEntries.some((entry) => (
    entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE
  ));
  if (!isSubagent) return prefixEntries;

  return [
    ...prefixEntries,
    ...parseSessionEntries(readBoundedTailLines(filePath, SESSION_RESULT_MAX_BYTES)),
  ];
}

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    const projectRoot = project?.projectRoot ?? session.cwd;
    return {
      ...session,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
      ...(project?.branch ? { branch: project.branch } : {}),
      ...(project?.isWorktree ? { isWorktree: true } : {}),
    };
  });
}

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

// ─── Incremental session info scan ──────────────────────────────────────────
// SessionManager.listAll() streams and parses EVERY session file on every call
// (today ~500 files / ~500MB), and the list cache is invalidated by every live
// session's streaming events — so while any session runs, each cache miss paid
// the full scan again and large session libraries made opening a session time
// out. Key the scan by (mtimeMs, size) instead: unchanged files reuse the
// cached info, only new or appended files are re-read. Field semantics mirror
// the SDK's module-private buildSessionInfo() so list output stays identical.
declare global {
  var __piSessionFileInfoCache: Map<string, { mtimeMs: number; size: number; info: PiSessionInfo }> | undefined;
}

const SESSION_INFO_SCAN_CONCURRENCY = 10;

interface SessionFileStats {
  mtimeMs: number;
  size: number;
}

function getFileInfoCache(): Map<string, { mtimeMs: number; size: number; info: PiSessionInfo }> {
  if (!globalThis.__piSessionFileInfoCache) {
    globalThis.__piSessionFileInfoCache = new Map();
  }
  return globalThis.__piSessionFileInfoCache;
}

function isMessageWithContentShape(
  message: unknown,
): message is { role: string; content: string | Array<{ type: string; text?: string }>; timestamp?: unknown } {
  return typeof message === "object" && message !== null && "role" in message && "content" in message;
}

function extractInfoTextContent(message: { content: string | Array<{ type: string; text?: string }> }): string {
  if (typeof message.content === "string") return message.content;
  return message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ");
}

function getMessageActivityTime(entry: { timestamp?: unknown; message?: unknown }): number | undefined {
  const message = entry.message;
  if (!isMessageWithContentShape(message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number") return message.timestamp;
  const t = new Date(typeof entry.timestamp === "string" ? entry.timestamp : "").getTime();
  return Number.isNaN(t) ? undefined : t;
}

/** Stream one session file and extract the list metadata, mirroring the SDK's
 *  buildSessionInfo(). Returns null for unreadable/non-session files so a
 *  single corrupt file never blocks the rest of the scan. */
async function readSessionInfoFromFile(filePath: string, stats: SessionFileStats): Promise<PiSessionInfo | null> {
  try {
    let header: { id?: unknown; cwd?: unknown; timestamp?: unknown; parentSession?: unknown } | null = null;
    let messageCount = 0;
    let firstMessage = "";
    let name: string | undefined;
    let lastActivityTime: number | undefined;
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof entry !== "object" || entry === null) continue;
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        const raw = entry.name;
        name = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
      }
      if (entry.type !== "message") continue;
      messageCount++;
      const activityTime = getMessageActivityTime(entry);
      if (typeof activityTime === "number") {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }
      const message = entry.message;
      if (!isMessageWithContentShape(message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const textContent = extractInfoTextContent(message);
      if (!textContent) continue;
      if (!firstMessage && message.role === "user") {
        firstMessage = textContent;
      }
    }
    if (!header) return null;
    const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
    const modified = typeof lastActivityTime === "number" && lastActivityTime > 0
      ? new Date(lastActivityTime)
      : !Number.isNaN(headerTime)
        ? new Date(headerTime)
        : new Date(stats.mtimeMs);
    return {
      path: filePath,
      id: typeof header.id === "string" ? header.id : "",
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      created: new Date(typeof header.timestamp === "string" ? header.timestamp : stats.mtimeMs),
      modified,
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      // The SDK fills this with the joined text of every message; nothing in
      // pi-web consumes it, and caching it would pin all message text in
      // memory for the lifetime of the process.
      allMessagesText: "",
    };
  } catch {
    return null;
  }
}

/** Directory listing (cheap) + re-parse of only new/changed files. Replaces
 *  SessionManager.listAll() so the scan cost is O(changed files), not
 *  O(all files). Output ordering matches listAll(): modified desc. */
export async function scanSessionInfos(): Promise<PiSessionInfo[]> {
  const sessionsDir = join(getAgentDir(), "sessions");
  let dirEntries: Dirent[];
  try {
    if (!existsSync(sessionsDir)) return [];
    dirEntries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = dirEntries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(sessionsDir, entry.name));
  const files: string[] = [];
  for (const dir of dirs) {
    try {
      const names = await readdir(dir);
      for (const fileName of names) {
        if (fileName.endsWith(".jsonl")) files.push(join(dir, fileName));
      }
    } catch { /* unreadable directory */ }
  }

  const prevCache = getFileInfoCache();
  const nextCache = new Map<string, { mtimeMs: number; size: number; info: PiSessionInfo }>();
  const stats = new Map<string, SessionFileStats>();
  const changed: string[] = [];
  await Promise.all(files.map(async (file) => {
    try {
      const st = await stat(file);
      stats.set(file, { mtimeMs: st.mtimeMs, size: st.size });
    } catch { /* removed mid-scan */ }
  }));
  for (const [file, st] of stats) {
    const cached = prevCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      nextCache.set(file, cached);
    } else {
      changed.push(file);
    }
  }

  let cursor = 0;
  const parseNext = async (): Promise<void> => {
    while (cursor < changed.length) {
      const file = changed[cursor++];
      const st = stats.get(file);
      if (!st) continue;
      const info = await readSessionInfoFromFile(file, st);
      if (info) nextCache.set(file, { ...st, info });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SESSION_INFO_SCAN_CONCURRENCY, changed.length) }, () => parseNext()),
  );

  // Replace wholesale: files that vanished are pruned, unchanged entries are
  // carried over by reference.
  globalThis.__piSessionFileInfoCache = nextCache;
  const infos = [...nextCache.values()].map((cached) => cached.info);
  infos.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return infos;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  // 测试可经 globalThis.__piListSessionsOverride 覆盖列表来源。
  const list = (globalThis as { __piListSessionsOverride?: typeof listSessions }).__piListSessionsOverride ?? listSessions;
  const scanned = await list();
  const pathToId = new Map<string, string>();
  for (const s of scanned) pathToId.set(sessionPathKey(s.path), s.id);

  // Read pinned session ids from settings.json (sessionPins: string[])
  const settings = readSettingsJsonUnlocked();
  const rawPins = Array.isArray(settings.sessionPins) ? (settings.sessionPins as unknown[]) : [];
  const pinSet = new Set(rawPins.filter((p): p is string => typeof p === "string"));

  // Archived session ids come from the agent-dir sidecar (session-archive.json).
  const archive = readSessionArchive(getAgentDir());

  // Project resolution (projectRoot/projectKey/worktreeBranch) is attached
  // downstream by attachSessionProjectInfo(), shared with other callers.
  const sessions = scanned.map((s) => {
    cacheSessionPath(s.id, s.path);
    const originSessionId = s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined;
    let subagent = null;
    if (s.parentSessionPath) {
      try {
        subagent = readSubagentRun(readSessionRelationEntries(s.path), s.id, s.path);
      } catch { /* malformed or concurrently removed session */ }
    }
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: stripModeInstructionBlocks(s.firstMessage || "(no messages)").slice(0, FIRST_MESSAGE_MAX_CHARS),
      parentSessionId: originSessionId,
      ...(subagent
        ? { relation: {
            kind: "subagent" as const,
            parentSessionId: subagent.parentSessionId,
            profile: subagent.profile,
            description: subagent.description,
            status: subagent.status,
            ...(subagent.createdAt ? { createdAt: subagent.createdAt } : {}),
            ...(subagent.completedAt ? { completedAt: subagent.completedAt } : {}),
          } }
        : s.parentSessionPath
          ? { relation: { kind: "fork" as const, ...(originSessionId ? { originSessionId } : {}) } }
          : {}),
      transient: false,
      pinned: pinSet.has(s.id),
      archived: Boolean(archive[s.id]),
      ...(archive[s.id] ? { archivedAt: archive[s.id].archivedAt } : {}),
      importedFrom: (s as unknown as { importedFrom?: string }).importedFrom,
    };
  });
  return attachSessionProjectInfo(sessions);
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    globalThis.__piSessionListCache = { data, ts: Date.now() };
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}


/** Test seam: reset the in-memory list cache (alias of invalidateSessionListCache). */
export function resetSessionListState(): void {
  invalidateSessionListCache();
}

export function invalidateSessionListCache(): void {
  if (invalidateDebounceTimer) return;
  invalidateDebounceTimer = setTimeout(() => {
    invalidateDebounceTimer = null;
    globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
    globalThis.__piSessionListCache = undefined;
  }, SESSION_LIST_INVALIDATE_DEBOUNCE_MS);
}

export function getSessionListVersion(): number {
  return globalThis.__piSessionListGeneration ?? 0;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

/**
 * Cap on the number of id→path / path→id cache entries. Sessions are created
 * for many cwds over the lifetime of a dev server; without a bound these two
 * maps grow forever even after session files are deleted externally.
 */
const SESSION_PATH_CACHE_MAX = 4096;

function evictSessionPathCache(): void {
  const pathCache = getPathCache();
  // Drop the oldest entries (Map preserves insertion order) when over budget.
  while (pathCache.size > SESSION_PATH_CACHE_MAX) {
    const oldestId = pathCache.keys().next().value;
    if (oldestId === undefined) break;
    invalidateSessionPathCache(oldestId as string);
  }
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  const targetedPath = await findSessionPathById(sessionId);
  if (targetedPath) {
    cacheSessionPath(sessionId, targetedPath);
    return getPathCache().get(sessionId) ?? null;
  }

  // Unknown layouts, malformed candidates, and duplicate IDs retain the
  // existing authoritative catalogue scan instead of negative-caching a miss.
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  const targetedId = findSessionIdByPath(filePath);
  if (targetedId) return targetedId;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}


const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function defaultSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

function resolvePathWithinDefaultSessions(
  filePath: string,
  sessionsDir = resolvePath(defaultSessionsDir()),
): string | null {
  const candidatePath = resolvePath(filePath);
  const relativePath = relative(sessionsDir, candidatePath);
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
    ? candidatePath
    : null;
}

async function findSessionPathById(sessionId: string): Promise<string | null> {
  // The filename is only a candidate hint; the bounded header check remains
  // authoritative so future layouts and malformed files use the full fallback.
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  let projectDirs: Dirent[];
  const sessionsDir = resolvePath(defaultSessionsDir());
  try {
    projectDirs = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const suffix = `_${sessionId}.jsonl`;
  let match: string | undefined;
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory() && !projectDir.isSymbolicLink()) continue;
    const projectPath = resolvePathWithinDefaultSessions(
      join(sessionsDir, projectDir.name),
      sessionsDir,
    );
    if (!projectPath) continue;

    let files: string[];
    try {
      files = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const candidate = resolvePathWithinDefaultSessions(
        join(projectPath, file),
        sessionsDir,
      );
      if (!candidate) continue;
      try {
        if (readSessionHeader(candidate)?.id !== sessionId) continue;
      } catch {
        continue;
      }
      // Do not choose between duplicate candidates; retain the existing
      // catalogue fallback for its current resolution semantics.
      if (match && match !== candidate) return null;
      match = candidate;
    }
  }

  return match ?? null;
}

function findSessionIdByPath(filePath: string): string | undefined {
  if (!filePath.endsWith(".jsonl")) return undefined;
  const candidate = resolvePathWithinDefaultSessions(filePath);
  if (!candidate) return undefined;
  try {
    const sessionId = readSessionHeader(candidate)?.id;
    if (!sessionId) return undefined;
    cacheSessionPath(sessionId, candidate);
    return sessionId;
  } catch {
    return undefined;
  }
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const pathKey = normalizePath(filePath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousSessionId = reverseCache.get(pathKey);
  if (previousPath && previousPath !== pathKey && reverseCache.get(previousPath) === sessionId) {
    reverseCache.delete(previousPath);
  }
  if (previousSessionId && previousSessionId !== sessionId && pathCache.get(previousSessionId) === pathKey) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, pathKey);
  reverseCache.set(pathKey, sessionId);
  evictSessionPathCache();
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  if (filePath && reverseCache.get(filePath) === sessionId) {
    reverseCache.delete(filePath);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const firstLine = readBoundedLines(filePath, SESSION_HEADER_MAX_BYTES, 1)[0]?.trimEnd();
  if (!firstLine) return null;
  try {
    const header = JSON.parse(firstLine) as SessionHeader;
    return header.type === "session" ? header : null;
  } catch {
    return null;
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = openSessionCached(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

// ─── Cached read-only SessionManager ────────────────────────────────────────
// SessionManager.open() eagerly re-reads and JSON.parses the whole jsonl on
// every call. Read-only routes (session detail, context/branch navigation,
// usage) repeat that cost on every request, blocking the event loop for large
// files. Cache the manager keyed by (path, mtimeMs, size): session files are
// append-only, so an mtime/size change reliably invalidates. Small LRU keeps
// memory bounded. NEVER use this for paths that mutate the session (wrapper
// startup, appendSessionInfo, reparenting) — use SessionManager.open directly
// and call invalidateOpenSessionCache after the write.
interface CachedSessionManager {
  mtimeMs: number;
  size: number;
  sm: SessionManager;
}

const SESSION_MANAGER_CACHE_MAX = 6;

declare global {
  var __piSessionManagerCache: Map<string, CachedSessionManager> | undefined;
}

export function openSessionCached(filePath: string): SessionManager {
  // Concurrency note: SessionManager.open() is fully synchronous, so concurrent
  // requests are serialized by the event loop — the first request populates the
  // cache and the rest hit it. Same-path concurrent opens therefore parse the
  // file exactly once without an in-flight promise table; if this ever becomes
  // async, add per-path in-flight dedupe here BEFORE restoring concurrency.
  const cache = (globalThis.__piSessionManagerCache ??= new Map());
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(filePath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    cache.delete(filePath);
    return SessionManager.open(filePath); // surface the normal open error
  }
  const hit = cache.get(filePath);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    cache.delete(filePath);
    cache.set(filePath, hit); // refresh recency
    return hit.sm;
  }
  const sm = SessionManager.open(filePath);
  cache.set(filePath, { mtimeMs, size, sm });
  while (cache.size > SESSION_MANAGER_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return sm;
}

export function invalidateOpenSessionCache(filePath?: string): void {
  const cache = globalThis.__piSessionManagerCache;
  if (!cache) return;
  if (filePath) cache.delete(filePath);
  else cache.clear();
}

export interface BuildSessionContextOptions {
  deferThinking?: boolean;
  deferToolResultImages?: boolean;
  tail?: number;
  excludeLeaf?: boolean;
  /** Session id used to build lazy URLs for historical tool-result images. */
  sessionId?: string;
}

export function getLatestModelChange(entries: SessionEntry[]): SessionContext["model"] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "model_change") {
      return { provider: entry.provider, modelId: entry.modelId };
    }
  }
  return null;
}

function getSessionSettings(entries: SessionEntry[], leafId?: string | null): Pick<SessionContext, "thinkingLevel" | "model"> {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const branch = sliceActiveBranch(entries, leafId ?? null, entries.length);
  let thinkingLevel: string | undefined;
  let responseModel: SessionContext["model"] | undefined;

  for (let i = branch.length - 1; i >= 0 && (thinkingLevel === undefined || responseModel === undefined); i--) {
    const entry = branch[i];
    if (thinkingLevel === undefined && entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    }
    if (responseModel === undefined && entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as { provider?: unknown; model?: unknown };
      if (typeof message.provider === "string" && typeof message.model === "string") {
        responseModel = { provider: message.provider, modelId: message.model };
      }
    }
  }

  return {
    thinkingLevel: thinkingLevel ?? "off",
    model: getLatestModelChange(branch) ?? responseModel ?? null,
  };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: BuildSessionContextOptions = {},
): SessionContext {
  const { tail, excludeLeaf } = options;
  // History pages retain the original branch order, including compacted messages.
  // SDK context filtering can drop a page's messages when firstKeptEntryId is outside it.
  const sliced = leafId === null ? [] : sliceActiveBranch(
    entries, leafId ?? null, tail && tail > 0 ? tail : entries.length, excludeLeaf,
  );
  const hasMore = Boolean(tail && tail > 0 && sliced[0]?.parentId);

  // Convert messages and their IDs together to keep fork/navigation targets aligned.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of sliced) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }

  return {
    messages,
    entryIds,
    oldestEntryId: sliced[0]?.id ?? null,
    hasMore,
    ...getSessionSettings(entries, leafId),
  };
}

/**
 * Extract the ancestor chain from `leafId` back toward the root, capped at
 * `tail` entries (most-recent first after the final reverse). Iterative: a
 * linear session's chain length equals its entry count, so a recursive walk
 * would overflow the stack. The result is still a valid prefix of the active
 * branch — older history is loaded on demand via pagination.
 */
export function sliceActiveBranch(
  entries: SessionEntry[],
  leafId: string | null,
  tail: number,
  excludeLeaf = false,
): SessionEntry[] {
  if (tail <= 0) return entries;
  let targetId = leafId ?? entries[entries.length - 1]?.id;
  if (!targetId) return [];
  let skipFirst = excludeLeaf;
  const chain: SessionEntry[] = [];
  // Parent entries always precede children in the append-only JSONL. Walk the
  // file once from newest to oldest and follow just the requested parent chain;
  // this avoids allocating an O(total entries) id Map to return a 50-entry page.
  for (let index = entries.length - 1; index >= 0 && targetId && chain.length < tail; index--) {
    const entry = entries[index];
    if (entry.id !== targetId) continue;
    targetId = entry.parentId ?? "";
    if (skipFirst) {
      skipFirst = false;
      continue;
    }
    chain.push(entry);
  }
  chain.reverse();
  return chain;
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function deferToolResultBase64Images(
  message: AgentMessage,
  sessionId: string | undefined,
  entryId: string,
): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.flatMap((block, blockIndex) => {
    const image = base64ImageInfo(block);
    if (!image) return [block];

    // Keep the initial history response small, but preserve an image block that
    // the browser can load only when its collapsed tool result is expanded.
    if (
      sessionId &&
      image.mime &&
      TOOL_RESULT_IMAGE_MIMES.has(image.mime) &&
      image.bytes > 0 &&
      image.bytes <= MAX_TOOL_RESULT_IMAGE_BYTES
    ) {
      const source: ImageContent["source"] = {
        type: "url",
        media_type: image.mime,
        url: `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${blockIndex}`,
      };
      return [{ type: "image", source } satisfies ImageContent];
    }

    // 无 sessionId 的调用方保留旧的有界回退（丢弃 + 占位文本）。
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return [];
  });
  if (omitted === 0) return { ...message, content };

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: BuildSessionContextOptions,
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      let message = options.deferToolResultImages
        ? deferToolResultBase64Images(normalizeToolCalls(entry.message), options.sessionId, entry.id)
        : normalizeToolCalls(entry.message);
      const legacyContent = message.role === "assistant" ? (message as { content: unknown }).content : undefined;
      if (typeof legacyContent === "string") {
        message = { ...message, content: [{ type: "text", text: legacyContent }] } as AgentMessage;
      }
      if (!options.deferThinking || message.role !== "assistant") return message;
      const content = message.content;
      return {
        ...message,
        content: content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: getThinkingPreview(block.thinking), deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
