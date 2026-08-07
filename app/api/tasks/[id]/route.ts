import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { loadTask } from "@/lib/task-store";
import { deleteTask, updateTask } from "@/lib/task-engine";
import type { WorkTaskConfig } from "@/lib/task-types";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseConfig(raw: unknown): WorkTaskConfig {
  const config = (raw ?? {}) as Partial<WorkTaskConfig>;
  const prompt = typeof config.prompt === "string" ? config.prompt : "";
  return {
    prompt,
    agentType: typeof config.agentType === "string" ? config.agentType : null,
    modelId: typeof config.modelId === "string" ? config.modelId : null,
    thinkingLevel: typeof config.thinkingLevel === "string" ? config.thinkingLevel : null,
    labelSnapshot:
      config.labelSnapshot && typeof config.labelSnapshot === "object"
        ? (config.labelSnapshot as Record<string, string>)
        : null,
  };
}

// GET /api/tasks/[id]?projectRoot= → WorkTask
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const idRaw = url.pathname.split("/").pop() ?? "";
    // /api/tasks/projects → project list (static segment shadowed by [id]).
    if (idRaw === "projects") {
      const { listTaskProjects } = await import("@/lib/task-store");
      return NextResponse.json({ projects: listTaskProjects() });
    }
    const id = parseId(idRaw);
    const projectRoot = url.searchParams.get("projectRoot");
    if (!id || !projectRoot) {
      return NextResponse.json({ error: "id and projectRoot are required" }, { status: 400 });
    }
    const task = loadTask(projectRoot, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/tasks/[id]  body: { projectRoot, title, config? }
export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const id = parseId(new URL(req.url).pathname.split("/").pop() ?? "");
    const body = (await req.json()) as { projectRoot?: unknown; title?: unknown; config?: unknown };
    if (!id || typeof body.projectRoot !== "string") {
      return NextResponse.json({ error: "id and projectRoot are required" }, { status: 400 });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const task = updateTask(id, {
      projectRoot: body.projectRoot,
      title: body.title.trim(),
      config: parseConfig(body.config),
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]?projectRoot=&deleteWorktree=1
export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const id = parseId(url.pathname.split("/").pop() ?? "");
    const projectRoot = url.searchParams.get("projectRoot");
    if (!id || !projectRoot) {
      return NextResponse.json({ error: "id and projectRoot are required" }, { status: 400 });
    }
    const task = loadTask(projectRoot, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const deleteWorktree = url.searchParams.get("deleteWorktree") === "1";
    await deleteTask(id, projectRoot, deleteWorktree);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
