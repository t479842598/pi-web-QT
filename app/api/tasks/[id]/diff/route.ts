import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { loadTask } from "@/lib/task-store";
import { getGitFileDiff } from "@/lib/git-changes";

// GET /api/tasks/[id]/diff?projectRoot=&file= → { patch?, status?, supported }
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.length - 2]);
    const projectRoot = url.searchParams.get("projectRoot");
    const file = url.searchParams.get("file");
    if (!Number.isInteger(id) || id <= 0 || !projectRoot || !file) {
      return NextResponse.json({ error: "id, projectRoot and file are required" }, { status: 400 });
    }
    const task = loadTask(projectRoot, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (!task.worktreePath) {
      return NextResponse.json({ supported: false });
    }
    const diff = await getGitFileDiff(task.worktreePath, file);
    return NextResponse.json(diff);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
