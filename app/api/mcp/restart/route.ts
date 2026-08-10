import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const SERVER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * POST /api/mcp/restart — restart one MCP server through the active pi
 * session so its configuration (e.g. the deepseek-vision .env) takes effect
 * immediately, without restarting pi.
 *
 * Works because pi-mcp-extension registers /mcp:stop and /mcp:start commands,
 * and AgentSession.prompt() executes `/`-prefixed extension commands directly
 * (even while streaming) instead of sending them to the model.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as { sessionId?: unknown; name?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (!name || !SERVER_NAME_RE.test(name)) {
      return NextResponse.json({ error: "Invalid server name" }, { status: 400 });
    }

    const session = getRpcSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "No active session with that id" }, { status: 404 });
    }

    // Stop first, wait for the manager to mark it stopped, then start again.
    // startServer() is a no-op while the state is not "stopped", so the delay
    // matters — otherwise the start command could be swallowed by the still
    // stopping server.
    await session.send({ type: "prompt", message: `/mcp:stop ${name}` });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await session.send({ type: "prompt", message: `/mcp:start ${name}` });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
