import { NextResponse } from "next/server";
import { importOpenCodeZenKeys, getSafeOpenCodeZenConfig } from "@/lib/opencode-zen";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { syncOpenCodeZenRuntime } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { text?: unknown };
    if (typeof body.text !== "string") return NextResponse.json({ error: "text is required" }, { status: 400 });
    const config = importOpenCodeZenKeys(body.text);
    await syncOpenCodeZenRuntime();
    return NextResponse.json({ success: true, ...config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), config: getSafeOpenCodeZenConfig() }, { status: 400 });
  }
}
