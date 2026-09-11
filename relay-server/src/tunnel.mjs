/**
 * HTTP-over-WebSocket tunnel vocabulary and limits.
 *
 * The relay stays a transparent pipe for chat frames, but the hosted mobile
 * page needs to reach pi-web's own HTTP surface (sessions, models, auth, files)
 * — and the desktop is behind NAT, so those requests ride the same socket.
 *
 * Frames, in order:
 *   client → device   http_request      { cid, rid, method, path, headers, body }
 *   device → client   http_response_head{ cid, rid, status, headers }
 *   device → client   http_response_chunk{ cid, rid, data }     (streamed, SSE)
 *   device → client   http_response_end { cid, rid }
 *
 * `cid` is the relay-assigned client id: a device answers many phones over one
 * socket, so a response must name its destination or it would be broadcast to
 * every paired phone.
 */

export const HTTP_REQUEST = "http_request";
export const HTTP_RESPONSE_HEAD = "http_response_head";
export const HTTP_RESPONSE_CHUNK = "http_response_chunk";
export const HTTP_RESPONSE_END = "http_response_end";

/** Tunnelled request bodies and response chunks are capped well below the socket frame limit. */
export const MAX_TUNNEL_BODY_BYTES = 4 * 1024 * 1024;

/** How many requests one phone may have in flight. SSE streams are long-lived, so this is not 1. */
export const MAX_INFLIGHT_PER_CLIENT = 12;

/** A response that never ends would pin a slot forever; SSE keeps it alive by design. */
export const TUNNEL_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function isTunnelFrame(type) {
  return type === HTTP_REQUEST
    || type === HTTP_RESPONSE_HEAD
    || type === HTTP_RESPONSE_CHUNK
    || type === HTTP_RESPONSE_END;
}

/**
 * Per-client in-flight bookkeeping.
 *
 * Slots are released on `http_response_end`, on client disconnect, or after the
 * timeout — otherwise a dropped stream would permanently consume the budget and
 * the page would stop being able to make requests.
 */
export function createTunnelRegistry({ maxInflight = MAX_INFLIGHT_PER_CLIENT, now = () => Date.now() } = {}) {
  /** clientId → Map<rid, startedAt> */
  const inflight = new Map();

  function slots(cid) {
    let set = inflight.get(cid);
    if (!set) { set = new Map(); inflight.set(cid, set); }
    return set;
  }

  function begin(cid, rid) {
    const set = slots(cid);
    if (set.size >= maxInflight) return { ok: false, reason: "busy" };
    set.set(String(rid), now());
    return { ok: true };
  }

  function end(cid, rid) {
    const set = inflight.get(cid);
    if (!set) return;
    set.delete(String(rid));
    if (set.size === 0) inflight.delete(cid);
  }

  function forget(cid) {
    inflight.delete(cid);
  }

  function countFor(cid) {
    return inflight.get(cid)?.size ?? 0;
  }

  /** Drop slots that outlived the timeout so a stalled stream cannot wedge a client. */
  function pruneStale(timeoutMs = TUNNEL_REQUEST_TIMEOUT_MS) {
    const cutoff = now() - timeoutMs;
    let dropped = 0;
    for (const [cid, set] of [...inflight]) {
      for (const [rid, startedAt] of [...set]) {
        if (startedAt < cutoff) { set.delete(rid); dropped += 1; }
      }
      if (set.size === 0) inflight.delete(cid);
    }
    return dropped;
  }

  return { begin, end, forget, countFor, pruneStale, inflight };
}

/** Byte size of a body/chunk payload, accepting string or byte array. */
export function payloadBytes(value) {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Buffer.isBuffer(value)) return value.length;
  if (value instanceof Uint8Array) return value.byteLength;
  if (value === undefined || value === null) return 0;
  return -1; // unsupported payload type
}
