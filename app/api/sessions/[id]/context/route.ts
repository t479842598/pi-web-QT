import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext, openSessionCached } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // A live wrapper's SessionManager sees in-flight entries a cold file read
    // would miss (transient sessions); fall back to the cached file reader.
    const sm = liveRpc?.inner.sessionManager ?? (filePath ? openSessionCached(filePath) : undefined);
    if (!sm) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const context = buildSessionContext(sm.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
