"use strict";

// Loaded into the next-server process via `node --require bin/watchdog-preload.js
// next start ...` (wired up in pi-web.js). Startup is deferred so a problem
// here can never delay or break server boot — worst case is one warn line and
// no watchdog.

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startMemoryWatchdog } = require("./memory-watchdog");
  setTimeout(() => {
    try {
      startMemoryWatchdog();
    } catch (err) {
      console.warn(`[memory-watchdog] failed to start: ${err && err.message}`);
    }
  }, 3000).unref();
} catch (err) {
  console.warn(`[memory-watchdog] preload failed: ${err && err.message}`);
}
