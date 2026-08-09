export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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

  // Restore the OpenCode Zen external gateway when the config says it is
  // enabled, so the settings switch reflects a genuinely listening server
  // after restarts (previously the gateway only started when the config page
  // was saved, leaving "enabled but not running" states). Best-effort:
  // failures surface in the settings panel, never block boot.
  try {
    const { ensureExternalAccessServer } = await import("@/lib/opencode-zen-external");
    await ensureExternalAccessServer();
  } catch {
    // Boot-time best effort; the settings panel surfaces failures.
  }
}
