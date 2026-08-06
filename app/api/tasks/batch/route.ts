import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { reorderTasks, startAllTasks } from "@/lib/task-engine";

/**
 * POST /api/tasks/batch/reorder  body: { projectRoot, orderedIds: number[] }
 * POST /api/tasks/batch/start-all  body: { projectRoot?: string|null }
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    const body = (await req.json()) as {
      projectRoot?: unknown;
      orderedIds?: unknown;
    };

    if (mode === "reorder") {
      if (typeof body.projectRoot !== "string" || !Array.isArray(body.orderedIds)) {
        return NextResponse.json({ error: "projectRoot and orderedIds are required" }, { status: 400 });
      }
      const ids = body.orderedIds.filter((v): v is number => typeof v === "number" && Number.isInteger(v));
      await reorderTasks(body.projectRoot, ids);
      return NextResponse.json({ ok: true });
    }

    if (mode === "start-all") {
      const projectRoot = typeof body.projectRoot === "string" && body.projectRoot ? body.projectRoot : null;
      const claimed = await startAllTasks(projectRoot);
      return NextResponse.json({ claimed });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
