import { NextResponse } from "next/server";
import { readOpenCodeZenConfig } from "@/lib/opencode-zen";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Return the saved external-access API key so the UI can copy it. */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const apiKey = readOpenCodeZenConfig().externalAccess.apiKey;
  if (!apiKey) return NextResponse.json({ error: "尚未设置外部调用 API Key" }, { status: 404 });
  return NextResponse.json({ apiKey });
}
