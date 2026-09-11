/**
 * Relay routing hub.
 *
 * Tracks one desktop device per `deviceMid` and the mobile clients paired to
 * it, and routes frames between them. Sockets are injected as a minimal
 * `send(text)` / `close()` interface so the routing rules can be tested without
 * a real WebSocket server.
 *
 * The hub owns no per-connection state. `bindSocket()` attaches one socket and
 * remembers, for that socket only, which device or client it became — sharing
 * that association across connections would cross-route two desktops.
 */

import {
  CLIENT_PAIR,
  CLIENT_RESUME,
  DEVICE_REGISTER_ACK,
  DEVICE_REGISTER_INIT,
  ERRORS,
  MAX_FRAME_BYTES,
  PAIR_LIST,
  PAIR_REGISTER,
  PAIR_RESULT,
  PAIR_REVOKE,
  PING,
  PONG,
  PROTOCOL_VERSION,
  SESSION_TTL_MS,
  createPairToken,
  createSessionId,
  createTokenRecord,
  digestsEqual,
  encodeFrame,
  frameBytes,
  hashToken,
  parseFrame,
  redeemToken,
} from "./protocol.mjs";
import {
  HTTP_REQUEST,
  createTunnelRegistry,
  isTunnelFrame,
  payloadBytes,
  MAX_TUNNEL_BODY_BYTES,
} from "./tunnel.mjs";
import { loadTokens, saveTokens } from "./token-store.mjs";

