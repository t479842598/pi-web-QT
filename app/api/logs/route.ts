import { NextResponse } from "next/server";
import { clearErrorLogs, getErrorLogs, recordErrorLog } from "@/lib/error-log";
import type { ErrorLogLevel } from "@/lib/error-log-types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const LEVELS = new Set<ErrorLogLevel>(["error", "warning", "info"]);

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const rawCodeText = params.get("statusCode");
  const rawCode = rawCodeText ? Number(rawCodeText) : Number.NaN;
  const level = params.get("level") as ErrorLogLevel | null;
  return NextResponse.json({
    entries: getErrorLogs({
      ...(Number.isInteger(rawCode) ? { statusCode: rawCode } : {}),
      ...(level && LEVELS.has(level) ? { level } : {}),
      ...(params.get("source") ? { source: params.get("source")! } : {}),
      ...(params.get("query") ? { query: params.get("query")! } : {}),
      limit: Number(params.get("limit")) || 200,
    }),
  });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message : "Unknown error";
    const level = body.level === "warning" || body.level === "info" ? body.level : "error";
    const statusCode = typeof body.statusCode === "number" && Number.isInteger(body.statusCode) ? body.statusCode : undefined;
    const entry = recordErrorLog({
      level,
      statusCode,
      source: typeof body.source === "string" ? body.source : "client",
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      message,
    });
    return NextResponse.json({ success: true, id: entry.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  clearErrorLogs();
  return NextResponse.json({ success: true });
}
