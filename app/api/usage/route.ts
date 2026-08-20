import { NextResponse } from "next/server";
import { statSync } from "fs";
import { listAllSessions, getSessionEntries } from "@/lib/session-reader";
import { estimateTokens } from "@/lib/token-estimate";
import type { AgentMessage, AssistantMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Character budget per session when scanning — caps pathological sessions. */
const MAX_TEXT_CHARS = 500_000;

// Per-session usage summary cache keyed by (path, mtimeMs, size). Without it,
// every /api/usage request re-parses every session file end-to-end. Session
// files are append-only, so the mtime/size pair is a reliable invalidator;
// the cached payload is tiny (three numbers), so hundreds of entries are fine.
interface UsageSummary {
  usageTokens: number;
  estimatedTokens: number;
  messageCount: number;
}

interface UsageCacheEntry extends UsageSummary {
  mtimeMs: number;
  size: number;
}

const USAGE_CACHE_MAX = 2000;

declare global {
  var __piUsageSummaryCache: Map<string, UsageCacheEntry> | undefined;
}

function computeSessionUsage(path: string, entries: Awaited<ReturnType<typeof getSessionEntries>>): UsageSummary {
  let usageTokens = 0;
  let estimatedTokens = 0;
  let messageCount = 0;
  let chars = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = (entry as { message: AgentMessage }).message;
    messageCount += 1;
    usageTokens += messageUsageTokens(message);
    const text = messageText(message);
    const budget = Math.max(0, MAX_TEXT_CHARS - chars);
    if (budget > 0) {
      const slice = text.slice(0, budget);
      chars += slice.length;
      estimatedTokens += estimateTokens(slice);
    }
  }
  return { usageTokens, estimatedTokens, messageCount };
}

function getSessionUsage(path: string): UsageSummary | null {
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return null;
  }
  const cache = (globalThis.__piUsageSummaryCache ??= new Map());
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit;
  let summary: UsageSummary;
  try {
    summary = computeSessionUsage(path, getSessionEntries(path));
  } catch {
    // Unreadable/corrupt session file — skip it rather than failing all.
    return null;
  }
  cache.set(path, { mtimeMs, size, ...summary });
  while (cache.size > USAGE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return summary;
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text ?? "") : ""))
    .join("\n");
}

/** Sum of a message's recorded usage (input + output + cache), when present. */
function messageUsageTokens(message: AgentMessage): number {
  const usage = (message as Partial<AssistantMessage>).usage;
  if (!usage) return 0;
  return (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export interface UsageSessionRow {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  messageCount: number;
  /** Recorded model usage tokens (input+output+cache) when the session has any. */
  usageTokens: number;
  /** Estimated tokens from message text — used when no usage records exist. */
  estimatedTokens: number;
  /** Effective display value: recorded usage when available, else estimate. */
  tokens: number;
  hasUsageRecords: boolean;
}

export interface UsageReport {
  sessions: UsageSessionRow[];
  /** Tokens per UTC day: YYYY-MM-DD → tokens (effective). */
  daily: Array<{ day: string; tokens: number }>;
  totalTokens: number;
  totalSessions: number;
  messageCount: number;
}

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const rows: UsageSessionRow[] = [];
    const daily = new Map<string, number>();
    let totalTokens = 0;
    let messageCount = 0;

    for (const session of sessions) {
      const summary = getSessionUsage(session.path);
      if (!summary) continue;
      const { usageTokens, estimatedTokens, messageCount: msgs } = summary;

      const tokens = usageTokens > 0 ? usageTokens : estimatedTokens;
      totalTokens += tokens;
      messageCount += msgs;
      rows.push({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name,
        firstMessage: session.firstMessage,
        created: session.created,
        modified: session.modified,
        messageCount: msgs,
        usageTokens,
        estimatedTokens,
        tokens,
        hasUsageRecords: usageTokens > 0,
      });

      const day = (session.modified ?? session.created ?? "").slice(0, 10);
      if (day) daily.set(day, (daily.get(day) ?? 0) + tokens);
    }

    rows.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
    const dailyArr = [...daily.entries()]
      .map(([day, tokens]) => ({ day, tokens }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const report: UsageReport = {
      sessions: rows,
      daily: dailyArr,
      totalTokens,
      totalSessions: rows.length,
      messageCount,
    };
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
