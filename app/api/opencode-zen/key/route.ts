import { NextResponse } from "next/server";
import { getOpenCodeZenAccountKey } from "@/lib/opencode-zen";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { accountId?: unknown };
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const apiKey = getOpenCodeZenAccountKey(accountId);
    if (!apiKey) return NextResponse.json({ error: "OpenCode Zen account not found" }, { status: 404 });
    return NextResponse.json({ apiKey });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
