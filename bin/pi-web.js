#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions, assessLanExposure } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");

// Apply the undici CVE fix (formerly a postinstall hook). Running it here —
// before the pi agent's undici can be loaded — keeps installs quiet under
// npm >= 11.16's allow-scripts policy and survives installs that skip scripts.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./fix-pi-agent-undici").applyUndiciFix();
} catch {
  // Best-effort; the app still starts with the shrinkwrapped undici if the
  // fix cannot be applied.
}

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Self-heal a broken process cwd: when this launcher itself is spawned from a
// directory that was deleted (launchd working-directory churn, temp dirs), the
// cwd stays invalid for our whole lifetime and every stdio MCP child inherits
// it — node engines then die at startup with `process.cwd ENOENT (uv_cwd)`.
// Land on the package directory before anything spawns.
try {
  process.cwd();
} catch {
  process.chdir(pkgDir);
}

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

/**
 * Load configuration from the user's home, not the install directory.
 *
 * A `.env` next to the package is lost on every `npm install -g`
 * (the install directory is replaced wholesale), which silently drops the
 * password and host allowlist. Reading from `~/.pi/` keeps the settings across
 * upgrades. Values already present in the environment win, so a supervisor can
 * still override a single variable.
 */
function loadUserEnv() {
  const candidates = [
    path.join(os.homedir(), ".pi", "agent", "pi-web.env"),
    path.join(os.homedir(), ".pi", "pi-web.env"),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const applied = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    // Strip one layer of matching quotes, as dotenv does.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    applied.push(key);
  }
  return { file, applied };
}

// Before option parsing, so a port or host recorded in the file takes effect.
const userEnv = loadUserEnv();

let launchOptions;
try {
  launchOptions = parseLaunchOptions();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
if (launchOptions.help) {
  const { getHelpText } = require("./pi-web-options");
  process.stdout.write(getHelpText());
  process.exit(0);
}
const { port, hostname, openBrowser } = launchOptions;

if (userEnv) {
  // Names only — never echo values into a log that may be captured.
  console.log(`Loaded ${userEnv.applied.length} setting(s) from ${userEnv.file}${userEnv.applied.length ? `: ${userEnv.applied.join(", ")}` : ""}`);
}

// Apply the same heap cap as the npm scripts so `pi-web` (production entry)
// never lets the V8 heap balloon to Next.js's auto 50%-of-RAM default.
const { mergedNodeOptions } = require("./with-memory-limit");
process.env.NODE_OPTIONS = mergedNodeOptions(process.env.NODE_OPTIONS);

// Idle memory watchdog, loaded only into the next-server process. Injected as
// a node CLI arg (not NODE_OPTIONS) so agent-spawned child processes never
// inherit it. Disabled with PI_WEB_RSS_RESTART_MB=0; the module itself also
// refuses to run when it doesn't know the port to ask about running sessions.
const watchdogPreload = path.join(__dirname, "watchdog-preload.js");

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const lanExposure = assessLanExposure(hostname);
if (lanExposure === "warn-plaintext") {
  console.warn("Pi Web is exposed beyond loopback. HTTP Basic Auth does not encrypt credentials; use HTTPS or a trusted VPN.");
} else if (lanExposure === "warn-insecure-lan") {
  console.warn("Pi Web is exposed beyond loopback WITHOUT authentication (PI_WEB_ALLOW_INSECURE_LAN=1). Anyone on the network can run agent commands on this machine.");
} else if (lanExposure === "refuse") {
  // Hard fail: an unauthenticated listener on a LAN address hands every
  // device on the network full read access to sessions/files plus
  // same-origin write access (agent prompts, task shell commands).
  console.error("Refusing to start: Pi Web is bound to " + hostname + " (beyond loopback) but PI_WEB_PASSWORD is not set.");
  console.error("Set PI_WEB_PASSWORD to require HTTP Basic Auth, bind to 127.0.0.1 instead, or set PI_WEB_ALLOW_INSECURE_LAN=1 to override.");
  process.exit(1);
}

const nextArgs = ["start", "-p", port, "-H", hostname];

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
// PWD is exported explicitly: under launchd (and other minimal supervisors)
// the chain sets no PWD env var, so agent-spawned MCP stdio children used to
// inherit an empty one — enough to hang shell-based MCP wrappers that do a
// "$PWD"-based workspace upward lookup (dirname "" → "." forever).
const child = spawn(process.execPath, ["--require", watchdogPreload, nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PWD: pkgDir, PI_WEB_HOSTNAME: hostname, PI_WEB_PORT: String(port) },
});
wireChildProcessLifecycle(child);

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    // Avoid `shell: true` to suppress Node.js DEP0190 deprecation
    // ("Passing args to a child process with shell option true can lead to
    // security vulnerabilities, as the arguments are not escaped").
    // Pass a structured argv so Node.js handles escaping instead of
    // concatenating the args into a shell command string.
    let opener;
    if (isWindows) {
      // `start` is a cmd.exe built-in, so invoke cmd directly. The empty
      // title argument is required by `start` before the target URL.
      opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      });
    } else if (isMac) {
      opener = spawn("open", [url], {
        stdio: "ignore",
        detached: true,
      });
    } else {
      opener = spawn("xdg-open", [url], {
        stdio: "ignore",
        detached: true,
      });
    }

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});
