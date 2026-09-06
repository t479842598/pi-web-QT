import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  invalidateOpenSessionCache,
  buildSessionContext,
  listAllSessions,
  openSessionCached,
  readSessionHeader,
} from "@/lib/session-reader";
import { getRpcSession, broadcastSessionBusEvent } from "@/lib/rpc-manager";
import { mutateSettingsJson } from "@/lib/settings-lock";
import { getAgentDir } from "@/lib/session-reader";
import { setSessionArchived, dropSessionArchiveEntry } from "@/lib/session-archive";
import { removeQueue } from "@/lib/queue-store";
import { computeSessionDetails } from "@/lib/session-details";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import { stripModeInstructionBlocks } from "@/lib/modes";

import { projectTreeForResponse } from "@/lib/project-tree-response";
import { sessionPathKey } from "@/lib/session-path";
import { readSubagentRun, readSubagentSessionResources, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { readSessionToolSelection } from "@/lib/session-tool-selection";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    // A live wrapper exposes its own session file (null for a transient,
    // not-yet-persisted session); otherwise resolve from the file cache.
    const filePath = liveRpc ? (liveRpc.sessionFile ?? null) : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // A live wrapper's SessionManager sees in-flight entries a cold file read
    // would miss (transient sessions); fall back to the cached file reader.
    const sm = liveRpc?.inner.sessionManager ?? openSessionCached(filePath!);
    if (!sm) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const entries = sm.getEntries() as never;
    const allEntries = entries as unknown as SessionEntry[];
    const leafId = sm.getLeafId();
    const searchParams = new URL(req.url).searchParams;
    const initialView = searchParams.get("view") === "initial";
    const tree = initialView ? undefined : projectTreeForResponse(sm.getTree());
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages, tail, sessionId: id });
    const details = initialView ? undefined : computeSessionDetails(entries as unknown as SessionEntry[]);
    const totalActiveMs = details?.totalActiveMs;
    const stats = computeSessionStats(entries as unknown as SessionEntry[]);
    const sessionName = sm.getSessionName();

    if (initialView) {
      return NextResponse.json({ sessionId: id, filePath, leafId, context });
    }

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath!).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const subagent = header
      ? readSubagentRun(entries as never, header.id, filePath ?? "")
      : null;
    const toolNames = readSubagentSessionResources(entries as never)?.tools
      ?? readSessionToolSelection(entries as never);
    const info = header ? (await attachSessionProjectInfo([{
      path: filePath ?? "",
      id: header.id,
      cwd: header.cwd ?? "",
      name: sessionName,
      created: header.timestamp,
      modified,
      // info aggregates span the WHOLE session file — derive them from the
      // full entries, not the tail-windowed context (long sessions would
      // otherwise report messageCount ≤ tail and a wrong firstMessage).
      messageCount: stats.totalMessages,
      firstMessage: (() => {
        const firstUserEntry = allEntries.find((entry) => entry.type === "message" && entry.message.role === "user") as { message: { content: unknown } } | undefined;
        if (!firstUserEntry) return "(no messages)";
        const c = firstUserEntry.message.content;
        const raw = typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "";
        return stripModeInstructionBlocks(raw) || "(no messages)";
      })(),
      parentSessionId,
      ...(subagent
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: liveRpc?.isRunning() ? "running" as const : subagent.status } }
        : header.parentSession
          ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
          : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      totalActiveMs,
      stats,
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name?: string, pinned?: boolean, archived?: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name, pinned, archived } = await req.json() as { name?: string; pinned?: boolean; archived?: boolean };
    if (typeof name !== "string" && typeof pinned !== "boolean" && typeof archived !== "boolean") {
      return NextResponse.json({ error: "name, pinned or archived required" }, { status: 400 });
    }
    if (typeof name === "string") {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const sm = SessionManager.open(filePath);
      sm.appendSessionInfo(name.trim());
      // The cached read-only manager for this path is now stale.
      invalidateOpenSessionCache(filePath);
    }
    if (typeof pinned === "boolean") {
      await mutateSettingsJson((settings) => {
        const pins = Array.isArray(settings.sessionPins) ? [...(settings.sessionPins as unknown[])] : [];
        const next = pinned
          ? [...new Set([...pins, id])]
          : pins.filter((p) => p !== id);
        settings.sessionPins = next;
        return { settings };
      });
      // Broadcast to all connected clients so other windows / devices refresh
      // their session lists immediately.
      broadcastSessionBusEvent("session_pin_changed", id, { pinned });
    }
    if (typeof archived === "boolean") {
      await setSessionArchived(getAgentDir(), id, archived);
      broadcastSessionBusEvent("session_archive_changed", id, { archived });
    }
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    // Re-attach all direct children to this session's parent (cascade
    // re-parent). Two discovery sources: same-directory siblings (cheap,
    // catches fresh forks) and the cached session list (catches forks into
    // other project directories).
    const childPaths = new Set<string>();
    const targetPathKey = sessionPathKey(filePath);
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const header = readSessionHeader(childPath);
          if (header?.type === "session" && header.parentSession && sessionPathKey(header.parentSession) === targetPathKey) {
            // Rewrite happens below in one pass (wrapper shutdown first).
            childPaths.add(childPath);
          }
        } catch { /* skip malformed / unreadable child */ }
      }
    } catch { /* skip if dir unreadable */ }
    try {
      // Force a fresh scan: the 10s list cache could miss a fork created
      // seconds ago, and DELETE is a low-frequency operation.
      invalidateSessionListCache();
      for (const session of await listAllSessions()) {
        if (session.parentSessionId === id && session.path !== filePath) childPaths.add(session.path);
      }
    } catch { /* list unavailable — same-dir scan still ran */ }

    for (const childPath of childPaths) {
      try {
        const preview = readSessionHeader(childPath);
        if (!preview || preview.parentSession !== filePath) continue;
        // Stop the child's wrapper FIRST: rewriting the file underneath a
        // live session races its appendFileSync and loses tail messages. The
        // shutdown can reject when the extension runner errors — never let
        // that skip the reparent rewrite (the child would keep pointing at a
        // deleted file and become an orphan).
        if (typeof preview.id === "string" && preview.id) {
          await getRpcSession(preview.id)?.shutdown().catch(() => undefined);
        }
        // Re-read after shutdown so late appends are included in the rewrite.
        const content = readFileSync(childPath, "utf8");
        // Strip CR to handle Windows CRLF line endings in .jsonl files.
        const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        if (header.type !== "session" || header.parentSession !== filePath) continue;
        header.parentSession = parentSessionPath;
        lines[0] = JSON.stringify(header);
        // Atomic tmp+rename: a crash mid-write must not truncate a session.
        const tmpPath = `${childPath}.tmp-${process.pid}-${randomUUID()}`;
        try {
          writeFileSync(tmpPath, lines.join("\n"));
          renameSync(tmpPath, childPath);
        } catch (error) {
          try { unlinkSync(tmpPath); } catch { /* already gone */ }
          throw error;
        }
        invalidateOpenSessionCache(childPath);
      } catch { /* skip malformed / unreadable child */ }
    }

    // Best-effort: a failing extension shutdown hook must not block the
    // delete (the wrapper is destroyed in shutdown's finally regardless).
    await getRpcSession(id)?.shutdown().catch(() => undefined);
    unlinkSync(filePath);
    // Drop the queue sidecar and the archive entry so a hard delete leaves no
    // orphan state behind (both are best-effort: the session is already gone).
    try { removeQueue(filePath); } catch { /* sidecar absent */ }
    await dropSessionArchiveEntry(getAgentDir(), id).catch(() => undefined);
    invalidateOpenSessionCache(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
