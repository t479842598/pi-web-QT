import { NextResponse } from "next/server";
import { getVisionConfigPath, readSafeVisionConfig, writeVisionConfig } from "@/lib/vision-config";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return NextResponse.json({ ...readSafeVisionConfig(), path: getVisionConfigPath() });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as Record<string, unknown>;
    writeVisionConfig({
      provider: typeof body.provider === "string" ? body.provider : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
    });
    return NextResponse.json({ success: true, ...readSafeVisionConfig(), path: getVisionConfigPath() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
