import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveTranscriptPath, readSubagentTranscript, type SubagentTranscriptLine } from "@/lib/subagent-transcript";

export const dynamic = "force-dynamic";

/**
 * GET /api/subagents/transcript?id=<agentId>&cwd=<cwd>[&sessionId=<parentSessionId>]
 *
 * Reads a subagent's streaming .output transcript (JSONL) and returns the
 * conversation lines for the read-only right-panel viewer. Missing file →
 * `{ lines: [] }` (not an error) so the UI can show a graceful empty state.
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    const cwd = url.searchParams.get("cwd") ?? "";
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    if (!id || !cwd) {
      return NextResponse.json({ error: "id and cwd are required" }, { status: 400 });
    }
    const path = resolveTranscriptPath(cwd, id, sessionId);
    const lines: SubagentTranscriptLine[] = path ? readSubagentTranscript(path) : [];
    return NextResponse.json({ lines });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
