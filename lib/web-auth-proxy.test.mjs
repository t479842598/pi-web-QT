import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { fileURLToPath } from "node:url";

const originalPassword = process.env.PI_WEB_PASSWORD;
const originalNodeEnv = process.env.NODE_ENV;
const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../", import.meta.url)) },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("../proxy.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");

before(() => {
  process.env.PI_WEB_PASSWORD = "secret";
  process.env.NODE_ENV = "production";
});
after(() => {
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function request(path, headers = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { Host: "localhost", ...headers },
  });
}

test("redirects page navigation to the login page and preserves its query", () => {
  const response = proxy(request("/?session=abc"));
  assert.equal(response.status, 307);
  // `reason` tells the login page why it is showing: no cookie was returned
  // ("missing") vs a cookie that failed validation ("invalid").
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2F%3Fsession%3Dabc&reason=missing");
});

test("reports reason=invalid when a session cookie exists but fails validation", () => {
  const response = proxy(request("/", { Cookie: "pi_web_session=v1.1.deadbeefdeadbeefdeadbeefdeadbeef.deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }));
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /reason=invalid/);
});

test("accepts a signed session for pages", () => {
  const token = createWebSessionToken("secret");
  const response = proxy(request("/", { Cookie: `pi_web_session=${token}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("keeps Basic Auth valid for BOTH APIs and pages", () => {
  const authorization = `Basic ${Buffer.from("pi:secret").toString("base64")}`;
  assert.equal(proxy(request("/api/sessions", { Authorization: authorization })).status, 200);
  // This fork keeps Basic valid on page routes too: the Tauri shell injects it
  // into page navigations via its local proxy, so restricting it to /api/*
  // would send the desktop shell to the login page.
  assert.equal(proxy(request("/", { Authorization: authorization })).status, 200);
  assert.equal(proxy(request("/api/sessions")).status, 401);
});

test("never redirects static assets, so the login page can load itself", () => {
  assert.equal(proxy(request("/_next/static/chunk.js")).status, 200);
  assert.equal(proxy(request("/favicon.svg")).status, 200);
  assert.equal(proxy(request("/catppuccin-icons/mocha/file.svg")).status, 200);
  // A normal page still redirects.
  assert.equal(proxy(request("/some/page")).status, 307);
});

test("leaves the login endpoint reachable without a session", () => {
  assert.equal(proxy(request("/login")).status, 200);
  assert.equal(proxy(request("/api/web-auth")).status, 200);
});

test("development and production both require auth even with a forged loopback Host", () => {
  const savedEnv = process.env.NODE_ENV;
  try {
    for (const env of ["development", "production"]) {
      process.env.NODE_ENV = env;
      for (const host of ["localhost:30141", "127.0.0.1:30141", "[::1]:30141"]) {
        for (const authorization of [undefined, `Basic ${Buffer.from("pi:wrong-fixture").toString("base64")}`]) {
          for (const [path, expected] of [["/api/sessions", 401], ["/sessions/view?tab=chat", 307]]) {
            // The URL represents a LAN listener; Host is attacker-controlled.
            const req = new NextRequest(`http://192.0.2.1:30141${path}`, {
              headers: { host, ...(authorization ? { authorization } : {}) },
            });
            const response = proxy(req);
            assert.equal(response.status, expected, `${env} ${host} ${path}`);
            if (expected === 401) assert.match(response.headers.get("www-authenticate"), /^Basic /);
            else assert.equal(new URL(response.headers.get("location")).pathname, "/login");
          }
        }
      }
    }
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});

test("valid Basic and cookie sessions still work in both environments", () => {
  const savedEnv = process.env.NODE_ENV;
  try {
    for (const env of ["development", "production"]) {
      process.env.NODE_ENV = env;
      for (const headers of [
        { authorization: `Basic ${Buffer.from("pi:secret").toString("base64")}` },
        { cookie: `pi_web_session=${createWebSessionToken("secret")}` },
      ]) {
        for (const path of ["/", "/api/sessions"]) {
          const response = proxy(request(path, headers));
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("x-middleware-next"), "1");
        }
      }
    }
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});

test("no-password behavior stays unchanged in development and production", () => {
  const savedEnv = process.env.NODE_ENV;
  const savedPassword = process.env.PI_WEB_PASSWORD;
  try {
    for (const env of ["development", "production"]) {
      process.env.NODE_ENV = env;
      for (const password of [undefined, ""]) {
        if (password === undefined) delete process.env.PI_WEB_PASSWORD;
        else process.env.PI_WEB_PASSWORD = password;
        for (const path of ["/", "/api/sessions"]) {
          assert.equal(proxy(request(path)).headers.get("x-middleware-next"), "1");
        }
        assert.equal(proxy(request("/login")).status, 302);
      }
    }
  } finally {
    process.env.NODE_ENV = savedEnv;
    process.env.PI_WEB_PASSWORD = savedPassword;
  }
});
