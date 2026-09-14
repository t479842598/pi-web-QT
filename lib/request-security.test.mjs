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

test("writes from non-browser clients are rejected on LAN, allowed on loopback", () => {
  // Simulates a LAN curl/script hitting a 0.0.0.0-bound instance. Loopback
  // writers are local users (upstream semantics); LAN plain writes stay
  // rejected (fork hardening).
  assert.equal(isApiRequestAllowed(makeRequest("PUT", "192.168.5.2:3000")), false);
  assert.equal(isApiRequestAllowed(makeRequest("POST", "192.168.5.2:3000")), false);
  assert.equal(isApiRequestAllowed(makeRequest("DELETE", "localhost:3000")), true);
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

test("rejects default-port Origins on non-default listeners without same-origin evidence", () => {
  for (const scheme of ["http", "https"]) {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      for (const site of [undefined, "same-site", "none", "cross-site"]) {
        for (const method of ["GET", "POST"]) {
          const headers = {
            host: `${host}:30141`,
            origin: `${scheme}://${host}`,
            ...(site ? { "sec-fetch-site": site } : {}),
          };
          const req = new Request(`${scheme}://${host}:30141/api/test`, { method, headers });
          assert.equal(isApiRequestAllowed(req), false, `${method} ${headers.origin} ${site}`);
        }
      }
    }
  }
});

test("default-port Origins remain valid on their own default-port listener", () => {
  for (const [scheme, port] of [["http", "80"], ["https", "443"]]) {
    const req = new Request(`${scheme}://127.0.0.1/api/test`, {
      method: "POST",
      headers: { host: `127.0.0.1:${port}`, origin: `${scheme}://127.0.0.1` },
    });
    assert.equal(isApiRequestAllowed(req), true);
  }
});

test("same-origin metadata never excuses a different explicit port", () => {
  const req = makeRequest("POST", "127.0.0.1:30141", {
    origin: "http://127.0.0.1:30142",
    "sec-fetch-site": "same-origin",
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

test("allows a proxy that reports the scheme out-of-band and rewrites Origin", async () => {
  // Azure Dev Tunnels normalizes Host and Origin onto the backend authority
  // but keeps the external scheme in x-forwarded-proto.
  const request = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), true);
});

test("still rejects a foreign origin when a proxy is in front", async () => {
  const foreignHost = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://attacker.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const foreignPort = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30142",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const alternateLoopback = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://127.0.0.1:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const opaque = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "null",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });

  assert.equal(isApiRequestAllowed(foreignHost), false);
  assert.equal(isApiRequestAllowed(foreignPort), false);
  assert.equal(isApiRequestAllowed(alternateLoopback), false);
  assert.equal(isApiRequestAllowed(opaque), false);
});

test("does not relax the scheme without same-origin proxy evidence", async () => {
  const request = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);

  request.headers.set("x-forwarded-proto", "https");
  request.headers.set("sec-fetch-site", "same-site");
  assert.equal(isApiRequestAllowed(request), false);
});
