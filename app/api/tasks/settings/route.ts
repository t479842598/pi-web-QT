import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { isWindowsAbsolutePath } from "@/lib/paths";
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
    if (typeof body.projectRoot !== "string" || !(body.projectRoot.startsWith("/") || isWindowsAbsolutePath(body.projectRoot))) {
      return NextResponse.json({ error: "projectRoot is required" }, { status: 400 });
    }
    // These settings can register shell commands (initCommand/preflightCommand)
    // that the engine later executes — gate the write the same way project
    // plugin changes are gated: known root + project trust for commands.
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(body.projectRoot, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const raw = (body.settings ?? {}) as Partial<WorkTaskFolderSettings>;
    const registersCommand = Boolean(
      (typeof raw.initCommand === "string" && raw.initCommand.trim()) ||
      (typeof raw.preflightCommand === "string" && raw.preflightCommand.trim()),
    );
    if (registersCommand && !getProjectTrustStatus(body.projectRoot, getAgentDir()).trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before registering task shell commands" },
        { status: 403 },
      );
    }
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
