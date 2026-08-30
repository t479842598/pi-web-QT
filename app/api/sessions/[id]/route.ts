import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  invalidateOpenSessionCache,
  buildSessionContext,
  listAllSessions,
  attachSessionProjectInfo,
  openSessionCached,
  readSessionHeader,
} from "@/lib/session-reader";
import { getRpcSession, broadcastSessionBusEvent } from "@/lib/rpc-manager";
import { mutateSettingsJson } from "@/lib/settings-lock";
import { getAgentDir } from "@/lib/session-reader";
import { setSessionArchived, dropSessionArchiveEntry } from "@/lib/session-archive";
import { removeQueue } from "@/lib/queue-store";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import { stripModeInstructionBlocks } from "@/lib/modes";

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
  nodes: T[]
): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

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
    const tree = projectTreeForResponse(sm.getTree());
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries, leafId, { deferThinking, deferToolResultImages, tail, sessionId: id });
    const totalActiveMs = computeSessionTotalActiveMs(entries);
    // Cumulative usage over ALL entries (incl. history compacted away) so the
    // client keeps monotonic token/cost counters across compaction + reloads.
    const stats = computeSessionStats(entries as unknown as SessionEntry[]);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath!).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? (await attachSessionProjectInfo([{
      path: filePath ?? "",
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      // info aggregates span the WHOLE session file — derive them from the
      // full entries, not the tail-windowed context (long sessions would
      // otherwise report messageCount ≤ tail and a wrong firstMessage).
      messageCount: allEntries.filter((entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")).length,
      firstMessage: (() => {
        const firstUserEntry = allEntries.find((entry) => entry.type === "message" && entry.message.role === "user") as { message: { content: unknown } } | undefined;
        if (!firstUserEntry) return "(no messages)";
        const c = firstUserEntry.message.content;
        const raw = typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "";
        return stripModeInstructionBlocks(raw) || "(no messages)";
      })(),
      parentSessionId,
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

    // Re-attach all direct children to this session's parent (cascade
    // re-parent). Two discovery sources: same-directory siblings (cheap,
    // catches fresh forks) and the cached session list (catches forks into
    // other project directories).
    const childPaths = new Set<string>();
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          if (readSessionHeader(childPath)?.parentSession === filePath) childPaths.add(childPath);
        } catch { /* skip malformed */ }
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
