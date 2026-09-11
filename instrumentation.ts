export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Parent-death watchdog (desktop shell only): REMOVED.
  // Keep-alive: the bundled backend must STAY RUNNING after the desktop shell
  // (GUI) exits so other clients / browsers can reuse 30141. We therefore no
  // longer exit when the parent PID disappears. Stop explicitly via the UI
  // ("关闭本机服务", stop_local) or a password-change restart.

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

  // Outbound relay for remote access. Off unless PI_WEB_RELAY_URL is set —
  // an unconfigured install must not open an unexpected socket. Anchored on
  // globalThis so dev hot-reloads do not stack connections.
  try {
    const { ensureRelayClient } = await import("@/lib/relay-runtime");
    ensureRelayClient();
  } catch {
    // Relay is optional; the direct tunnel path is unaffected when it fails.
  }
}
