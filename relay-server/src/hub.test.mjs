import assert from "node:assert/strict";
import test from "node:test";
import { bindSocket, createHub } from "./hub.mjs";
import {
  CLIENT_PAIR,
  DEVICE_REGISTER_INIT,
  ERRORS,
  PAIR_LIST,
  PAIR_REGISTER,
  PAIR_RESULT,
  PAIR_REVOKE,
  PING,
  PONG,
  PROTOCOL_VERSION,
  createTokenRecord,
  digestsEqual,
  hashToken,
  frameBytes,
  parseFrame,
  redeemToken,
} from "./protocol.mjs";

/** Minimal socket double: records everything sent by the relay. */
function fakeSocket() {
  const sent = [];
  const listeners = new Map();
  return {
    sent,
    closed: false,
    send(text) { sent.push(parseFrame(text)); },
    close() { this.closed = true; },
    on(event, handler) { listeners.set(event, handler); },
    emit(event, data) { listeners.get(event)?.(data); },
    last() { return sent[sent.length - 1]; },
  };
}

function frame(message) {
  return JSON.stringify(message);
}

function openHub() {
  return createHub({ now: () => 1000, log: () => {} });
}

function registerDevice(hub, mid = "dev-1") {
  const socket = fakeSocket();
  const session = bindSocket(hub, socket, "device");
  socket.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: mid, protocol_version: PROTOCOL_VERSION }));
  return { socket, session };
}

test("device registration acknowledges and becomes routable", () => {
  const hub = openHub();
  const { socket } = registerDevice(hub);
  assert.equal(socket.last().type, "device_register_ack");
  assert.equal(socket.last().device_mid, "dev-1");
  assert.equal(hub.deviceFor("dev-1").socket, socket);
});

test("rejects a protocol version mismatch", () => {
  const hub = openHub();
  const socket = fakeSocket();
  bindSocket(hub, socket, "device");
  socket.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: 999 }));
  assert.deepEqual(socket.last(), { type: "pair_result", ok: false, code: ERRORS.unsupportedAction });
});

test("a paired client can reach the device and vice versa", () => {
  const hub = openHub();
  const { socket: deviceSocket } = registerDevice(hub);
  deviceSocket.emit("message", frame({ type: PAIR_REGISTER }));
  const token = deviceSocket.last().token;
  assert.equal(typeof token, "string");

  const clientSocket = fakeSocket();
  bindSocket(hub, clientSocket, "client");
  clientSocket.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(clientSocket.last().ok, true);

  // client → device
  clientSocket.emit("message", frame({ type: "rpc", payload: { hello: 1 } }));
  assert.deepEqual(deviceSocket.last(), { type: "rpc", payload: { hello: 1 } });
  // device → client
  deviceSocket.emit("message", frame({ type: "event", payload: { hi: 2 } }));
  assert.deepEqual(clientSocket.last(), { type: "event", payload: { hi: 2 } });
});

test("a pairing token is single-use", () => {
  const hub = openHub();
  const { socket: deviceSocket } = registerDevice(hub);
  deviceSocket.emit("message", frame({ type: PAIR_REGISTER }));
  const token = deviceSocket.last().token;

  const first = fakeSocket();
  bindSocket(hub, first, "client");
  first.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(first.last().ok, true);

  const second = fakeSocket();
  bindSocket(hub, second, "client");
  second.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.deepEqual(second.last(), { type: "pair_result", ok: false, code: ERRORS.kicked });
});

test("pairing fails when no desktop is connected", () => {
  const hub = openHub();
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token: "x" }));
  assert.deepEqual(client.last(), { type: "pair_result", ok: false, code: ERRORS.sessionNotFound });
});

test("revoking a token kicks the client using it", () => {
  const hub = openHub();
  const { socket: deviceSocket } = registerDevice(hub);
  deviceSocket.emit("message", frame({ type: PAIR_REGISTER }));
  const token = deviceSocket.last().token;

  const clientSocket = fakeSocket();
  bindSocket(hub, clientSocket, "client");
  clientSocket.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(clientSocket.last().ok, true);

  deviceSocket.emit("message", frame({ type: PAIR_REVOKE, token }));
  assert.equal(deviceSocket.last().ok, true);
  assert.equal(clientSocket.closed, true);
  assert.equal(clientSocket.last().code, ERRORS.kicked);
});

test("two devices do not cross-route", () => {
  const hub = openHub();
  const a = registerDevice(hub, "dev-a");
  const b = registerDevice(hub, "dev-b");
  a.socket.emit("message", frame({ type: PAIR_REGISTER }));
  b.socket.emit("message", frame({ type: PAIR_REGISTER }));

  const clientA = fakeSocket();
  bindSocket(hub, clientA, "client");
  clientA.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-a", token: a.socket.sent[1].token }));

  clientA.emit("message", frame({ type: "rpc", from: "a" }));
  assert.deepEqual(a.socket.last(), { type: "rpc", from: "a" });
  // Device B must not have seen A's traffic (its last frame is still PAIR_REGISTER ack).
  assert.notEqual(b.socket.last()?.from, "a");
});

test("an unpaired client cannot reach the device", () => {
  const hub = openHub();
  const { socket: deviceSocket } = registerDevice(hub);
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: "rpc", payload: {} }));
  assert.equal(client.last().code, ERRORS.sessionNotFound);
  assert.notEqual(deviceSocket.last()?.type, "rpc");
});

