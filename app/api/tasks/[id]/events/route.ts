import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { loadTaskEvents } from "@/lib/task-store";

// GET /api/tasks/[id]/events?projectRoot=&limit=
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.length - 2]);
    const projectRoot = url.searchParams.get("projectRoot");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 2000);

    if (!Number.isInteger(id) || id <= 0 || !projectRoot) {
      return NextResponse.json({ error: "id and projectRoot are required" }, { status: 400 });
    }
    const events = loadTaskEvents(projectRoot, id, limit);
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
