import assert from "node:assert/strict";
import test from "node:test";
import { bindSocket, createHub } from "./hub.mjs";
import { parseFrame, PROTOCOL_VERSION, DEVICE_REGISTER_INIT, PAIR_REGISTER, CLIENT_PAIR, ERRORS } from "./protocol.mjs";

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
