import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentEvent } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// These SDK events are not consumed by the web client and can be emitted for
// every streamed chunk. Omitting them avoids serializing duplicate payloads.
const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end", "tool_execution_update"]);

function toClientEvent(event: AgentEvent): AgentEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const clientEvent = { ...event };
    delete clientEvent.assistantMessageEvent;
    return clientEvent;
  }
  if (event.type === "agent_end") {
    // The desktop client uses these fields to show non-retryable provider
    // failures, unlike upstream's web-only client which needs no end payload.
    return {
      type: "agent_end",
      ...(event.willRetry !== undefined ? { willRetry: event.willRetry } : {}),
      ...(event.messages !== undefined ? { messages: event.messages } : {}),
    };
  }
  return event;
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    try {
      ({ session } = await startRpcSession(id, filePath, undefined));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });
      void session.send({ type: "get_state" }).then((state) => {
        try { encode({ type: "state_sync", sessionId: id, state }); } catch { /* controller already closed */ }
      }).catch(() => {});

      // --- Coalescing buffer for message_update events ---
      // Each message_update carries the full accumulated message. During
      // streaming, these fire ~every 50 chars — resending all prior content
      // each time, causing O(n²) bandwidth amplification (~100-250x). For
      // remote/VPN users this can turn a 15 KB response into 2+ MB on the
      // wire. Coalescing all message_updates within a short window and only
      // sending the latest one eliminates the quadratic curve.
      const COALESCE_MS = 80;
      let pendingUpdate: AgentEvent | null = null;
      let coalesceTimer: ReturnType<typeof setTimeout> | undefined;

      function flushPendingUpdate() {
        if (pendingUpdate) {
          try { encode(pendingUpdate); } catch { /* controller already closed */ }
          pendingUpdate = null;
        }
        if (coalesceTimer) {
          clearTimeout(coalesceTimer);
          coalesceTimer = undefined;
        }
      }

      const unsubscribe = session.onEvent((event) => {
        if (event.type === "message_end" || event.type === "tool_execution_end" || event.type === "agent_end") {
          invalidateSessionListCache();
        }
        const clientEvent = toClientEvent(event);
        if (!clientEvent) return;

        if (clientEvent.type === "message_update") {
          // Replace any pending update with the latest one and (re)start the
          // coalescing timer. Non-message_update events flush immediately.
          pendingUpdate = clientEvent;
          if (!coalesceTimer) {
            coalesceTimer = setTimeout(flushPendingUpdate, COALESCE_MS);
          }
        } else {
          // Flush any pending message_update before sending this event so
          // ordering is preserved (the buffered update logically precedes
          // whatever non-streaming event just arrived).
          flushPendingUpdate();
          try { encode(clientEvent); } catch { /* controller already closed */ }
        }
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      function cleanup() {
        clearInterval(heartbeat);
        clearTimeout(coalesceTimer);
        clearTimeout(idleTimeout);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }
      // Idle close: guard against half-open connections that never fire abort.
      // Mirrors the 2h cap already used by the tasks events route.
      const idleTimeout = setTimeout(cleanup, 2 * 60 * 60 * 1000);

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
