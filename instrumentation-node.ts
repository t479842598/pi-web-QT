import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";

export async function registerNodeInstrumentation(): Promise<void> {
  // Parent-death watchdog (desktop shell only): REMOVED.
  // Keep-alive: the bundled backend must STAY RUNNING after the desktop shell
  // (GUI) exits so other clients / browsers can reuse 30141. Stop explicitly
  // via the UI ("关闭本机服务", stop_local) or a password-change restart.

  // Apply proxy settings from ~/.pi/agent/settings.json before the global
  // Undici dispatcher is created so EnvHttpProxyAgent sees them on boot.
  const { readProxyConfig, applyProxyEnv } = await import("@/lib/proxy-config");
  applyProxyEnv(readProxyConfig());

  configureHttpDispatcher();

  // Start the work-task engine (single-process lock; the first server to
  // register owns it). Import is async so the engine's heavier deps (pi SDK)
  // don't delay boot when there are no tasks.
  try {
    const { ensureTaskEngine } = await import("@/lib/task-engine");
    ensureTaskEngine();
  } catch {
    // Engine startup is best-effort at boot; task commands report
    // "engine not running" and the next request can retry.
  }

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
