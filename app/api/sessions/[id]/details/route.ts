import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { openSessionCached, resolveSessionPath } from "@/lib/session-reader";
import { computeSessionDetails } from "@/lib/session-details";
import type { SessionEntry } from "@/lib/types";
import { projectTreeForResponse } from "@/lib/project-tree-response";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? (liveRpc.sessionFile || null) : await resolveSessionPath(id);
    if (!liveRpc && !filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const sm = liveRpc?.inner.sessionManager ?? openSessionCached(filePath!);
    const entries = sm.getEntries() as unknown as SessionEntry[];
    const details = computeSessionDetails(entries);
    return NextResponse.json({
      tree: projectTreeForResponse(sm.getTree()),
      ...details,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
