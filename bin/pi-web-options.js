"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: cliArgs.port ?? env.PORT ?? "30141",
    // Default to 0.0.0.0 so phones/other devices on the LAN can reach the
    // web UI (the app is protected by HTTP Basic Auth when PI_WEB_PASSWORD
    // is set). Use -H 127.0.0.1 to restrict to this machine only.
    hostname: cliArgs.hostname ?? env.PI_WEB_HOSTNAME ?? "0.0.0.0",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions };
