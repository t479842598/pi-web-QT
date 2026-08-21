export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Parent-death watchdog (desktop shell only): the desktop app spawns the
  // backend with PI_WEB_PARENT_PID set. If the shell quits/crashes without its
  // normal cleanup (RunEvent::Exit), the backend would orphan and hold
  // :30141 forever — serving a stale bundle to the next app launch. Exit when
  // the parent is gone. CLI/dev paths never set the variable, so they keep
  // the lifecycle they have today.
  const parentPid = Number(process.env.PI_WEB_PARENT_PID ?? "");
  if (Number.isInteger(parentPid) && parentPid > 1) {
    const { isPidAlive } = await import("@/lib/process-alive");
    const intervalMs = Number(process.env.PI_WEB_PARENT_WATCHDOG_MS ?? "") || 10_000;
    const watchdog = setInterval(() => {
      if (!isPidAlive(parentPid)) {
        clearInterval(watchdog);
        process.exit(0);
      }
    }, intervalMs);
    watchdog.unref();
  }

  // Apply proxy settings from ~/.pi/agent/settings.json before the global
  // Undici dispatcher is created so EnvHttpProxyAgent sees them on boot.
  const { readProxyConfig, applyProxyEnv } = await import("@/lib/proxy-config");
  applyProxyEnv(readProxyConfig());

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
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
}