/** Default pairing lifetime: long enough to reach the phone, short enough to matter. */
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createHub({
  now = () => Date.now(),
  log = () => {},
  ttlMs = DEFAULT_TTL_MS,
  /**
   * Shared secret the desktop must present to register. Empty disables the
   * check, which is only acceptable when the relay is not publicly reachable.
   */
  deviceSecret = "",
  /** Cap on tracked devices so a peer cannot grow the map without bound. */
  maxDevices = 64,
  /** Where issued tokens are persisted, so a saved link survives a restart. */
  storePath = "",
} = {}) {
  /** deviceMid → { mid, socket, meta, tokens, clients } */
  const devices = new Map();
  /** Relay-assigned client ids, so a tunnelled response can name its phone. */
  let nextClientId = 1;
  const tunnels = createTunnelRegistry({ now });
  /** sha256(sessionId) → { sessionId, mid, tokenHash, expiresAt, cid } */
  const sessions = new Map();
  /** deviceMid → StoredToken[]; survives restarts when `storePath` is set. */
  const persisted = storePath ? loadTokens(storePath) : new Map();

  /** Mirror the in-memory token lists to disk (best effort). */
  function persist() {
    if (!storePath) return;
    const snapshot = new Map();
    for (const [mid, device] of devices) {
      const live = device.tokens.filter((token) => (
        token.expiresAt === null || token.expiresAt > now()
      ));
      if (live.length > 0) snapshot.set(mid, live);
    }
    try {
      saveTokens(storePath, snapshot);
    } catch (error) {
      log("warn", "failed to persist tokens", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function deviceFor(mid) {
    return devices.get(mid) ?? null;
  }

  function ensureDevice(mid) {
    let device = devices.get(mid);
    if (!device) {
      device = { mid, socket: null, meta: {}, tokens: [], clients: new Set() };
      // Restore tokens issued before the last restart, so a saved link keeps
      // working instead of failing with "invalid pairing".
      const restored = persisted.get(mid);
      if (restored) {
        device.tokens.push(...restored);
        persisted.delete(mid);
        log("info", "restored tokens", { mid, count: restored.length });
      }
      devices.set(mid, device);
    }
    return device;
  }

  function send(socket, message) {
    try {
      socket.send(encodeFrame(message));
      return true;
    } catch (error) {
      log("warn", "send failed", { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** Desktop → relay: register and become routable. */
  function registerDevice(socket, frame) {
    const mid = typeof frame.device_mid === "string" ? frame.device_mid : "";
    if (!mid) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.invalidMobileConnection });
      return null;
    }
    const version = frame.protocol_version ?? PROTOCOL_VERSION;
    if (version !== PROTOCOL_VERSION) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.unsupportedAction });
      return null;
    }
    // Without this, anyone who can reach the relay could claim a `mid`, evict
    // the real desktop, and then mint their own pairing token.
    if (deviceSecret && !digestsEqual(hashToken(String(frame.device_secret ?? "")), hashToken(deviceSecret))) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.unauthorized });
      return null;
    }
    if (!devices.has(mid) && devices.size >= maxDevices) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.unsupportedAction });
      return null;
    }
    const device = ensureDevice(mid);
    // A reconnecting desktop replaces the stale socket. Its paired phones are
    // dropped too: they were bound to a session the old socket owned, and
    // silently keeping them would route frames into a dead connection.
    if (device.socket && device.socket !== socket) {
      try { device.socket.close(); } catch { /* already gone */ }
      for (const client of [...device.clients]) {
        send(client.socket, { type: PAIR_RESULT, ok: false, code: ERRORS.desktopDisconnected });
        try { client.socket.close(); } catch { /* already gone */ }
        device.clients.delete(client);
      }
    }
    device.socket = socket;
    // Keep only primitive metadata; `meta` is attacker-controlled otherwise.
    const meta = typeof frame.meta === "object" && frame.meta !== null ? frame.meta : {};
    device.meta = {
      name: typeof meta.name === "string" ? meta.name.slice(0, 64) : "",
      version: typeof meta.version === "string" ? meta.version.slice(0, 32) : "",
      platform: typeof meta.platform === "string" ? meta.platform.slice(0, 32) : "",
    };
    send(socket, { type: DEVICE_REGISTER_ACK, protocol_version: PROTOCOL_VERSION, device_mid: mid });
    log("info", "device registered", { mid, clients: device.clients.size });
    return device;
  }

  /**
   * Desktop → relay: mint a pairing token; the raw value is returned once.
   *
   * A saved link passes `ttlMs: 0` and `reusable: true` so it never expires and
   * works on every device; the default 10-minute single-use token is what the
   * QR flow wants.
   */
  function registerPair(device, frame) {
    const rawToken = createPairToken();
    const requestedTtl = typeof frame?.ttlMs === "number" && Number.isFinite(frame.ttlMs)
      ? Math.max(0, frame.ttlMs)
      : ttlMs;
    const reusable = frame?.reusable === true;
    const record = createTokenRecord({
      tokenHash: hashToken(rawToken),
      scope: frame?.scope,
      ttlMs: requestedTtl,
      nowMs: now(),
      label: frame?.label,
      reusable,
    });
    device.tokens.push(record);
    persist();
    return {
      ok: true,
      token: rawToken,
      device_mid: device.mid,
      expiresInMs: requestedTtl,
      reusable,
      expiresAt: record.expiresAt,
    };
  }

  function revokePair(device, frame) {
    const digest = typeof frame?.token_hash === "string"
      ? frame.token_hash
      : hashToken(typeof frame?.token === "string" ? frame.token : "");
    const record = device.tokens.find((entry) => digestsEqual(entry.tokenHash, digest));
    if (!record) return { ok: false, code: ERRORS.sessionNotFound };
    if (record.revokedAt !== null) return { ok: false, code: ERRORS.sessionNotFound };
    record.revokedAt = now();
    persist();
    // Sessions derived from this token die with it, otherwise a revoked
    // pairing could keep reconnecting with its credential.
    for (const [hash, entry] of [...sessions]) {
      if (entry.tokenHash === record.tokenHash) sessions.delete(hash);
    }
    for (const client of device.clients) {
      if (client.tokenHash === record.tokenHash) {
        send(client.socket, { type: PAIR_RESULT, ok: false, code: ERRORS.kicked });
        try { client.socket.close(); } catch { /* already gone */ }
        device.clients.delete(client);
      }
    }
    return { ok: true };
  }

  function listPairs(device) {
    const nowMs = now();
    return {
      ok: true,
      pairs: device.tokens.map((entry) => ({
        label: entry.label,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        reusable: entry.reusable === true,
        used: entry.usedAt !== null,
        revoked: entry.revokedAt !== null,
        /**
         * The token's digest. Exposed so the desktop can tell whether a link it
         * saved is still live — a hash is not a credential (the raw token never
         * leaves the desktop), and without it the desktop would keep handing
         * back a token the relay has already forgotten.
         */
        tokenHash: entry.tokenHash,
        // How many phones are attached through this link right now.
        connections: [...device.clients].filter((client) => client.tokenHash === entry.tokenHash).length,
        connected: [...device.clients].some((client) => client.tokenHash === entry.tokenHash),
        expired: entry.expiresAt !== null && nowMs >= entry.expiresAt,
      })),
    };
  }

  /** Mobile → relay: redeem a token and attach to the device. */
  function pairClient(socket, frame) {
    const mid = typeof frame.device_mid === "string" ? frame.device_mid : "";
    const device = deviceFor(mid);
    if (!device) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.sessionNotFound });
      return null;
    }
    if (!device.socket) {
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.desktopDisconnected });
      return null;
    }
    const result = redeemToken(device.tokens, String(frame.token ?? ""), { nowMs: now() });
    if (!result.ok) {
      send(socket, { type: PAIR_RESULT, ok: false, code: result.code });
      return null;
    }
    const client = {
      socket,
      tokenHash: result.record.tokenHash,
      mid,
      cid: String(nextClientId++),
      session: null,
    };
    device.clients.add(client);
    // The pairing token is single-use, so it cannot be presented again after a
    // reconnect — hand back a durable session credential instead. It is bound
    // to the token, so revoking the token kills the session too.
    //
    // A reusable link yields credentials without expiry: access is withdrawn by
    // revoking the link, not by waiting the phone out. A one-shot token keeps
    // the bounded lifetime.
    const sessionId = createSessionId();
    const sessionExpiry = result.record.reusable ? null : now() + SESSION_TTL_MS;
    client.session = { id: sessionId, expiresAt: sessionExpiry, tokenHash: result.record.tokenHash };
    sessions.set(hashToken(sessionId), { sessionId, mid, tokenHash: result.record.tokenHash, expiresAt: sessionExpiry, cid: client.cid });
    send(socket, { type: PAIR_RESULT, ok: true, protocol_version: PROTOCOL_VERSION, cid: client.cid, session: sessionId });
    log("info", "client paired", { mid, cid: client.cid, reusable: result.record.reusable === true, clients: device.clients.size });
    return client;
  }

  /** Reattach with a durable session credential (reconnect or `/web/` access). */
  function resumeClient(socket, frame) {
    const raw = typeof frame.session === "string" ? frame.session : "";
    if (!raw) return null;
    const record = sessions.get(hashToken(raw));
    if (!record) { send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.sessionNotFound }); return null; }
    if (record.expiresAt !== null && now() >= record.expiresAt) {
      sessions.delete(hashToken(raw));
      send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.sessionExpired });
      return null;
    }
    const device = deviceFor(record.mid);
    if (!device) { send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.sessionNotFound }); return null; }
    if (!device.socket) { send(socket, { type: PAIR_RESULT, ok: false, code: ERRORS.desktopDisconnected }); return null; }
    const client = { socket, tokenHash: record.tokenHash, mid: record.mid, cid: String(nextClientId++), session: { id: raw, expiresAt: record.expiresAt, tokenHash: record.tokenHash } };
    device.clients.add(client);
    send(socket, { type: PAIR_RESULT, ok: true, protocol_version: PROTOCOL_VERSION, cid: client.cid, session: raw });
    log("info", "client resumed", { mid: record.mid, cid: client.cid });
    return client;
  }

  /** Resolve a session credential without needing a socket (used by `/web/`). */
  function sessionFor(rawSession) {
    if (typeof rawSession !== "string" || rawSession.length === 0) return null;
    const record = sessions.get(hashToken(rawSession));
    if (!record) return null;
    if (record.expiresAt !== null && now() >= record.expiresAt) { sessions.delete(hashToken(rawSession)); return null; }
    return record;
  }

  /**
   * Run one HTTP request against the desktop, outside a client socket.
   *
   * The `/web/` proxy is a plain HTTP request from a browser, not a WebSocket
   * client, so it has no socket to answer on. Registering a virtual client
   * reuses the whole tunnelled request/response path instead of a second one.
   */
  function proxyRequest(device, { method = "GET", path, headers = {}, body, onHead, onChunk, onEnd, timeoutMs = 120_000 }) {
    if (!device || !device.socket) return Promise.reject(new Error(ERRORS.desktopDisconnected));
    const rid = `proxy-${nextClientId++}`;
    const cid = rid;
    let settle;
    const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    const virtual = {
      cid,
      mid: device.mid,
      tokenHash: "proxy",
      socket: {
        send(text) {
          const frame = JSON.parse(text);
          if (frame.type === "http_response_head") { onHead?.(frame.status, frame.headers ?? {}); return; }
          if (frame.type === "http_response_chunk") {
            const buf = frame.encoding === "base64" ? Buffer.from(frame.data, "base64") : Buffer.from(String(frame.data ?? ""));
            onChunk?.(buf);
            return;
          }
          if (frame.type === "http_response_end") {
            device.clients.delete(virtual);
            onEnd?.();
            settle.resolve();
          }
        },
        close() { device.clients.delete(virtual); },
      },
    };
    device.clients.add(virtual);
    const timer = setTimeout(() => {
      device.clients.delete(virtual);
      settle.reject(new Error("proxy request timed out"));
    }, timeoutMs);
    done.finally(() => clearTimeout(timer)).catch(() => {});
    const result = forwardTunnelRequest(device, virtual, { type: HTTP_REQUEST, rid, method, path, headers, body });
    if (!result.ok) {
      device.clients.delete(virtual);
      settle.reject(new Error(result.code));
    }
    return done;
  }

  function dropClient(device, client) {
    if (!device || !client) return;
    device.clients.delete(client);
    tunnels.forget(client.cid);
  }

  /** Find the client a tunnelled response is addressed to. */
  function clientByCid(device, cid) {
    if (!device || typeof cid !== "string") return null;
    for (const client of device.clients) {
      if (client.cid === cid) return client;
    }
    return null;
  }

  /** Route a desktop frame to its paired client(s). */
  function forwardToClients(device, text) {
    if (!device) return false;
    if (frameBytes(text) > MAX_FRAME_BYTES) {
      log("warn", "oversize frame dropped", { direction: "to-client" });
      return false;
    }
    for (const recipient of [...device.clients]) {
      try { recipient.socket.send(text); } catch { device.clients.delete(recipient); }
    }
    return true;
  }

  /**
   * Route a tunnelled HTTP request from one phone to the desktop.
   *
   * Unlike chat frames this must not be broadcast: the reply carries the
   * request's `rid`, and every phone has its own rid space. The client's `cid`
   * travels with the request so the desktop can address the answer back.
   */
  function forwardTunnelRequest(device, client, frame) {
    if (!device || !client || !device.socket) return { ok: false, code: ERRORS.desktopDisconnected };
    const size = payloadBytes(frame.body);
    if (size < 0 || size > MAX_TUNNEL_BODY_BYTES) return { ok: false, code: ERRORS.frameTooLarge };
    const begun = tunnels.begin(client.cid, frame.rid);
    if (!begun.ok) return { ok: false, code: ERRORS.unsupportedAction };
    try {
      device.socket.send(encodeFrame({ ...frame, type: HTTP_REQUEST, cid: client.cid }));
      return { ok: true };
    } catch {
      tunnels.end(client.cid, frame.rid);
      device.socket = null;
      return { ok: false, code: ERRORS.desktopDisconnected };
    }
  }

  /** Deliver a desktop tunnel response chunk to the one phone that asked. */
  function forwardTunnelResponse(device, frame) {
    const client = clientByCid(device, frame.cid);
    if (!client) return false;
    if (frame.type !== "http_response_head" && frame.type !== "http_response_chunk"
      && frame.type !== "http_response_end") return false;
    const size = payloadBytes(frame.data);
    if (size < 0 || size > MAX_TUNNEL_BODY_BYTES) return false;
    if (frame.type === "http_response_end") tunnels.end(client.cid, frame.rid);
    try {
      client.socket.send(encodeFrame(frame));
      return true;
    } catch {
      device.clients.delete(client);
      tunnels.forget(client.cid);
      return false;
    }
  }

  /** Route a client frame to the desktop. */
  function forwardToDevice(device, text) {
    if (!device || !device.socket) return false;
    if (frameBytes(text) > MAX_FRAME_BYTES) {
      log("warn", "oversize frame dropped", { direction: "to-device" });
      return false;
    }
    try {
      device.socket.send(text);
      return true;
    } catch {
      // The desktop is gone. Tell the phones instead of letting them wait for
      // a heartbeat timeout, and clear the socket so they get a clear error.
      device.socket = null;
      for (const client of [...device.clients]) {
        send(client.socket, { type: PAIR_RESULT, ok: false, code: ERRORS.desktopDisconnected });
      }
      return false;
    }
  }

  return {
    devices,
    deviceFor,
    send,
    registerDevice,
    registerPair,
    revokePair,
    listPairs,
    pairClient,
    resumeClient,
    sessionFor,
    proxyRequest,
    dropClient,
    clientByCid,
    forwardToClients,
    forwardToDevice,
    forwardTunnelRequest,
    forwardTunnelResponse,
    tunnels,
    sessions,
  };
}

