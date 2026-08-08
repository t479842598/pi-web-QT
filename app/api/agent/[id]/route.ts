import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { removeQueue } from "@/lib/queue-store";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    // Abort-style commands only make sense for a live session. When the wrapper
    // is gone (idle-reaped) there is nothing to stop, so answer immediately
    // instead of paying a full cold start (~20s model listing) just to abort.
    if (body.type === "abort" || body.type === "abort_bash") {
      return NextResponse.json({ success: true, data: null });
    }

    // clear_queue is persisted in the queue sidecar and restored when the
    // wrapper is recreated, so a silent success would leave the queue alive.
    // Drop the sidecar directly and answer without paying a cold start.
    if (body.type === "clear_queue") {
      const filePath = await resolveSessionPath(id);
      if (filePath) removeQueue(filePath);
      return NextResponse.json({ success: true, data: null });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const { session } = await startRpcSession(id, filePath, undefined);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
