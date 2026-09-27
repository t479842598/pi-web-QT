/**
 * Command palette search history (ZCode's `commandCenterSearchHistory`).
 *
 * One entry per distinct query the user actually acted on, newest first. The
 * list is keyed per project so switching projects does not mix unrelated
 * searches; the storage value is validated on read because it is user-writable
 * and survives upgrades.
 */

export type CommandPaletteScope = "all" | "commands" | "sessions" | "files";

export interface CommandPaletteHistoryEntry {
  query: string;
  scope: CommandPaletteScope;
  updatedAt: number;
}

export const HISTORY_LIMIT = 20;

const VALID_SCOPES: readonly CommandPaletteScope[] = ["all", "commands", "sessions", "files"];

/** Prefix characters that select a scope straight from the query (`>` `#` `@`). */
export const SCOPE_PREFIXES: Record<string, CommandPaletteScope> = {
  ">": "commands",
  "#": "sessions",
  "@": "files",
};

export function historyStorageKey(projectKey: string): string {
  return `pi-command-center-search-history:${projectKey || "default"}`;
}

function isScope(value: unknown): value is CommandPaletteScope {
  return typeof value === "string" && (VALID_SCOPES as readonly string[]).includes(value);
}

/**
 * A query is worth remembering only when it carries searchable text: the empty
 * string and a bare prefix (`>`, `#`, `@`) describe no search of their own.
 */
export function isRememberableQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (Object.prototype.hasOwnProperty.call(SCOPE_PREFIXES, trimmed)) return false;
  return true;
}

export function parseHistory(raw: string | null): CommandPaletteHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CommandPaletteHistoryEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.query !== "string" || !isRememberableQuery(entry.query)) continue;
      out.push({
        query: entry.query,
        scope: isScope(entry.scope) ? entry.scope : "all",
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
      });
    }
    return out.slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Insert or promote one entry. Matching is case-insensitive so "Fix bug" and
 * "fix bug" do not both occupy a slot; the newest spelling wins.
 */
export function upsertHistory(
  entries: readonly CommandPaletteHistoryEntry[],
  query: string,
  scope: CommandPaletteScope,
  now: number,
): CommandPaletteHistoryEntry[] {
  if (!isRememberableQuery(query)) return [...entries];
  const key = query.trim().toLowerCase();
  const rest = entries.filter((entry) => entry.query.trim().toLowerCase() !== key);
  return [{ query: query.trim(), scope, updatedAt: now }, ...rest].slice(0, HISTORY_LIMIT);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(projectKey: string): CommandPaletteHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    return parseHistory(store.getItem(historyStorageKey(projectKey)));
  } catch {
    return [];
  }
}

export function saveHistory(projectKey: string, entries: readonly CommandPaletteHistoryEntry[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(historyStorageKey(projectKey), JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // Storage is best-effort (quota, private mode).
  }
}
