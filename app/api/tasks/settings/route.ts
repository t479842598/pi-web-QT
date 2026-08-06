import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  deleteSettingsRow,
  loadEffectiveSettings,
  loadSettingsRow,
  saveSettingsRow,
} from "@/lib/task-store";
import { defaultTaskSettings } from "@/lib/task-types";
import { nudgePump } from "@/lib/task-engine";
import type { WorkTaskFolderSettings } from "@/lib/task-types";

// GET /api/tasks/settings?projectRoot=&own=1 → effective (or own) settings
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const projectRoot = url.searchParams.get("projectRoot");
    if (!projectRoot) {
      return NextResponse.json({ error: "projectRoot is required" }, { status: 400 });
    }
    const own = url.searchParams.get("own") === "1";
    const settings = own ? loadSettingsRow(projectRoot) : loadEffectiveSettings(projectRoot);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/tasks/settings  body: { projectRoot, settings }
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const body = (await req.json()) as { projectRoot?: unknown; settings?: unknown };
    if (typeof body.projectRoot !== "string") {
      return NextResponse.json({ error: "projectRoot is required" }, { status: 400 });
    }
    const raw = (body.settings ?? {}) as Partial<WorkTaskFolderSettings>;
    const settings: WorkTaskFolderSettings = {
      ...defaultTaskSettings(),
      ...raw,
      configValues: raw.configValues && typeof raw.configValues === "object"
        ? { ...raw.configValues }
        : {},
    };
    saveSettingsRow(body.projectRoot, settings);
    nudgePump(body.projectRoot);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/tasks/settings?projectRoot= → revert to global defaults
export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const projectRoot = new URL(req.url).searchParams.get("projectRoot");
    if (!projectRoot) {
      return NextResponse.json({ error: "projectRoot is required" }, { status: 400 });
    }
    deleteSettingsRow(projectRoot);
    nudgePump(projectRoot);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
