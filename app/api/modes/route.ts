import { NextResponse } from "next/server";
import { readModeSettings, writeModeSettings } from "@/lib/modes-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = new URL(req.url).searchParams.get("session");
  return NextResponse.json(readModeSettings(session || null));
}

export async function PUT(req: Request) {
  try {
    const session = new URL(req.url).searchParams.get("session");
    const body = await req.json() as Record<string, unknown>;
    const current = readModeSettings(session || null);
    const collab = body.collaborationMode;
    const token = body.tokenMode;
    const approval = body.toolApprovalMode;
    const rules = body.permissionRules;
    const next = {
      collaborationMode: collab === "normal" || collab === "plan" || collab === "goal"
        ? collab
        : current.collaborationMode,
      tokenMode: token === "full" || token === "economy" || token === "delivery"
        ? token
        : current.tokenMode,
      toolApprovalMode: approval === "ask" || approval === "auto" || approval === "yolo"
        ? approval
        : current.toolApprovalMode,
      permissionRules: rules && typeof rules === "object" && !Array.isArray(rules)
        ? {
            allow: Array.isArray((rules as Record<string, unknown>).allow) ? (rules as Record<string, string[]>).allow : current.permissionRules.allow,
            ask: Array.isArray((rules as Record<string, unknown>).ask) ? (rules as Record<string, string[]>).ask : current.permissionRules.ask,
            deny: Array.isArray((rules as Record<string, unknown>).deny) ? (rules as Record<string, string[]>).deny : current.permissionRules.deny,
          }
        : current.permissionRules,
    };
    await writeModeSettings(next, session || null);
    return NextResponse.json({ success: true, modes: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
