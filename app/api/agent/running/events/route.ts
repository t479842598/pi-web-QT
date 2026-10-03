import { getRunningRpcSessionSnapshots, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // abort fires on most disconnects, but some tunnel/proxy paths cancel the
  // stream without the request's abort signal ever firing; cancel() then
  // releases the bus listener immediately instead of at the idle cap.
  let onStreamCancel: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let idleTimeout: ReturnType<typeof setTimeout> | undefined;
      // Idle close, sliding: the cap guards against half-open connections
      // that never fire abort, while every real frame re-arms it so a healthy
      // long-lived stream is not decapitated at the two-hour mark.
      const bumpIdle = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(cleanup, 2 * 60 * 60 * 1000);
      };
      const encode = (data: unknown) => {
        bumpIdle();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
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
        onStreamCancel = null;
        try { controller.close(); } catch { /* closed */ }
      }
      req.signal.addEventListener("abort", cleanup, { once: true });
      bumpIdle();
      onStreamCancel = cleanup;
    },
    cancel() {
      onStreamCancel?.();
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