/**
 * Attach one socket to the hub and dispatch its frames.
 *
 * `role` is a hint from the upgrade path (query string); the first meaningful
 * frame still decides, so a mislabelled connection cannot hijack another role.
 *
 * The returned session exposes `request(frame)`, which the desktop side uses to
 * proxy pairing operations through the relay with a correlated response.
 */
export function bindSocket(hub, socket, role) {
  const session = { role, device: null, client: null, pending: new Map(), nextRequestId: 1 };

  const reply = (message) => socket.send(encodeFrame(message));

  /** Parse a `pair_result` the relay answered and settle its caller. */
  function settlePending(frame) {
    const id = frame.rid;
    if (typeof id !== "string" && typeof id !== "number") return false;
    const pending = session.pending.get(String(id));
    if (!pending) return false;
    session.pending.delete(String(id));
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(frame);
    return true;
  }

  function handleDeviceFrame(frame, text) {
    if (frame.type === DEVICE_REGISTER_INIT) { session.device = hub.registerDevice(socket, frame); return; }
    if (!session.device) { reply({ type: PAIR_RESULT, ok: false, code: ERRORS.invalidMobileConnection, rid: frame.rid }); return; }
    if (frame.type === PAIR_REGISTER) { reply({ type: PAIR_RESULT, ...hub.registerPair(session.device, frame), rid: frame.rid }); return; }
    if (frame.type === PAIR_REVOKE) { reply({ type: PAIR_RESULT, ...hub.revokePair(session.device, frame), rid: frame.rid }); return; }
    if (frame.type === PAIR_LIST) { reply({ type: PAIR_RESULT, ...hub.listPairs(session.device), rid: frame.rid }); return; }
    // A tunnelled HTTP response is addressed to one phone via `cid`; chat
    // frames have no cid and are still broadcast.
    if (isTunnelFrame(frame.type)) { hub.forwardTunnelResponse(session.device, frame); return; }
    hub.forwardToClients(session.device, text);
  }

  function handleClientFrame(frame, text) {
    if (frame.type === CLIENT_PAIR) { session.client = hub.pairClient(socket, frame); return; }
    if (frame.type === CLIENT_RESUME) { session.client = hub.resumeClient(socket, frame); return; }
    if (!session.client) { reply({ type: PAIR_RESULT, ok: false, code: ERRORS.sessionNotFound, rid: frame.rid }); return; }
    if (frame.type === HTTP_REQUEST) {
      const device = hub.deviceFor(session.client.mid);
      const result = hub.forwardTunnelRequest(device, session.client, frame);
      if (!result.ok) {
        // Answer the *caller* rather than dropping: the page would otherwise
        // hang on a request that never got a response head.
        reply({ type: "http_response_head", cid: session.client.cid, rid: frame.rid, status: 502, headers: {} });
        reply({ type: "http_response_end", cid: session.client.cid, rid: frame.rid });
        log("warn", "tunnel request rejected", { code: result.code, path: frame.path });
      }
      return;
    }
    hub.forwardToDevice(hub.deviceFor(session.client.mid), text);
  }

  socket.on("message", (data) => {
    const frame = parseFrame(data);
    if (!frame) { reply({ type: PAIR_RESULT, ok: false, code: ERRORS.invalidMobileConnection }); return; }
    if (frame.type === PING) { reply({ type: PONG }); return; }
    if (frame.type === PONG) return;
    // A response to one of our own requests (the desktop sees these when the
    // relay answers a proxied pairing operation).
    if (settlePending(frame)) return;

    const text = typeof data === "string" ? data : data.toString("utf8");
    if (session.device || (role === "device" && frame.type === DEVICE_REGISTER_INIT)) {
      handleDeviceFrame(frame, text);
      return;
    }
    handleClientFrame(frame, text);
  });

  socket.on("close", () => {
    if (session.device) session.device.socket = null;
    if (session.client) hub.dropClient(hub.deviceFor(session.client.mid), session.client);
    for (const pending of session.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve({ type: PAIR_RESULT, ok: false, code: ERRORS.desktopDisconnected });
    }
    session.pending.clear();
  });

  /**
   * Send a control frame and wait for its correlated reply.
   *
   * Used by the desktop to drive pairing through the relay now that the relay
   * is the single source of truth for tokens.
   */
  session.request = (frame, timeoutMs = 5_000) => new Promise((resolve) => {
    const rid = String(session.nextRequestId++);
    const timer = setTimeout(() => {
      session.pending.delete(rid);
      resolve({ type: PAIR_RESULT, ok: false, code: ERRORS.relayUnavailable });
    }, timeoutMs);
    session.pending.set(rid, { resolve, timer });
    try {
      socket.send(encodeFrame({ ...frame, rid }));
    } catch {
      clearTimeout(timer);
      session.pending.delete(rid);
      resolve({ type: PAIR_RESULT, ok: false, code: ERRORS.relayUnavailable });
    }
  });

  return session;
}
