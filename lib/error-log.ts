import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { ErrorLogEntry, ErrorLogLevel } from "./error-log-types";

export type { ErrorLogEntry, ErrorLogLevel } from "./error-log-types";

export interface ErrorLogFilters {
  statusCode?: number;
  level?: ErrorLogLevel;
  source?: string;
  query?: string;
  limit?: number;
}

type ErrorLogState = { loaded: boolean; entries: ErrorLogEntry[] };

declare global {
  var __piErrorLogState: ErrorLogState | undefined;
}

const MAX_ENTRIES = 500;
const LOG_FILE = "pi-web-error-log.json";
const STATUS_CODES = new Set([400, 401, 402, 403, 404, 406, 408, 409, 413, 422, 429, 451, 500, 502, 503, 504]);
const MAX_TEXT_LENGTH = 20_000;

/** Sources belonging to the removed OpenCode Zen gateway. These are never
 *  shown in the log UI; historical entries are purged once on load. */
const ZEN_SOURCES = new Set([
  "opencode-zen-external",
  "opencode-zen-switch",
  "opencode-zen-runtime",
  "opencode-zen-sync",
]);

function logPath(): string {
  return join(getAgentDir(), LOG_FILE);
}

function state(): ErrorLogState {
  if (!globalThis.__piErrorLogState) globalThis.__piErrorLogState = { loaded: false, entries: [] };
  const current = globalThis.__piErrorLogState;
  if (!current.loaded) {
    current.loaded = true;
    try {
      if (existsSync(logPath())) {
        const parsed = JSON.parse(readFileSync(logPath(), "utf8")) as unknown;
        if (Array.isArray(parsed)) {
          const kept = parsed.filter(isEntry).slice(-MAX_ENTRIES);
          const withoutZen = kept.filter((entry) => !ZEN_SOURCES.has(entry.source));
          // One-time purge of gateway history; persist only if something changed.
          if (withoutZen.length !== kept.length) persist(withoutZen);
          current.entries = withoutZen;
        }
      }
    } catch {
      current.entries = [];
    }
  }
  return current;
}

function isEntry(value: unknown): value is ErrorLogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ErrorLogEntry>;
  return typeof entry.id === "string"
    && typeof entry.timestamp === "string"
    && (entry.level === "error" || entry.level === "warning" || entry.level === "info")
    && typeof entry.source === "string"
    && typeof entry.message === "string";
}

function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]")
    .replace(/\b(?:oc|opencode|zen)[_-]?[A-Za-z0-9._~-]{12,}\b/gi, "[key-redacted]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]");
}

function boundedText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}…` : value;
}

function inferStatusCode(message: string): number | undefined {
  const match = message.match(/\bHTTP\s+(\d{3})\b|\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b|\b(4\d{2}|5\d{2})\b/i);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return STATUS_CODES.has(value) ? value : undefined;
}

function persist(entries: ErrorLogEntry[]): void {
  try {
    writePrivateFileAtomicSync(logPath(), JSON.stringify(entries, null, 2));
  } catch {
    // Logging must never break the request that is being diagnosed.
  }
}

export function recordErrorLog(input: Omit<Partial<ErrorLogEntry>, "id" | "timestamp" | "message"> & { message: string }): ErrorLogEntry {
  const current = state();
  const message = boundedText(redact(input.message.trim()));
  const details = input.details ? boundedText(redact(input.details)) : undefined;
  const entry: ErrorLogEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level: input.level ?? "error",
    source: input.source ?? "unknown",
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : inferStatusCode(message) !== undefined ? { statusCode: inferStatusCode(message) } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    message: message || "Unknown error",
    ...(details ? { details } : {}),
  };
  current.entries.push(entry);
  if (current.entries.length > MAX_ENTRIES) current.entries.splice(0, current.entries.length - MAX_ENTRIES);
  persist(current.entries);
  return entry;
}

export function getErrorLogs(filters: ErrorLogFilters = {}): ErrorLogEntry[] {
  const query = filters.query?.trim().toLocaleLowerCase();
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), MAX_ENTRIES);
  // Hidden by default; an explicit zen source query still works (preserves the
  // upstream test contract of filtering by source directly).
  const explicitlyZen = filters.source !== undefined && ZEN_SOURCES.has(filters.source);
  return state().entries
    .filter((entry) => explicitlyZen || !ZEN_SOURCES.has(entry.source))
    .filter((entry) => filters.statusCode === undefined || entry.statusCode === filters.statusCode)
    .filter((entry) => !filters.level || entry.level === filters.level)
    .filter((entry) => !filters.source || entry.source === filters.source)
    .filter((entry) => !query || [entry.message, entry.details, entry.provider, entry.model, entry.source]
      .filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(query)))
    .slice()
    .reverse()
    .slice(0, limit);
}

export function clearErrorLogs(): void {
  const current = state();
  current.entries = [];
  persist([]);
}
