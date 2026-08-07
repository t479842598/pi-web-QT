import { isApiRequestAllowed } from "@/lib/request-security";
import { onTaskChange, type TaskChange } from "@/lib/task-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/events — SSE stream of task changes (task://changed).
 *
 * The engine (process-global singleton) broadcasts upsert/delete changes via
 * `onTaskChange`; every connected client receives them and refetches the task
 * list. Reconnect after an idle gap is handled by the client refetching on
 * mount and on `visibilitychange`/`online` (same idiom as agent events).
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return new Response("Access denied", { status: 403 });
  }

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (change: TaskChange) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(change)}\n\n`));
        } catch {
          // Client gone; the cleanup path below handles teardown.
        }
      };
      // Heartbeat so proxies don't close the idle connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 25_000);

      unsubscribe = onTaskChange(send);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // Abort handling (client disconnect / timeout).
      (req.signal as AbortSignal | undefined)?.addEventListener("abort", cleanup);
      // Also close after 2h idle so the server never accumulates dead streams.
      const idleTimeout = setTimeout(cleanup, 2 * 60 * 60 * 1000);
      // Keep the timeout from holding the stream open after cleanup.
      (controller as unknown as { _idleTimeout?: ReturnType<typeof setTimeout> })._idleTimeout = idleTimeout;
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
