import { NextResponse } from "next/server";
import { getOpenCodeZenAccountProxy, testOpenCodeZenProxy, type OpenCodeZenProxy } from "@/lib/opencode-zen";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { accountId?: unknown; proxy?: OpenCodeZenProxy };
    const storedProxy = body.accountId && typeof body.accountId === "string"
      ? getOpenCodeZenAccountProxy(body.accountId)
      : null;
    const proxy = body.proxy
      ? { ...storedProxy, ...body.proxy, password: body.proxy.password || storedProxy?.password || "" }
      : storedProxy;
    if (!proxy) return NextResponse.json({ error: "proxy or accountId is required" }, { status: 400 });
    const result = await testOpenCodeZenProxy(proxy);
    return NextResponse.json({ ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
