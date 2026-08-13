import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  getProjectTabState,
  updateProjectTabState,
  MAX_PROJECT_TABS,
  type ProjectTabState,
} from "@/lib/project-tab-state";
import { broadcastSessionBusEvent } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/project-state → { tabs: string[], pinnedProject: string | null }
 *
 * Server-side source of truth for the top project tab bar and the leading
 * dropdown's pinned project, shared across all devices/windows connected to
 * this server. Invalid (non-existent directory) entries are pruned on read.
 */
export async function GET() {
  return NextResponse.json(getProjectTabState(getAgentDir()));
}

/**
 * PUT /api/project-state  body: { tabs?: string[], pinnedProject?: string | null }
 *
 * Field-level merge: only the provided fields overwrite the stored state, so
 * a device updating the tabs never clobbers another device's dropdown pin.
 * Broadcasts `project_state_changed` so every other client applies the new
 * state immediately.
 */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json().catch(() => null) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
    }
    const { tabs, pinnedProject } = body as { tabs?: unknown; pinnedProject?: unknown };
    const patch: Partial<ProjectTabState> = {};

    if (tabs !== undefined) {
      if (!Array.isArray(tabs)) {
        return NextResponse.json({ error: "tabs must be an array" }, { status: 400 });
      }
      patch.tabs = tabs
        .filter((p): p is string => typeof p === "string" && p.trim() !== "")
        .map((p) => p.trim())
        .slice(0, MAX_PROJECT_TABS);
    }
    if (pinnedProject !== undefined) {
      if (pinnedProject !== null && typeof pinnedProject !== "string") {
        return NextResponse.json({ error: "pinnedProject must be a string or null" }, { status: 400 });
      }
      const pinned = typeof pinnedProject === "string" ? pinnedProject.trim() : "";
      patch.pinnedProject = pinned || null;
    }

    // Nothing to change — no write, no broadcast.
    if (patch.tabs === undefined && patch.pinnedProject === undefined) {
      return NextResponse.json(getProjectTabState(getAgentDir()));
    }

    // The tabs array is replaced wholesale (last-write-wins per field): a
    // union merge is not viable because a close cannot be distinguished from
    // an add. Concurrent edits to different fields (tabs vs pinnedProject)
    // never clobber each other thanks to the field-level merge above.
    const state = updateProjectTabState(getAgentDir(), patch);
    broadcastSessionBusEvent("project_state_changed", "", state);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
