import { NextResponse } from "next/server";
import { basename } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  listHiddenProjects,
  hideProject,
  unhideProject,
} from "@/lib/project-visibility";
import { broadcastSessionBusEvent } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/visibility → { hidden: [{ key, path, name, hiddenAt }] }
 *
 * Server-side blacklist of projects removed from the sidebar project panel
 * ("移除项目" hides, it never deletes files). Shared across all devices.
 */
export async function GET() {
  return NextResponse.json({ hidden: listHiddenProjects(getAgentDir()) });
}

/**
 * POST /api/projects/visibility  body: { action: "hide" | "unhide", projectRoot: string, name?: string }
 *
 * Hides or restores a project root and broadcasts `project_visibility_changed`
 * so every other client refreshes its panel. Returns the latest hidden list.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { action?: unknown; projectRoot?: unknown; name?: unknown };
    const { action, projectRoot } = body;
    if ((action !== "hide" && action !== "unhide") || typeof projectRoot !== "string" || !projectRoot.trim()) {
      return NextResponse.json({ error: "action ('hide'|'unhide') and projectRoot are required" }, { status: 400 });
    }
    const agentDir = getAgentDir();
    if (action === "hide") {
      const name = typeof body.name === "string" && body.name.trim() ? body.name : basename(projectRoot.trim());
      await hideProject(agentDir, projectRoot.trim(), name);
    } else {
      await unhideProject(agentDir, projectRoot.trim());
    }
    broadcastSessionBusEvent("project_visibility_changed", projectRoot.trim(), { action });
    return NextResponse.json({ hidden: listHiddenProjects(agentDir) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
