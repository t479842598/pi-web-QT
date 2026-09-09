import { getRunningRpcSessionSnapshots, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const unsubscribe = subscribeRunningSessions((sessions) => {
        try { encode({ type: "running", sessions, runningSessionIds: sessions.map((session) => session.id) }); } catch { /* closed */ }
      });

      const initial = getRunningRpcSessionSnapshots();
      try { encode({ type: "running", sessions: initial, runningSessionIds: initial.map((session) => session.id) }); } catch { /* closed */ }
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(":\n\n")); } catch { /* closed */ }
      }, 30_000);
      function cleanup() {
        clearInterval(heartbeat);
        clearTimeout(idleTimeout);
        unsubscribe();
        try { controller.close(); } catch { /* closed */ }
      }
      req.signal.addEventListener("abort", cleanup, { once: true });
      // Idle close: guard against half-open connections that never fire abort.
      const idleTimeout = setTimeout(cleanup, 2 * 60 * 60 * 1000);
    },
  });
  return new Response(stream, {
    // no-transform keeps intermediates (and Next's compression middleware,
    // which treats text/event-stream as compressible) from buffering the
    // stream; X-Accel-Buffering: no does the same for nginx-style proxies.
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
