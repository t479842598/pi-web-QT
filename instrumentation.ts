export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
