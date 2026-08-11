import { stat } from "fs/promises";
import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getProjectAliases, setProjectAlias } from "@/lib/project-aliases";
import { broadcastSessionBusEvent } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/** GET /api/project-aliases → { aliases: Record<projectRoot, name> } */
export async function GET() {
  return NextResponse.json({ aliases: getProjectAliases(getAgentDir()) });
}

/**
 * PUT /api/project-aliases  body: { cwd, alias }
 * Sets (non-empty alias) or removes (empty/whitespace alias) the display
 * remark for a project root. Broadcasts to all connected clients so other
 * open windows refresh their alias map immediately.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; alias?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const cwd = body.cwd.trim();
    try {
      if (!(await stat(cwd)).isDirectory()) {
        return NextResponse.json({ error: "cwd must be a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 400 });
    }

    const alias = typeof body.alias === "string" ? body.alias : "";
    const agentDir = getAgentDir();
    const aliases = setProjectAlias(agentDir, cwd, alias);
    broadcastSessionBusEvent("project_alias_changed", cwd, { alias: alias.trim() });
    return NextResponse.json({ aliases });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
