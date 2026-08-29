"use strict";

// Idle memory watchdog for the next-server process. V8 only returns freed
// heap to the OS on process exit, so a long-running server's RSS settles at
// its high-water mark no matter how much GC reclaims internally. This module
// watches RSS and exits the process once it has stayed above the threshold
// while no agent session is running; the supervisor (launchd KeepAlive) then
// starts a fresh process.

const DEFAULT_RESTART_MB = 1229;
const DEFAULT_CHECK_MINUTES = 5;
const CONSECUTIVE_OVER_LIMIT = 2;
const STARTUP_GRACE_TICKS = 3;
const RUNNING_CHECK_TIMEOUT_MS = 5000;

function parsePositiveInt(raw, fallback, minimum) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < minimum) return fallback;
  return n;
}

/**
 * Resolve the watchdog config from env. Returns null when the watchdog must
 * not run: explicitly disabled (PI_WEB_RSS_RESTART_MB=0), running on Windows
 * (no launchd-style supervisor to restart us, and auto-restart is not wanted
 * there), or no port known (without a port we cannot ask /api/agent/running
 * and must never exit).
 */
function resolveConfig(env) {
  if (process.platform === "win32") return null;
  const rawRestart = env.PI_WEB_RSS_RESTART_MB;
  if (rawRestart !== undefined && rawRestart !== "" && Number(rawRestart) === 0) {
    return null;
  }
  const port = Number.parseInt(env.PI_WEB_PORT ?? "", 10);
  if (!Number.isFinite(port) || port <= 0) return null;
  return {
    port,
    hostname: env.PI_WEB_HOSTNAME || "127.0.0.1",
    restartMb: parsePositiveInt(rawRestart, DEFAULT_RESTART_MB, 1),
    checkMinutes: parsePositiveInt(env.PI_WEB_RSS_CHECK_MINUTES, DEFAULT_CHECK_MINUTES, 1),
  };
}

function basicAuthHeaders(env) {
  // Next.js loads PI_WEB_PASSWORD from .env in production, and the proxy gate
  // rejects unauthenticated /api calls. Reuse the credential this process
  // already holds so the loopback check passes without weakening auth.
  const password = env.PI_WEB_PASSWORD;
  if (!password) return undefined;
  return { authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}` };
}

async function isServerIdle(config, env) {
  const res = await fetch(`http://${config.hostname}:${config.port}/api/agent/running`, {
    headers: basicAuthHeaders(env),
    signal: AbortSignal.timeout(RUNNING_CHECK_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const ids = Array.isArray(data && data.runningSessionIds) ? data.runningSessionIds : [];
  return ids.length === 0;
}

/**
 * Start the watchdog loop in the current process. Never throws; failures to
 * check are skipped conservatively (streak reset) so a transient error can
 * never cause an exit.
 */
function startMemoryWatchdog(log = defaultLog) {
  const config = resolveConfig(process.env);
  if (!config) return null;

  let ticks = 0;
  let overLimitStreak = 0;
  let loggedNonIdle = false;
  log(`watching RSS every ${config.checkMinutes}min, restart at >= ${config.restartMb}MB when idle (grace: ${STARTUP_GRACE_TICKS} ticks)`);

  const timer = setInterval(() => {
    ticks += 1;
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (ticks <= STARTUP_GRACE_TICKS || rssMb < config.restartMb) {
      overLimitStreak = 0;
      return;
    }
    isServerIdle(config, process.env)
      .then((idle) => {
        if (idle !== true) {
          // Sessions running, or the check failed — never exit on unknown state.
          if (!loggedNonIdle) {
            loggedNonIdle = true;
            log(`over limit (${Math.round(rssMb)}MB) but idle check says ${idle === null ? "unavailable (check failed)" : "sessions running"}; not restarting`);
          }
          overLimitStreak = 0;
          return;
        }
        overLimitStreak += 1;
        log(`RSS ${Math.round(rssMb)}MB >= ${config.restartMb}MB and idle (${overLimitStreak}/${CONSECUTIVE_OVER_LIMIT})`);
        if (overLimitStreak >= CONSECUTIVE_OVER_LIMIT) {
          clearInterval(timer);
          log("exiting so the supervisor can restart us and reclaim memory");
          process.exit(0);
        }
      })
      .catch((err) => {
        if (!loggedNonIdle) {
          loggedNonIdle = true;
          log(`over limit but idle check errored: ${err && err.message}; not restarting`);
        }
        overLimitStreak = 0;
      });
  }, config.checkMinutes * 60 * 1000);
  // The server itself keeps the process alive; the watchdog must never be the
  // reason a process stays up.
  timer.unref();
  return timer;
}

function defaultLog(message) {
  console.log(`[memory-watchdog] ${message}`);
}

module.exports = { startMemoryWatchdog, resolveConfig };

// CLI: `node bin/memory-watchdog.js` runs the loop in-process (smoke tests).
// The interval is unref'd for server use, so re-ref it to keep this process
// alive.
if (require.main === module) {
  const timer = startMemoryWatchdog();
  if (!timer) {
    console.log("[memory-watchdog] disabled (PI_WEB_RSS_RESTART_MB=0 or no PI_WEB_PORT)");
  } else {
    timer.ref();
  }
}
