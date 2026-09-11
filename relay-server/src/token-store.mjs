/**
 * Durable token store.
 *
 * Pairing tokens live in memory for lookups, but a permanent link has to
 * survive a restart — otherwise every deploy silently invalidates the link the
 * user saved on their phone, and the desktop keeps handing out a token the
 * relay no longer recognises. Records are written atomically and stored
 * hashed, so the file is not a usable credential by itself.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * @typedef {object} StoredToken
 * @property {string} tokenHash
 * @property {string} scope
 * @property {boolean} reusable
 * @property {number} createdAt
 * @property {number|null} expiresAt
 * @property {number|null} usedAt
 * @property {number|null} revokedAt
 * @property {string} label
 */

/** @param {unknown} value */
function isToken(value) {
  if (!value || typeof value !== "object") return false;
  const t = /** @type {Partial<StoredToken>} */ (value);
  return typeof t.tokenHash === "string"
    && typeof t.createdAt === "number"
    && (t.expiresAt === null || typeof t.expiresAt === "number")
    && (t.usedAt === null || typeof t.usedAt === "number")
    && (t.revokedAt === null || typeof t.revokedAt === "number");
}

/**
 * Load persisted tokens, dropping malformed entries rather than trusting the
 * file wholesale.
 *
 * @param {string} path
 * @returns {Map<string, StoredToken[]>}
 */
export function loadTokens(path) {
  /** @type {Map<string, StoredToken[]>} */
  const result = new Map();
  if (!existsSync(path)) return result;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || parsed.version !== 1 || !parsed.devices || typeof parsed.devices !== "object") return result;
    for (const [mid, tokens] of Object.entries(parsed.devices)) {
      if (!Array.isArray(tokens)) continue;
      const valid = tokens.filter(isToken);
      if (valid.length > 0) result.set(mid, valid);
    }
  } catch {
    // A corrupt file must not take the relay down; start empty.
  }
  return result;
}

/**
 * Write the whole store atomically so a crash cannot truncate it.
 *
 * @param {string} path
 * @param {Map<string, StoredToken[]>} devices
 */
export function saveTokens(path, devices) {
  /** @type {Record<string, StoredToken[]>} */
  const devicesObject = {};
  for (const [mid, tokens] of devices) {
    if (tokens.length > 0) devicesObject[mid] = tokens;
  }
  const payload = { version: 1, devices: devicesObject };
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* already gone */ }
    throw error;
  }
}
