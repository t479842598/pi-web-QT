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
  createPairToken,
  createTokenRecord,
  digestsEqual,
  encodeFrame,
  frameBytes,
  hashToken,
  parseFrame,
  redeemToken,
} from "./protocol.mjs";

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
} = {}) {
  /** deviceMid → { mid, socket, meta, tokens, clients } */
  const devices = new Map();

  function deviceFor(mid) {
    return devices.get(mid) ?? null;
  }

  function ensureDevice(mid) {
    let device = devices.get(mid);
    if (!device) {
      device = { mid, socket: null, meta: {}, tokens: [], clients: new Set() };
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

  /** Desktop → relay: mint a pairing token; the raw value is returned once. */
  function registerPair(device, frame) {
    const rawToken = createPairToken();
    device.tokens.push(createTokenRecord({
      tokenHash: hashToken(rawToken),
      scope: frame?.scope,
      ttlMs,
      nowMs: now(),
      label: frame?.label,
    }));
    return { ok: true, token: rawToken, device_mid: device.mid, expiresInMs: ttlMs };
  }

  function revokePair(device, frame) {
    const digest = typeof frame?.token_hash === "string"
      ? frame.token_hash
      : hashToken(typeof frame?.token === "string" ? frame.token : "");
    const record = device.tokens.find((entry) => digestsEqual(entry.tokenHash, digest));
    if (!record) return { ok: false, code: ERRORS.sessionNotFound };
    if (record.revokedAt !== null) return { ok: false, code: ERRORS.sessionNotFound };
    record.revokedAt = now();
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
    return {
      ok: true,
      pairs: device.tokens.map((entry) => ({
        label: entry.label,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        used: entry.usedAt !== null,
        revoked: entry.revokedAt !== null,
        connected: [...device.clients].some((client) => client.tokenHash === entry.tokenHash),
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
    const client = { socket, tokenHash: result.record.tokenHash, mid };
    device.clients.add(client);
    send(socket, { type: PAIR_RESULT, ok: true, protocol_version: PROTOCOL_VERSION });
    log("info", "client paired", { mid, clients: device.clients.size });
    return client;
  }

  function dropClient(device, client) {
    if (!device || !client) return;
    device.clients.delete(client);
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

  return { devices, deviceFor, send, registerDevice, registerPair, revokePair, listPairs, pairClient, dropClient, forwardToClients, forwardToDevice };
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
    hub.forwardToClients(session.device, text);
  }

  function handleClientFrame(frame, text) {
    if (frame.type === CLIENT_PAIR) { session.client = hub.pairClient(socket, frame); return; }
    if (!session.client) { reply({ type: PAIR_RESULT, ok: false, code: ERRORS.sessionNotFound, rid: frame.rid }); return; }
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
