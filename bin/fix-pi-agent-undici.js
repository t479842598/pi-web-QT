"use strict";

// Fix: @earendil-works/pi-coding-agent@0.83.0 ships with an npm-shrinkwrap.json
// that pins undici to 8.5.0, which has 7+ known CVEs. npm overrides cannot
// penetrate shrinkwrap. This script:
//   1. Removes the shrinkwrap (so future reinstalls respect overrides)
//   2. Replaces the nested undici with the top-level undici@^8.10.0
//
// Two modes:
//   - applyUndiciFix (runtime, dev/CLI): replaces the nested undici with a
//     **symlink** to the top-level undici. The dir is writable here, and a
//     symlink keeps future reinstalls pointing at the fixed version.
//   - solidifyUndiciFix (build time, packaging): replaces the nested undici
//     (whether a real dir or a symlink) with a **physical copy** of the fixed
//     version so the standalone output (`.next/standalone`) is fully
//     self-contained with no symlinks — the installed, read-only bundle never
//     needs to write anything at runtime and survives NSIS/macOS bundle copying.
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

/**
 * Apply the undici fix under `rootDir`.
 * @param {string} [rootDir] package root (contains node_modules/)
 * @param {{copy?: boolean, topUndici?: string}} [opts]
 *   - copy: when true, copy the fixed undici into place instead of symlinking
 *   - topUndici: explicit path to the fixed undici directory (defaults to
 *     <rootDir>/node_modules/undici)
 */
function applyUndiciFix(rootDir = path.join(__dirname, ".."), opts = {}) {
  const copy = opts.copy === true;
  const agentDir = path.join(
    rootDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  if (!fs.existsSync(agentDir)) return; // not installed here — nothing to fix

  const shrinkwrap = path.join(agentDir, "npm-shrinkwrap.json");
  const nestedUndici = path.join(agentDir, "node_modules", "undici");
  const topUndici = opts.topUndici || path.join(rootDir, "node_modules", "undici");

  // 1. Remove shrinkwrap
  if (fs.existsSync(shrinkwrap)) {
    console.log("[pi-web] Removing pi-coding-agent shrinkwrap…");
    fs.rmSync(shrinkwrap);
  }

  // 2. Inspect the nested undici (may be a real dir or an existing symlink)
  let nestedIsSymlink = false;
  let nestedIsDir = false;
  try {
    const st = fs.lstatSync(nestedUndici);
    nestedIsSymlink = st.isSymbolicLink();
    nestedIsDir = st.isDirectory();
  } catch {
    return; // nested undici missing — nothing to replace
  }
  if (!nestedIsSymlink && !nestedIsDir) return;
  // Runtime symlink mode is idempotent: an existing symlink means already fixed.
  if (nestedIsSymlink && !copy) return;
  if (!fs.existsSync(topUndici)) return;

  try {
    const nestedVersion = require(path.join(nestedUndici, "package.json")).version;
    const topVersion = require(path.join(topUndici, "package.json")).version;
    // Already a real dir with the correct version → nothing to do.
    if (!nestedIsSymlink && nestedVersion === topVersion) return;

    fs.rmSync(nestedUndici, { recursive: true, force: true });

    if (copy) {
      fs.cpSync(topUndici, nestedUndici, { recursive: true });
      console.log(
        `[pi-web] Copied undici@${topVersion} into pi-coding-agent (solidified)`,
      );
    } else {
      const rel = path.relative(path.dirname(nestedUndici), topUndici);
      fs.symlinkSync(
        rel,
        nestedUndici,
        process.platform === "win32" ? "junction" : "dir",
      );
      console.log(
        `[pi-web] Replacing pi-coding-agent's undici@${nestedVersion} ` +
          `→ symlink to undici@${topVersion}`,
      );
    }
  } catch (err) {
    console.warn("[pi-web] undici fix skipped:", err.message);
  }
}

/**
 * Build-time solidification for packaging: physically copy the fixed undici
 * into the standalone output so the read-only installed bundle needs no
 * runtime writes and contains no symlinks.
 * @param {string} [rootDir] standalone root (contains node_modules/)
 * @param {string} [topUndiciDir] path to the fixed undici to copy in
 */
function solidifyUndiciFix(rootDir = path.join(__dirname, ".."), topUndiciDir) {
  const source = topUndiciDir || path.join(rootDir, "node_modules", "undici");
  if (!fs.existsSync(source)) return; // nothing to copy from
  applyUndiciFix(rootDir, { copy: true, topUndici: source });
}

module.exports = { applyUndiciFix, solidifyUndiciFix };

if (require.main === module) {
  applyUndiciFix();
}
