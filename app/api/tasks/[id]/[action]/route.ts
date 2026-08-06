import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { loadTask } from "@/lib/task-store";
import {
  archiveTask,
  cancelTask,
  mergeTask,
  requeueTask,
  retryTask,
  returnTask,
  startTask,
} from "@/lib/task-engine";

/**
 * POST /api/tasks/[id]/[action]?projectRoot=
 * actions: start | cancel | retry | requeue | return | merge | archive
 * Bodies (JSON):
 *   return  → { feedback: string }
 *   merge   → { message: string|null, deleteWorktree: boolean }
 *   archive → { archived: boolean }
 */
const ACTIONS = new Set(["start", "cancel", "retry", "requeue", "return", "merge", "archive"]);

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.length - 2]);
    const action = segments[segments.length - 1];
    const projectRoot = url.searchParams.get("projectRoot");

    if (!Number.isInteger(id) || id <= 0 || !projectRoot || !ACTIONS.has(action)) {
      return NextResponse.json({ error: "Invalid task action URL" }, { status: 400 });
    }
    const task = loadTask(projectRoot, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    switch (action) {
      case "start":
        await startTask(id, projectRoot);
        break;
      case "cancel":
        await cancelTask(id, projectRoot);
        break;
      case "retry":
        await retryTask(id, projectRoot);
        break;
      case "requeue":
        await requeueTask(id, projectRoot);
        break;
      case "return": {
        const feedback = typeof body.feedback === "string" ? body.feedback : "";
        if (!feedback.trim()) {
          return NextResponse.json({ error: "feedback is required" }, { status: 400 });
        }
        await returnTask(id, projectRoot, feedback.trim());
        break;
      }
      case "merge": {
        const message = typeof body.message === "string" ? body.message : null;
        const deleteWorktree = body.deleteWorktree !== false;
        await mergeTask(id, projectRoot, message, deleteWorktree);
        break;
      }
      case "archive": {
        const archived = body.archived !== false;
        await archiveTask(id, projectRoot, archived);
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
