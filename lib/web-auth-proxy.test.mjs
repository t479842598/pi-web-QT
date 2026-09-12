import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("../proxy.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");

before(() => { process.env.PI_WEB_PASSWORD = "secret"; });
after(() => {
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
});

function request(path, headers = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { Host: "localhost", ...headers },
  });
}

test("redirects page navigation to the login page and preserves its query", () => {
  const response = proxy(request("/?session=abc"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2F%3Fsession%3Dabc");
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
