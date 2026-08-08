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
      encode({ type: "running", sessions: initial, runningSessionIds: initial.map((session) => session.id) });
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(":\n\n")); } catch { /* closed */ }
      }, 30_000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* closed */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
