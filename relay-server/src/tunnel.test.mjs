import assert from "node:assert/strict";
import test from "node:test";
import { createTunnelRegistry, payloadBytes, isTunnelFrame } from "./tunnel.mjs";

test("payloadBytes measures strings, buffers and byte arrays", () => {
  assert.equal(payloadBytes("abc"), 3);
  assert.equal(payloadBytes(Buffer.from("abcd")), 4);
  assert.equal(payloadBytes(new Uint8Array(5)), 5);
  assert.equal(payloadBytes(undefined), 0);
  assert.equal(payloadBytes(42), -1, "unsupported payload types are rejected");
});

test("isTunnelFrame recognises only tunnel frames", () => {
  assert.equal(isTunnelFrame("http_request"), true);
  assert.equal(isTunnelFrame("http_response_end"), true);
  assert.equal(isTunnelFrame("pair_result"), false);
  assert.equal(isTunnelFrame("rpc"), false);
});

test("inflight slots are per client and released on end", () => {
  const registry = createTunnelRegistry({ maxInflight: 2, now: () => 1000 });
  assert.equal(registry.begin("c1", "1").ok, true);
  assert.equal(registry.begin("c1", "2").ok, true);
  assert.equal(registry.begin("c1", "3").ok, false, "third request exceeds the cap");
  // Another phone has its own budget.
  assert.equal(registry.begin("c2", "1").ok, true);

  registry.end("c1", "1");
  assert.equal(registry.begin("c1", "3").ok, true);
  assert.equal(registry.countFor("c1"), 2);
});

test("forget drops a client's slots on disconnect", () => {
  const registry = createTunnelRegistry({ now: () => 0 });
  registry.begin("c1", "1");
  registry.forget("c1");
  assert.equal(registry.countFor("c1"), 0);
});

test("pruneStale releases slots that outlived the timeout", () => {
  let current = 0;
  const registry = createTunnelRegistry({ now: () => current });
  registry.begin("c1", "old");
  current = 500_000;
  registry.begin("c1", "new");
  const dropped = registry.pruneStale(10_000);
  assert.equal(dropped, 1);
  assert.equal(registry.countFor("c1"), 1);
});
