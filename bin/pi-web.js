#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pi-web-options");

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

const { port, hostname, openBrowser } = parseLaunchOptions();

// Apply the same heap cap as the npm scripts so `pi-web` (production entry)
// never lets the V8 heap balloon to Next.js's auto 50%-of-RAM default.
const { mergedNodeOptions } = require("./with-memory-limit");
process.env.NODE_OPTIONS = mergedNodeOptions(process.env.NODE_OPTIONS);

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
if (!isLoopback) {
  if (process.env.PI_WEB_PASSWORD) {
    console.warn("Pi Web is exposed beyond loopback. HTTP Basic Auth does not encrypt credentials; use HTTPS or a trusted VPN.");
  } else if (process.env.PI_WEB_ALLOW_INSECURE_LAN === "1") {
    console.warn("Pi Web is exposed beyond loopback WITHOUT authentication (PI_WEB_ALLOW_INSECURE_LAN=1). Anyone on the network can run agent commands on this machine.");
  } else {
    // Hard fail: an unauthenticated listener on a LAN address hands every
    // device on the network full read access to sessions/files plus
    // same-origin write access (agent prompts, task shell commands).
    console.error("Refusing to start: Pi Web is bound to " + hostname + " (beyond loopback) but PI_WEB_PASSWORD is not set.");
    console.error("Set PI_WEB_PASSWORD to require HTTP Basic Auth, bind to 127.0.0.1 instead, or set PI_WEB_ALLOW_INSECURE_LAN=1 to override.");
    process.exit(1);
  }
}

const nextArgs = ["start", "-p", port, "-H", hostname];

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PI_WEB_HOSTNAME: hostname },
});

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
