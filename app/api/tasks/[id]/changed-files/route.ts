import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { loadTask } from "@/lib/task-store";
import { getGitStatus } from "@/lib/git-changes";
import type { WorkTaskChangedFile } from "@/lib/task-types";

/** Changed files of a task worktree vs its recorded base. */
function changedFilesFromStatus(
  worktreePath: string,
  status: Awaited<ReturnType<typeof getGitStatus>>,
): WorkTaskChangedFile[] {
  if (!status.isGitRepository || !status.repositoryRoot) return [];
  const base = status.repositoryRoot;
  const files = status.files.map((f) => {
    const relative = f.filePath.startsWith(base + "/")
      ? f.filePath.slice(base.length + 1)
      : f.filePath;
    return {
      file: relative,
      // Per-file line stats are not exposed; use the file's status kind as a
      // cheap proxy (the board's aggregate +/- comes from status.additions).
      additions: f.status === "deleted" ? 0 : 1,
      deletions: f.status === "deleted" ? 1 : 0,
    };
  });
  // Sort: directories first, then by path (stable).
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

// GET /api/tasks/[id]/changed-files?projectRoot=
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.length - 2]);
    const projectRoot = url.searchParams.get("projectRoot");
    if (!Number.isInteger(id) || id <= 0 || !projectRoot) {
      return NextResponse.json({ error: "id and projectRoot are required" }, { status: 400 });
    }
    const task = loadTask(projectRoot, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (!task.worktreePath) {
      return NextResponse.json({ files: [] });
    }
    const status = await getGitStatus(task.worktreePath);
    const files = changedFilesFromStatus(task.worktreePath, status);
    return NextResponse.json({
      files,
      additions: status.additions,
      deletions: status.deletions,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
