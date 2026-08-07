import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { loadTasks } from "@/lib/task-store";
import { createTask } from "@/lib/task-engine";
import type { WorkTaskConfig } from "@/lib/task-types";

/** Task projects must be real directories the user already works in. */
function isPlausibleProjectRoot(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.startsWith("/");
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

// GET /api/tasks?projectRoot= → WorkTask[]
// (Note: /api/tasks/projects is served by app/api/tasks/[id]/route.ts, which
//  shadows the static segment before this route sees it.)
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const projectRoot = new URL(req.url).searchParams.get("projectRoot");
    const tasks = projectRoot ? loadTasks(projectRoot) : [];
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/tasks  body: { projectRoot, title, config? } → WorkTask
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const body = (await req.json()) as {
      projectRoot?: unknown;
      title?: unknown;
      config?: unknown;
    };
    if (!isPlausibleProjectRoot(body.projectRoot)) {
      return NextResponse.json({ error: "projectRoot is required" }, { status: 400 });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const task = createTask({
      projectRoot: body.projectRoot,
      title: body.title.trim(),
      config: parseConfig(body.config),
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
