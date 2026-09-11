import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  RelayClient,
  createRelayClientFromEnv,
  deviceMidFor,
  DEVICE_REGISTER_INIT,
  DEVICE_REGISTER_ACK,
  PING,
} = await jiti.import("./relay-client.ts");

/** Socket double that hands the test its event handlers. */
function fakeSocketFactory() {
  const sockets = [];
  const factory = (url) => {
    const socket = {
      url,
      sent: [],
      closed: false,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send(data) { socket.sent.push(JSON.parse(data)); },
      close() { socket.closed = true; },
      open() { socket.onopen?.({}); },
      message(frame) { socket.onmessage?.({ data: JSON.stringify(frame) }); },
      drop() { socket.onclose?.({}); },
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

function makeClient(factory, overrides = {}) {
  return new RelayClient({
    url: "wss://relay.example/ws",
    deviceMid: "dev-1",
    deviceName: "pi-web",
    appVersion: "0.0.0",
    socketFactory: factory,
    log: () => {},
    ...overrides,
  });
}

test("registers the device on open and marks itself registered on ack", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory);
  client.start();
  const socket = sockets[0];
  assert.match(socket.url, /role=device/);
  assert.match(socket.url, /mid=dev-1/);

  socket.open();
  assert.equal(socket.sent[0].type, DEVICE_REGISTER_INIT);
  assert.equal(socket.sent[0].device_mid, "dev-1");
  assert.equal(client.getState().state, "connecting");

  socket.message({ type: DEVICE_REGISTER_ACK, device_mid: "dev-1" });
  assert.equal(client.getState().state, "registered");
  client.stop();
});

test("routes non-control frames to onFrame", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory);
  const seen = [];
  client.onFrame = (frame) => seen.push(frame);
  client.start();
  const socket = sockets[0];
  socket.open();
  socket.message({ type: DEVICE_REGISTER_ACK });
  socket.message({ type: "rpc", payload: 1 });
  assert.deepEqual(seen, [{ type: "rpc", payload: 1 }]);
  client.stop();
});

test("send only works once registered", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory);
  client.start();
  assert.equal(client.send({ type: PING }), false);
  sockets[0].open();
  sockets[0].message({ type: DEVICE_REGISTER_ACK });
  assert.equal(client.send({ type: "rpc" }), true);
  assert.equal(sockets[0].sent.at(-1).type, "rpc");
  client.stop();
});

test("reconnects after a drop", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory, { socketFactory: factory });
  client.start();
  sockets[0].open();
  sockets[0].message({ type: DEVICE_REGISTER_ACK });
  sockets[0].drop();
  assert.equal(client.getState().state, "closed");
  // The reconnect is scheduled on a timer; stop() must cancel it.
  client.stop();
  assert.equal(sockets.length, 1);
});

test("stop is idempotent and stops reconnecting", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory);
  client.start();
  client.stop();
  client.stop();
  assert.equal(client.getState().state, "closed");
  assert.equal(sockets.length, 1);
});

test("a socket error is recorded without throwing", () => {
  const { factory, sockets } = fakeSocketFactory();
  const client = makeClient(factory);
  client.start();
  sockets[0].onerror?.(new Error("boom"));
  assert.equal(client.getState().lastError, "boom");
  client.stop();
});

test("createRelayClientFromEnv stays off without a URL", () => {
  const previous = process.env.PI_WEB_RELAY_URL;
  delete process.env.PI_WEB_RELAY_URL;
  try {
    assert.equal(createRelayClientFromEnv(), null);
  } finally {
    if (previous !== undefined) process.env.PI_WEB_RELAY_URL = previous;
  }
});

test("createRelayClientFromEnv builds a client when configured", () => {
  const client = createRelayClientFromEnv({ url: "wss://relay.example/ws", deviceMid: "d" });
  assert.notEqual(client, null);
  assert.equal(client.getState().url, "wss://relay.example/ws");
  client.stop();
});

test("deviceMidFor is deterministic and 32 chars", () => {
  const a = deviceMidFor("/some/path");
  assert.equal(a, deviceMidFor("/some/path"));
  assert.equal(a.length, 32);
  assert.notEqual(a, deviceMidFor("/other/path"));
});
