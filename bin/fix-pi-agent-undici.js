"use strict";

// Fix: @earendil-works/pi-coding-agent@0.83.0 ships with an npm-shrinkwrap.json
// that pins undici to 8.5.0, which has 7+ known CVEs. npm overrides cannot
// penetrate shrinkwrap. This script:
//   1. Removes the shrinkwrap (so future reinstalls respect overrides)
//   2. Symlinks the nested undici to the top-level undici@^8.10.0
//
// Note: npm audit will still report undici CVEs because the lockfile
// references the old version. This is a cosmetic false positive — the
// code loaded at runtime is undici@^8.10.0.
//
// The fix used to run as a `postinstall` hook. It now runs lazily at
// `pi-web` startup (bin/pi-web.js) and before the repo's dev/start scripts.
// Moving it out of postinstall keeps `npm install` output quiet under
// npm >= 11.16's allow-scripts policy and guarantees the fix applies even on
// installs where lifecycle scripts are blocked or skipped.

const fs = require("fs");
const path = require("path");

function applyUndiciFix(rootDir = path.join(__dirname, "..")) {
  const agentDir = path.join(
    rootDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  if (!fs.existsSync(agentDir)) return; // not installed here — nothing to fix

  const shrinkwrap = path.join(agentDir, "npm-shrinkwrap.json");
  const nestedUndici = path.join(agentDir, "node_modules", "undici");
  const topUndici = path.join(rootDir, "node_modules", "undici");

  // 1. Remove shrinkwrap
  if (fs.existsSync(shrinkwrap)) {
    console.log("[pi-web] Removing pi-coding-agent shrinkwrap…");
    fs.rmSync(shrinkwrap);
  }

  // 2. Replace nested undici@8.5.0 with symlink to top-level undici@^8.10.0
  if (
    fs.existsSync(topUndici) &&
    fs.existsSync(nestedUndici) &&
    // Only replace if it's a real directory, not already a symlink
    fs.lstatSync(nestedUndici).isDirectory() &&
    !fs.lstatSync(nestedUndici).isSymbolicLink()
  ) {
    try {
      const nestedVersion = require(path.join(nestedUndici, "package.json")).version;
      const topVersion = require(path.join(topUndici, "package.json")).version;

      if (nestedVersion !== topVersion) {
        console.log(
          `[pi-web] Replacing pi-coding-agent's undici@${nestedVersion} ` +
            `→ symlink to undici@${topVersion}`,
        );
        fs.rmSync(nestedUndici, { recursive: true, force: true });

        const rel = path.relative(path.dirname(nestedUndici), topUndici);
        fs.symlinkSync(
          rel,
          nestedUndici,
          process.platform === "win32" ? "junction" : "dir",
        );
      }
    } catch (err) {
      console.warn("[pi-web] Symlink fix skipped:", err.message);
    }
  }
}

module.exports = { applyUndiciFix };

if (require.main === module) {
  applyUndiciFix();
}
