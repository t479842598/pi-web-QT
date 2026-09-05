"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const CLI_OPTIONS = {
  port: { type: "string", short: "p" },
  hostname: { type: "string", short: "H" },
  "no-open": { type: "boolean" },
  open: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

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

module.exports = { parseLaunchOptions, assessLanExposure };

function getHelpText() {
  return `Usage: pi-web [options]

Start the Pi Web UI server.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 0.0.0.0 LAN, or PI_WEB_HOSTNAME)
      --open                 Open a browser automatically (off by default)
  -h, --help                 Show this help message and exit

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_HOSTNAME            Default hostname when --hostname is omitted
  PI_WEB_NO_OPEN             Set to 1/true/yes/on to disable browser open
  PI_WEB_PASSWORD            Enable HTTP Basic Auth (username is always "pi")
  PI_WEB_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated
`;
}
function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${message}\nUse --help to see available options.`);
    err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw err;
  }

  if (values.help) {
    return { help: true };
  }

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(" ")}\nUse --help to see available options.`,
    );
  }

  return {
    help: false,
    port: normalizePort(values.port ?? env.PORT ?? "30141"),
    // Fork：默认 0.0.0.0 供局域网/手机访问（配合 assessLanExposure 的安全门槛）。
    hostname: values.hostname ?? env.PI_WEB_HOSTNAME ?? "0.0.0.0",
    // Fork：默认不自动开浏览器（常驻服务/launchd 场景），--open 显式开启。
    openBrowser: values.open === true && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions, assessLanExposure, getHelpText };
