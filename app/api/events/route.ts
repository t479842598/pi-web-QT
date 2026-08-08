import { subscribeSessionBus } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * GET /api/events — global SSE stream of session events across all clients.
 *
 * Each connected client holds ONE stream here (not per session); events carry
 * the sessionId and the client filters by the session it is viewing. Session
 * list refreshes and open-session message sync both consume this stream.
 */
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      const unsubscribe = subscribeSessionBus((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
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
