import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isApiRequestAllowed } = await jiti.import("./request-security.ts");

function makeRequest(method, host, extra = {}) {
  return new Request(`http://${host}/api/test`, {
    method,
    headers: { host, ...extra },
  });
}

test("writes from non-browser clients (no Origin) are rejected", () => {
  // Simulates a LAN curl/script hitting a 0.0.0.0-bound instance.
  assert.equal(isApiRequestAllowed(makeRequest("PUT", "192.168.5.2:3000")), false);
  assert.equal(isApiRequestAllowed(makeRequest("POST", "192.168.5.2:3000")), false);
  assert.equal(isApiRequestAllowed(makeRequest("DELETE", "localhost:3000")), false);
});

test("reads from non-browser clients stay allowed", () => {
  assert.equal(isApiRequestAllowed(makeRequest("GET", "192.168.5.2:3000")), true);
  assert.equal(isApiRequestAllowed(makeRequest("GET", "127.0.0.1:3000")), true);
});

test("same-origin browser writes are allowed", () => {
  const req = makeRequest("PUT", "192.168.5.2:3000", {
    origin: "http://192.168.5.2:3000",
    "content-type": "application/json",
  });
  assert.equal(isApiRequestAllowed(req), true);
});

test("cross-site writes are rejected", () => {
  const req = makeRequest("PUT", "192.168.5.2:3000", {
    origin: "http://evil.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(isApiRequestAllowed(req), false);
});

test("cross-site reads are also rejected (existing behavior)", () => {
  const req = makeRequest("GET", "localhost:3000", {
    origin: "http://evil.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(isApiRequestAllowed(req), false);
});

test("unknown hostnames are rejected unless explicitly allowed", () => {
  const req = makeRequest("GET", "my-tunnel.trycloudflare.com");
  assert.equal(isApiRequestAllowed(req), false);
  // explicit operator allow-list opens it
  const allowed = makeRequest("GET", "my-tunnel.trycloudflare.com");
  assert.equal(isApiRequestAllowed(allowed, ["my-tunnel.trycloudflare.com"]), true);
});

test("rejects malformed and unconfigured Host headers", () => {
  // A malformed Host header must not be trusted even when the request URL is
  // a loopback address.
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "localhost@attacker.example:30141" },
  })), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "pi-web.internal:30141" },
  })), false);
});

test("rejects a same-host Origin on a different explicit port", () => {
  // A malicious page served from another local service on the same host must
  // not be able to write to this instance just because the hostname matches.
  const req = makeRequest("PUT", "127.0.0.1:30141", {
    origin: "http://127.0.0.1:8080",
    "content-type": "application/json",
  });
  assert.equal(isApiRequestAllowed(req), false);
});

test("allows same-origin requests when Chromium strips the port from Origin", () => {
  // Chromium 150+ strips the port from Origin on non-default ports.
  const req = makeRequest("GET", "127.0.0.1:30141", {
    origin: "http://127.0.0.1",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(isApiRequestAllowed(req), true);
});
