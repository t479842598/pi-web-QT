import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
  openSessionManager,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateOpenSessionCache,
  buildSessionContext,
  openSessionCached,
  readSessionHeader,
  getAgentDir,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { samePath } from "@/lib/paths";
import { abortSubagent, beginRpcSessionMutation, getRpcSession, getRpcSessionInfos, broadcastSessionBusEvent } from "@/lib/rpc-manager";
import { mutateSettingsJson } from "@/lib/settings-lock";
import { setSessionArchived, dropSessionArchiveEntry } from "@/lib/session-archive";
import { removeQueue } from "@/lib/queue-store";
import { goalSidecarPath } from "@/lib/goal-engine";
import { computeSessionDetails } from "@/lib/session-details";
import { computeSessionStats } from "@/lib/session-stats";
import { startServerPerf } from "@/lib/perf";
import { computeSessionRevision } from "@/lib/session-revision";
import type { SessionEntry } from "@/lib/types";
import { stripModeInstructionBlocks } from "@/lib/modes";

import { projectTreeForResponse, toSummaryTree } from "@/lib/project-tree";
import { readSubagentRun, readSubagentSessionResources, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { readSessionToolSelection } from "@/lib/session-tool-selection";
import { jsonResponse } from "@/lib/json-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const perf = startServerPerf("GET /api/sessions/[id]");
  try {
    perf?.span("resolve");
    const rpc = getRpcSession(id);
    const searchParams = new URL(req.url).searchParams;
    const force = searchParams.get("force") === "1";
    const initialView = searchParams.get("view") === "initial";

    // A live wrapper only reflects the appends pi-web itself made. When another
    // pi process (the TUI) writes the same session file, the in-memory index
    // stays stale. Only probe on ?force=1 (session mount / page refresh): two
    // processes writing one JSONL is unsupported, so post-turn reads must not
    // scan disk. Eviction is idle-only; mid-run the wrapper owns the write path.
    let liveWrapper = rpc?.isAlive() ? rpc : undefined;
    let wrapperRebuilt = false;
    if (force && liveWrapper?.evictIfDiskAhead()) {
      wrapperRebuilt = true;
      liveWrapper = undefined;
    }
    const liveRpc = liveWrapper;
    // A live wrapper exposes its own session file (null for a transient,
    // not-yet-persisted session); otherwise resolve from the file cache.
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // A live wrapper's SessionManager sees in-flight entries a cold file read
    // would miss (transient sessions); fall back to the cached file reader.
    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(resolvedPath!);
    if (!sm) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    perf?.span("open");
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries() as never;
    const allEntries = entries as unknown as SessionEntry[];
    const leafId = sm.getLeafId();
    const summaryTree = searchParams.get("tree") === "summary";
    const tree = summaryTree
      ? toSummaryTree(projectTreeForResponse(sm.getTree()))
      : projectTreeForResponse(sm.getTree());
    perf?.span("tree");
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries as never, leafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      sessionId: id, // local: lazy URLs for historical tool-result images
    });
    perf?.span("context");
    const details = initialView ? undefined : computeSessionDetails(allEntries);
    const totalActiveMs = details?.totalActiveMs;
    // Cumulative usage over ALL entries, including history compacted away —
    // the same aggregation the SDK's getSessionStats() uses. Lets the client
    // keep monotonic token/cost counters across compaction and page reloads.
    const stats = computeSessionStats(allEntries);
    perf?.span("stats");
    // Opaque freshness token for the session view cache. Derived from the
    // disk fingerprint and the actual read source; null tells the client the
    // snapshot is unstable and must not be cached as fresh.
    const latestEntry = allEntries[allEntries.length - 1] as { id?: string } | undefined;
    const snapshotRevision = computeSessionRevision({
      filePath,
      sourceId: liveRpc ? `runtime:${String(liveRpc.inner.sessionId)}` : "disk",
      entryCount: allEntries.length,
      latestEntryId: typeof latestEntry?.id === "string" ? latestEntry.id : null,
      leafId: leafId ?? null,
    });
    const sessionName = sm.getSessionName();

    if (initialView) {
      return jsonResponse(req, { sessionId: id, filePath, leafId, context });
    }

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath!).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const subagent = header
      ? readSubagentRun(allEntries, header.id, filePath ?? "")
      : null;
    const toolNames = readSubagentSessionResources(allEntries)?.tools
      ?? readSessionToolSelection(allEntries);
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
        ? { relation: {
            kind: "subagent" as const,
            parentSessionId: subagent.parentSessionId,
            profile: subagent.profile,
            description: subagent.description,
            status: liveRpc?.isRunning() ? "running" as const : subagent.status,
            // The run's own start/finish; the parent's Agent tool result has no
            // completedAt for a background run.
            ...(subagent.createdAt ? { createdAt: subagent.createdAt } : {}),
            ...(subagent.completedAt ? { completedAt: subagent.completedAt } : {}),
          } }
        : header.parentSession
          ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
          : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return perf?.attach(jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    )) ?? jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    );
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
      // PATCH writes via appendSessionInfo — open fresh, bypassing the cache.
      const sm = openSessionManager(filePath, { mutable: true });
      sm.appendSessionInfo(name.trim());
      // The cached read-only manager for this path is now stale.
      invalidateSessionManagerCache(filePath);
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
  // Fence the target before the first async file lookup. New starts fail closed;
  // already-started SDK work loses persistence before it can return late.
  const barriers = [beginRpcSessionMutation([id])];
  const removedIds: string[] = [];
  try {
    await barriers[0].ready;
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    // Quiesce the parent before discovering its descendants. Otherwise an
    // active parent could spawn another child after the catalogue snapshot.
    try { await abortSubagent(id); } catch { /* ordinary session */ }
    getRpcSession(id)?.revokePersistenceForDeletion();
    await getRpcSession(id)?.shutdown().catch(() => undefined);

    // Re-attach all direct children to this session's parent (cascade
    // re-parent). Two discovery sources: same-directory siblings (cheap,
    // catches fresh forks) and the cached session list (catches forks into
    // other project directories).
    const childPaths = new Set<string>();
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);

    // Deleting a session also deletes every persisted or live subagent below
    // it: a subagent is an implementation detail of its parent, so leaving its
    // transcript behind would surface as an orphan row with a missing root.
    const sessions = mergeSessionLists(
      await listAllSessions({ force: true }),
      getRpcSessionInfos({ includeTransient: true }),
    );
    const childrenByParent = new Map<string, string[]>();
    for (const session of sessions) {
      if (session.relation?.kind !== "subagent") continue;
      const children = childrenByParent.get(session.relation.parentSessionId) ?? [];
      children.push(session.id);
      childrenByParent.set(session.relation.parentSessionId, children);
    }
    const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
    // The catalogue can be stale or scoped to other projects; also read the
    // sibling files directly so a just-created subagent is still found.
    try {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        const childPath = join(dir, file);
        if (sessionPathKey(childPath) === targetPathKey) continue;
        try {
          const lines = readFileSync(childPath, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
          const header = JSON.parse(lines[0]) as { type?: string; id?: string };
          if (header.type !== "session" || typeof header.id !== "string") continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          const subagent = readSubagentRun(entries, header.id, childPath);
          if (!subagent) continue;
          const children = childrenByParent.get(subagent.parentSessionId) ?? [];
          children.push(header.id);
          childrenByParent.set(subagent.parentSessionId, children);
          sessionPaths.set(header.id, childPath);
        } catch { /* skip malformed or concurrently removed sessions */ }
      }
    } catch { /* skip if dir unreadable */ }
    const deletedSessionIds = new Set<string>([id]);
    const pendingDelete = [id];
    while (pendingDelete.length > 0) {
      const parentId = pendingDelete.pop()!;
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (deletedSessionIds.has(childId)) continue;
        deletedSessionIds.add(childId);
        pendingDelete.push(childId);
      }
    }
    // Close admission for the whole discovered descendant set before yielding
    // again; no process-wide lock is held for unrelated conversations.
    const descendantsBarrier = beginRpcSessionMutation([...deletedSessionIds].filter((deletedId) => deletedId !== id));
    barriers.push(descendantsBarrier);
    await descendantsBarrier.ready;
    const deletedPaths = new Map<string, string>([[id, filePath]]);
    for (const deletedId of deletedSessionIds) {
      const sessionPath = sessionPaths.get(deletedId);
      if (sessionPath) deletedPaths.set(deletedId, sessionPath);
    }
    for (const deletedId of deletedSessionIds) {
      if (deletedPaths.has(deletedId)) continue;
      const runtimePath = getRpcSession(deletedId)?.sessionFile;
      if (runtimePath) deletedPaths.set(deletedId, runtimePath);
      else {
        const resolvedPath = await resolveSessionPath(deletedId);
        if (resolvedPath) deletedPaths.set(deletedId, resolvedPath);
      }
    }
    const deletedPathKeys = new Set([...deletedPaths.values()].map((path) => sessionPathKey(path)));

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
      for (const file of files) {
        const childPath = join(dir, file);
        if (deletedPathKeys.has(sessionPathKey(childPath))) continue;
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
        // A subagent descendant is deleted below, not re-parented.
        if (deletedPathKeys.has(sessionPathKey(childPath))) continue;
        const preview = readSessionHeader(childPath);
        // samePath, not raw equality: Windows case/slash differences between
        // the recorded parentSession and this filePath would otherwise skip
        // the rewrite and orphan the fork (AGENTS.md path convention).
        if (!preview?.parentSession || !samePath(preview.parentSession, filePath)) continue;
        // Stop the child's wrapper FIRST: rewriting the file underneath a
        // live session races its appendFileSync and loses tail messages. The
        // shutdown can reject when the extension runner errors — never let
        // that skip the reparent rewrite (the child would keep pointing at a
        // deleted file and become an orphan).
        if (typeof preview.id === "string" && preview.id) {
          const childBarrier = beginRpcSessionMutation([preview.id]);
          barriers.push(childBarrier);
          await childBarrier.ready;
          // abort() drains SDK message_end handlers, including their deferred
          // transcript appends, before shutdown/dispose and the atomic rewrite.
          await getRpcSession(preview.id)?.drainForSessionRewrite();
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
        invalidateSessionManagerCache(childPath);
      } catch { /* skip malformed / unreadable child */ }
    }

    // Stop every descendant's live wrapper before unlinking (a running
    // subagent would otherwise keep appending to a deleted file).
    for (const deletedId of [...deletedSessionIds].reverse()) {
      if (deletedId === id) continue;
      try { await abortSubagent(deletedId); } catch { /* idle or completed */ }
      getRpcSession(deletedId)?.revokePersistenceForDeletion();
      await getRpcSession(deletedId)?.shutdown().catch(() => undefined);
    }

    for (const [deletedId, deletedPath] of deletedPaths) {
      try {
        unlinkSync(deletedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      removedIds.push(deletedId);
      // Sidecars must go after runtime shutdown; its final callbacks can persist
      // state until that point. In particular a running goal must not survive.
      try { removeQueue(deletedPath); } catch { /* sidecar absent */ }
      try { unlinkSync(goalSidecarPath(deletedPath)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await dropSessionArchiveEntry(getAgentDir(), deletedId).catch(() => undefined);
      invalidateSessionManagerCache(deletedPath);
      invalidateSessionPathCache(deletedId);
    }
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    for (const barrier of barriers.reverse()) barrier.finish(removedIds);
  }
}