test("logs pairs without exposing the raw token", () => {
  const hub = openHub();
  const { socket } = registerDevice(hub);
  socket.emit("message", frame({ type: PAIR_REGISTER, label: "phone" }));
  const token = socket.last().token;
  socket.emit("message", frame({ type: PAIR_LIST }));
  const pairs = socket.last().pairs;
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].label, "phone");
  assert.equal(pairs[0].revoked, false);
  assert.equal(JSON.stringify(pairs).includes(token), false);
});

test("ping is answered by the relay, not forwarded", () => {
  const hub = openHub();
  const { socket } = registerDevice(hub);
  socket.sent.length = 0;
  socket.emit("message", frame({ type: PING }));
  assert.deepEqual(socket.last(), { type: PONG });
});

test("malformed frames are rejected", () => {
  const hub = openHub();
  const socket = fakeSocket();
  bindSocket(hub, socket, "client");
  socket.emit("message", "not json");
  assert.equal(socket.last().code, ERRORS.invalidMobileConnection);
});

// ── protocol helpers ────────────────────────────────────────────────────────

test("frameBytes counts strings, buffers and arrays", () => {
  assert.equal(frameBytes("abc"), 3);
  assert.equal(frameBytes(Buffer.from("abcd")), 4);
  assert.equal(frameBytes(["ab", Buffer.from("cd")]), 4);
  assert.equal(frameBytes(42), 0);
});

test("redeemToken enforces expiry, revocation and single use", () => {
  const store = [createTokenRecord({ tokenHash: hashToken("good"), ttlMs: 100, nowMs: 0 })];
  assert.equal(redeemToken(store, "good", { nowMs: 50 }).ok, true);
  // Single use consumed it.
  assert.equal(redeemToken(store, "good", { nowMs: 60 }).code, ERRORS.kicked);

  const expired = [createTokenRecord({ tokenHash: hashToken("old"), ttlMs: 100, nowMs: 0 })];
  assert.equal(redeemToken(expired, "old", { nowMs: 200 }).code, ERRORS.sessionExpired);

  const unknown = [];
  assert.equal(redeemToken(unknown, "nope", { nowMs: 0 }).code, ERRORS.sessionNotFound);
});

test("digestsEqual only matches identical hex digests", () => {
  const a = hashToken("a");
  assert.equal(digestsEqual(a, hashToken("a")), true);
  assert.equal(digestsEqual(a, hashToken("b")), false);
  assert.equal(digestsEqual(a, ""), false);
  assert.equal(digestsEqual(a, 7), false);
});

// ── Request/response + device secret ────────────────────────────────────────

test("a correlated reply settles the desktop's in-flight request", async () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const socket = fakeSocket();
  const session = bindSocket(hub, socket, "device");
  socket.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  socket.sent.length = 0;

  const pending = session.request({ type: "pair_register", label: "phone" });
  const request = socket.last();
  assert.equal(request.rid, "1");

  // The relay answers with the same rid.
  socket.emit("message", frame({ type: PAIR_RESULT, ok: true, token: "tok", rid: "1" }));
  const reply = await pending;
  assert.equal(reply.ok, true);
  assert.equal(reply.token, "tok");
});

test("an unanswered request times out as relayUnavailable", async () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const socket = fakeSocket();
  const session = bindSocket(hub, socket, "device");
  socket.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  const reply = await session.request({ type: "pair_register" }, 5);
  assert.equal(reply.ok, false);
  assert.equal(reply.code, ERRORS.relayUnavailable);
});

test("a device secret is required when the relay configures one", () => {
  const hub = createHub({ now: () => 1, log: () => {}, deviceSecret: "s3cret" });
  const wrong = fakeSocket();
  bindSocket(hub, wrong, "device");
  wrong.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", device_secret: "nope" }));
  assert.equal(wrong.last().code, ERRORS.unauthorized);

  const right = fakeSocket();
  bindSocket(hub, right, "device");
  right.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", device_secret: "s3cret" }));
  assert.equal(right.last().type, "device_register_ack");
});

test("used and revoked are tracked separately in the pair list", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const { socket: deviceSocket } = registerDevice(hub);
  deviceSocket.emit("message", frame({ type: PAIR_REGISTER }));
  const token = deviceSocket.last().token;

  const clientSocket = fakeSocket();
  bindSocket(hub, clientSocket, "client");
  clientSocket.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(clientSocket.last().ok, true);

  deviceSocket.emit("message", frame({ type: PAIR_LIST }));
  const pair = deviceSocket.last().pairs[0];
  assert.equal(pair.used, true, "a redeemed token is marked used");
  assert.equal(pair.revoked, false, "redeeming is not revoking");
  assert.equal(pair.connected, true);
});

test("re-registering a device evicts its stale clients", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const first = registerDevice(hub);
  first.socket.emit("message", frame({ type: PAIR_REGISTER }));
  const token = first.socket.last().token;
  const clientSocket = fakeSocket();
  bindSocket(hub, clientSocket, "client");
  clientSocket.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(clientSocket.last().ok, true);

  // The desktop reconnects with a new socket.
  const second = registerDevice(hub);
  assert.equal(clientSocket.closed, true, "stale client is closed");
  assert.equal(clientSocket.last().code, ERRORS.desktopDisconnected);
  assert.equal(second.socket.last().type, "device_register_ack");
});

test("device count is capped", () => {
  const hub = createHub({ now: () => 1, log: () => {}, maxDevices: 1 });
  const a = fakeSocket();
  bindSocket(hub, a, "device");
  a.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-a", protocol_version: PROTOCOL_VERSION }));
  assert.equal(a.last().type, "device_register_ack");

  const b = fakeSocket();
  bindSocket(hub, b, "device");
  b.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-b", protocol_version: PROTOCOL_VERSION }));
  assert.equal(b.last().code, ERRORS.unsupportedAction);
});
