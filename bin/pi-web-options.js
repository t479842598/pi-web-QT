"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/**
 * Decide how to handle a listener bound beyond loopback.
 * Returns one of:
 *  - "loopback"          : local-only, nothing to warn about
 *  - "warn-plaintext"    : password set, but Basic Auth over HTTP is plaintext
 *  - "warn-insecure-lan" : explicit PI_WEB_ALLOW_INSECURE_LAN=1 override
 *  - "refuse"            : no password and no override — must not start
 *
 * An unauthenticated LAN listener hands every device on the network full read
 * access to sessions/files plus same-origin write access (agent prompts, task
 * shell commands), so "refuse" is the safe default.
 */
function assessLanExposure(hostname, env = process.env) {
  if (isLoopbackHost(hostname)) return "loopback";
  if (env.PI_WEB_PASSWORD) return "warn-plaintext";
  if (isEnabled(env.PI_WEB_ALLOW_INSECURE_LAN)) return "warn-insecure-lan";
  return "refuse";
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      open:      { type: "boolean" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: normalizePort(cliArgs.port ?? env.PORT ?? "30141"),
    // Default to 0.0.0.0 so phones/other devices on the LAN can reach the
    // web UI (the app is protected by HTTP Basic Auth when PI_WEB_PASSWORD
    // is set). Use -H 127.0.0.1 to restrict to this machine only.
    hostname: cliArgs.hostname ?? env.PI_WEB_HOSTNAME ?? "0.0.0.0",
    // Do NOT auto-open the browser by default (server-style usage). Opt in
    // with --open; PI_WEB_NO_OPEN always wins.
    openBrowser: cliArgs.open === true && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions, assessLanExposure };
