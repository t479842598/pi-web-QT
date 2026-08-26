import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, fstatSync, openSync, readSync, statSync } from "fs";
import { normalize as normalizePath } from "path";
import type { AgentMessage, ImageContent, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { stripModeInstructionBlocks } from "./modes";
import { projectIdentityKey } from "./project-identity";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";
import { readSettingsJsonUnlocked } from "./settings-lock";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";

export { getAgentDir };

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

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(sessionPathKey(s.path), s.id);

  // Read pinned session ids from settings.json (sessionPins: string[])
  const settings = readSettingsJsonUnlocked();
  const rawPins = Array.isArray(settings.sessionPins) ? (settings.sessionPins as unknown[]) : [];
  const pinSet = new Set(rawPins.filter((p): p is string => typeof p === "string"));

  // Project resolution (projectRoot/projectKey/worktreeBranch) is attached
  // downstream by attachSessionProjectInfo(), shared with other callers.
  const sessions = piSessions.map((s) => {
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
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: stripModeInstructionBlocks(s.firstMessage || "(no messages)").slice(0, FIRST_MESSAGE_MAX_CHARS),
      parentSessionId: originSessionId,
      ...(subagent
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: subagent.status } }
        : s.parentSessionPath
          ? { relation: { kind: "fork" as const, ...(originSessionId ? { originSessionId } : {}) } }
          : {}),
      transient: false,
      pinned: pinSet.has(s.id),
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

const SESSION_LIST_CACHE_TTL_MS = 10_000;

/** Upper bound on the firstMessage preview kept in the list cache snapshot. */
const FIRST_MESSAGE_MAX_CHARS = 300;

/** Coalescing window for invalidations: streaming emits session-info/message
 *  events every few seconds; without debouncing each one forces a full
 *  re-scan of every session file on the next list request. */
const SESSION_LIST_INVALIDATE_DEBOUNCE_MS = 300;

let invalidateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function invalidateSessionListCache(): void {
  if (invalidateDebounceTimer) return;
  invalidateDebounceTimer = setTimeout(() => {
    invalidateDebounceTimer = null;
    globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
    globalThis.__piSessionListCache = undefined;
  }, SESSION_LIST_INVALIDATE_DEBOUNCE_MS);
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
  const reverseCache = getPathToIdCache();
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

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
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

const SESSION_RELATION_MAX_BYTES = 256 * 1024;
const SESSION_RELATION_MAX_LINES = 2;
const SESSION_RESULT_MAX_BYTES = 256 * 1024;

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

/**
 * Read a session file's relation-relevant entries: the header-adjacent prefix
 * (session + subagent metadata) plus the tail result entry. Subagent sessions
 * persist SUBAGENT_META_TYPE near the top and SUBAGENT_RESULT_TYPE at the end;
 * bounded reads keep this cheap for large files.
 */
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

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
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

function getSessionSettings(entries: SessionEntry[], leafId?: string | null): Pick<SessionContext, "thinkingLevel" | "model"> {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let current = leafId ? byId.get(leafId) : undefined;
  current ??= entries[entries.length - 1];
  let thinkingLevel: string | undefined;
  let model: SessionContext["model"] | undefined;

  while (current && (thinkingLevel === undefined || model === undefined)) {
    if (thinkingLevel === undefined && current.type === "thinking_level_change") {
      thinkingLevel = current.thinkingLevel;
    }
    if (model === undefined && current.type === "model_change") {
      model = { provider: current.provider, modelId: current.modelId };
    } else if (model === undefined && current.type === "message" && current.message.role === "assistant") {
      const message = current.message as { provider?: unknown; model?: unknown };
      if (typeof message.provider === "string" && typeof message.model === "string") {
        model = { provider: message.provider, modelId: message.model };
      }
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return { thinkingLevel: thinkingLevel ?? "off", model: model ?? null };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: BuildSessionContextOptions = {},
): SessionContext {
  const { tail, excludeLeaf } = options;
  // Restrict SDK conversion and the response payload to the requested page.
  const sliced = tail && tail > 0 ? sliceActiveBranch(entries, leafId ?? null, tail, excludeLeaf) : entries;
  const hasMore = Boolean(tail && tail > 0 && sliced[0]?.parentId);
  const byId = new Map<string, SessionEntry>();
  for (const e of sliced) byId.set(e.id, e);

  const piEntries = sliced as unknown as PiSessionEntry[];
  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
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
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  // Pagination: `before` is the oldest entry already loaded, so the next page
  // must start at its parent to avoid duplicating `before` when prepended.
  if (excludeLeaf) leaf = leaf?.parentId ? byId.get(leaf.parentId) : undefined;
  if (!leaf) return [];
  const chain: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current && chain.length < tail) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
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

    // 保持历史响应精简，但保留一个懒加载图片块：浏览器只在展开折叠的
    // 工具结果时才取图。
    if (sessionId) {
      const source: ImageContent["source"] = {
        type: "url",
        ...(image.mime ? { media_type: image.mime } : {}),
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
            ? { ...block, thinking: "", deferred: true }
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
