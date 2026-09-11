import assert from "node:assert/strict";
import test from "node:test";
import { bindSocket, createHub } from "./hub.mjs";
import { parseFrame, PROTOCOL_VERSION, DEVICE_REGISTER_INIT, PAIR_LIST, PAIR_REGISTER, CLIENT_PAIR, ERRORS } from "./protocol.mjs";

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

const frame = (m) => JSON.stringify(m);

function pairedSetup() {
  const hub = createHub({ now: () => 1, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER }));
  const token = device.last().token;
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  return { hub, device, client };
}

test("pairing hands back a durable session credential", () => {
  const { hub, client } = pairedSetup();
  const result = client.last();
  assert.equal(result.ok, true);
  assert.equal(typeof result.cid, "string");
  assert.equal(typeof result.session, "string");
  assert.equal(hub.sessions.size, 1);
});

test("a tunnelled request carries the client id and is not broadcast", () => {
  const { device, client } = pairedSetup();
  const cid = client.last().cid;
  client.emit("message", frame({ type: "http_request", rid: "1", method: "GET", path: "/api/sessions" }));
  const forwarded = device.last();
  assert.equal(forwarded.type, "http_request");
  assert.equal(forwarded.cid, cid, "the desktop must know which phone to answer");
  assert.equal(forwarded.path, "/api/sessions");
});

test("responses route back to the addressed phone only", () => {
  const { device, client } = pairedSetup();
  const cid = client.last().cid;
  client.sent.length = 0;
  device.emit("message", frame({ type: "http_response_head", cid, rid: "1", status: 200, headers: {} }));
  assert.equal(client.last().type, "http_response_head");
  assert.equal(client.last().status, 200);

  // A response naming an unknown client is dropped rather than broadcast.
  client.sent.length = 0;
  device.emit("message", frame({ type: "http_response_chunk", cid: "nope", rid: "1", data: "x" }));
  assert.equal(client.sent.length, 0);
});

test("a request from an unpaired socket is refused", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const stranger = fakeSocket();
  bindSocket(hub, stranger, "client");
  stranger.emit("message", frame({ type: "http_request", rid: "1", path: "/api/sessions" }));
  assert.equal(stranger.last().code, ERRORS.sessionNotFound);
});

test("the stored credential resumes without re-pairing", () => {
  const { hub, client } = pairedSetup();
  const session = client.last().session;
  client.emit("message", frame({ type: "client_resume", device_mid: "dev-1", session }));
  assert.equal(client.last().ok, true);
  assert.equal(hub.sessionFor(session)?.mid, "dev-1");
});

test("revoking the token kills sessions derived from it", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER }));
  const token = device.last().token;
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  const session = client.last().session;
  assert.equal(hub.sessionFor(session) !== null, true);

  device.emit("message", frame({ type: "pair_revoke", token }));
  assert.equal(hub.sessionFor(session), null, "revocation must invalidate the credential");
});

test("proxyRequest tunnels a request without a browser socket", async () => {
  const { hub, device } = pairedSetup();
  const seen = [];
  // Clear the pairing frames so `last()` is the tunnelled request.
  device.sent.length = 0;
  // `proxyRequest` takes the hub's device record (it needs `.socket`), not the
  // raw socket the other assertions use.
  const record = hub.deviceFor("dev-1");
  const promise = hub.proxyRequest(record, {
    method: "GET",
    path: "/favicon.svg",
    onHead: (status, headers) => seen.push(["head", status, headers["content-type"]]),
    onChunk: (buf) => seen.push(["chunk", buf.toString("utf8")]),
  });
  // `proxyRequest` registers its virtual client asynchronously; let that settle
  // before the frame is on the wire.
  await new Promise((resolve) => setImmediate(resolve));
  const request = device.last();
  assert.equal(request.type, "http_request");
  device.emit("message", frame({ type: "http_response_head", cid: request.cid, rid: request.rid, status: 200, headers: { "content-type": "image/svg+xml" } }));
  device.emit("message", frame({ type: "http_response_chunk", cid: request.cid, rid: request.rid, data: Buffer.from("<svg/>").toString("base64"), encoding: "base64" }));
  device.emit("message", frame({ type: "http_response_end", cid: request.cid, rid: request.rid }));
  await promise;
  assert.deepEqual(seen, [["head", 200, "image/svg+xml"], ["chunk", "<svg/>"]]);
});

// ── Reusable (permanent) links ──────────────────────────────────────────────

test("a reusable token pairs several devices through one link", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER, ttlMs: 0, reusable: true }));
  const token = device.last().token;
  assert.equal(typeof token, "string");

  const sessions = new Set();
  for (let i = 0; i < 3; i += 1) {
    const client = fakeSocket();
    bindSocket(hub, client, "client");
    client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
    assert.equal(client.last().ok, true, `device ${i} should pair`);
    sessions.add(client.last().session);
  }
  assert.equal(sessions.size, 3, "each device gets its own credential");
  assert.equal(hub.deviceFor("dev-1").clients.size, 3);
});

test("a reusable link reports how many devices are attached", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER, ttlMs: 0, reusable: true }));
  const token = device.last().token;
  assert.equal(typeof token, "string");

  for (let i = 0; i < 2; i += 1) {
    const extra = fakeSocket();
    bindSocket(hub, extra, "client");
    extra.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  }
  device.emit("message", frame({ type: PAIR_LIST }));
  const reusable = device.last().pairs.find((pair) => pair.reusable === true);
  assert.equal(reusable.connections >= 2, true, "connections reflects attached phones");
  assert.equal(reusable.used, false, "a reusable token is never marked used");
});

test("revoking a reusable link drops every device that used it", () => {
  const hub = createHub({ now: () => 1, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER, ttlMs: 0, reusable: true }));
  const token = device.last().token;

  const clients = [];
  for (let i = 0; i < 2; i += 1) {
    const client = fakeSocket();
    bindSocket(hub, client, "client");
    client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
    clients.push(client);
  }
  assert.equal(hub.deviceFor("dev-1").clients.size, 2);

  device.emit("message", frame({ type: "pair_revoke", token }));
  for (const client of clients) {
    assert.equal(client.closed, true, "every device is disconnected on revoke");
    assert.equal(client.last().code, ERRORS.kicked);
  }
  assert.equal(hub.sessions.size, 0, "credentials die with the link");
});

test("a reusable link yields credentials without expiry", () => {
  const hub = createHub({ now: () => 5, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER, ttlMs: 0, reusable: true }));
  const token = device.last().token;
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  const session = client.last().session;
  const record = hub.sessionFor(session);
  assert.equal(record.expiresAt, null, "a permanent link must not expire its sessions");
});

test("an expired one-shot token still reports expiry, not spent", () => {
  let current = 0;
  const hub = createHub({ now: () => current, log: () => {} });
  const device = fakeSocket();
  bindSocket(hub, device, "device");
  device.emit("message", frame({ type: DEVICE_REGISTER_INIT, device_mid: "dev-1", protocol_version: PROTOCOL_VERSION }));
  device.emit("message", frame({ type: PAIR_REGISTER, ttlMs: 100 }));
  const token = device.last().token;
  current = 500;
  const client = fakeSocket();
  bindSocket(hub, client, "client");
  client.emit("message", frame({ type: CLIENT_PAIR, device_mid: "dev-1", token }));
  assert.equal(client.last().code, ERRORS.sessionExpired);
});
