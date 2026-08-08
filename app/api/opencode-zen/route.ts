import { NextResponse } from "next/server";
import { getSafeOpenCodeZenConfig, mergeOpenCodeZenConfig, readOpenCodeZenConfig, writeOpenCodeZenConfig } from "@/lib/opencode-zen";
import { restartExternalAccessServer } from "@/lib/opencode-zen-external";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { syncOpenCodeZenRuntime } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return NextResponse.json(getSafeOpenCodeZenConfig());
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { activeAccountId?: unknown } & Record<string, unknown>;
    const activeAccountId = typeof body.activeAccountId === "string" ? body.activeAccountId : undefined;
    writeOpenCodeZenConfig(mergeOpenCodeZenConfig(body), activeAccountId);
    await syncOpenCodeZenRuntime();
    await restartExternalAccessServer();
    return NextResponse.json({ success: true, ...getSafeOpenCodeZenConfig() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  writeOpenCodeZenConfig({ ...readOpenCodeZenConfig(), accounts: [] });
  await syncOpenCodeZenRuntime();
  return NextResponse.json({ success: true });
}
