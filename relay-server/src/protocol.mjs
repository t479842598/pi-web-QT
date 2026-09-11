/**
 * Relay wire protocol.
 *
 * The relay is a transparent pipe: it never parses chat payloads, it only
 * routes frames between one paired desktop (pi-web) and one mobile client.
 * Everything here is transport-level and deliberately free of network I/O so
 * the routing rules can be unit tested without sockets.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Bump when a frame shape changes; peers reject mismatched versions. */
export const PROTOCOL_VERSION = 1;

/**
 * Largest single frame we forward. Oversize frames are dropped rather than
 * buffered, so a runaway client cannot grow relay memory without bound.
 */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Device (desktop) → relay. */
export const DEVICE_REGISTER_INIT = "device_register_init";
export const DEVICE_REGISTER_ACK = "device_register_ack";
export const PAIR_REGISTER = "pair_register";
export const PAIR_REVOKE = "pair_revoke";
export const PAIR_LIST = "pair_list";

/** Mobile client → relay. */
export const CLIENT_PAIR = "client_pair";
/** Resume a previously established session with its durable credential. */
export const CLIENT_RESUME = "client_resume";
export const PAIR_RESULT = "pair_result";

/** Both directions. */
export const PING = "ping";
export const PONG = "pong";

/** Error codes surfaced to the client; mirrors the pi-web-side error states. */
export const ERRORS = {
  relayUnavailable: "relayUnavailable",
  sessionExpired: "sessionExpired",
  sessionNotFound: "sessionNotFound",
  kicked: "kicked",
  desktopDisconnected: "desktopDisconnected",
  invalidMobileConnection: "invalidMobileConnection",
  unsupportedAction: "unsupportedAction",
  unauthorized: "unauthorized",
  frameTooLarge: "frameTooLarge",
};

/** Hash a secret so stored tokens are never the raw value. */
export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function digestsEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Generate an opaque, URL-safe pairing token. */
export function createPairToken() {
  return randomBytes(32).toString("base64url");
}

/** Generate a durable session credential (survives reconnects, revocable). */
export function createSessionId() {
  return randomBytes(24).toString("base64url");
}

/**
 * Session lifetimes.
 *
 * A pairing token is single-use, so the phone cannot present it again on
 * reconnect — the session credential is what makes reconnects and the `/web/`
 * proxy work. It dies with its token (revocation) or at the cap.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Byte length of a frame as it goes on the wire. */
export function frameBytes(data) {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + frameBytes(part), 0);
  return 0;
}

/**
 * Parse a wire frame into an object, or return null when it is not a JSON
 * object. A frame is never trusted past this point: callers must still check
 * the `type` and every field they read.
 */
export function parseFrame(data) {
  let text;
  if (typeof data === "string") text = data;
  else if (Buffer.isBuffer(data)) text = data.toString("utf8");
  else return null;
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Serialize a frame for the wire. */
export function encodeFrame(message) {
  return JSON.stringify(message);
}

/** A token store entry: hashed token plus its lifetime and revocation state. */
export function createTokenRecord({ tokenHash, scope, ttlMs, nowMs, label }) {
  return {
    tokenHash,
    scope: typeof scope === "string" && scope.length > 0 ? scope : "full",
    createdAt: nowMs,
    expiresAt: ttlMs > 0 ? nowMs + ttlMs : null,
    /** Consumed by a successful pairing; a second attempt is rejected. */
    usedAt: null,
    /** Explicitly revoked by the desktop; independent of `usedAt`. */
    revokedAt: null,
    label: typeof label === "string" ? label : "",
  };
}

/**
 * Redeem a raw token against the store.
 *
 * Returns `{ ok: true, record }` exactly once per token, or `{ ok: false, code }`.
 * A single-use rule is what makes a leaked QR link stop working after pairing.
 * "Already used" and "revoked" report the same code to the client (there is
 * nothing useful it could do differently) but are tracked separately, so the
 * desktop's device list can still tell a successful pairing from a revocation.
 */
export function redeemToken(store, rawToken, { nowMs, singleUse = true }) {
  const digest = hashToken(rawToken);
  const record = store.find((entry) => digestsEqual(entry.tokenHash, digest));
  if (!record) return { ok: false, code: ERRORS.sessionNotFound };
  if (record.revokedAt !== null) return { ok: false, code: ERRORS.kicked };
  if (record.usedAt !== null) return { ok: false, code: ERRORS.kicked };
  if (record.expiresAt !== null && nowMs >= record.expiresAt) {
    return { ok: false, code: ERRORS.sessionExpired };
  }
  if (singleUse) record.usedAt = nowMs;
  return { ok: true, record };
}
