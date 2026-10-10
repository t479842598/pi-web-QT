import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const originalNodeEnv = process.env.NODE_ENV;
const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../", import.meta.url)) },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("../proxy.ts");
const { GET, POST } = await jiti.import("../app/api/web-auth/route.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");
const { recordAuthSuccess, getAuthRetryAfterMs } = await jiti.import("./auth-throttle.ts");
const password = "routing-test-password";
const correct = `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
const wrong = `Basic ${Buffer.from("pi:incorrect").toString("base64")}`;

beforeEach(() => {
  process.env.PI_WEB_PASSWORD = password;
  process.env.NODE_ENV = "production";
  recordAuthSuccess();
});
after(() => {
  recordAuthSuccess();
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function request(path, authorization, options = {}) {
  return new NextRequest(`http://localhost${path}`, {
    ...options,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      ...(authorization ? { Authorization: authorization } : {}),
      ...options.headers,
    },
  });
}

function assertThrottled(response) {
  assert.equal(response.status, 429);
  assert.match(response.headers.get("retry-after") ?? "", /^[1-9]\d*$/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("www-authenticate"), false);
}

test("every page Basic verifier feeds the throttle in dev and production", (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  for (const environment of ["development", "production"]) {
    process.env.NODE_ENV = environment;
    for (const path of ["/", "/login", "/sessions/view?tab=chat"]) {
      for (const method of ["GET", "HEAD"]) {
        recordAuthSuccess();
        proxy(request(path, wrong, { method }));
        assert.equal(getAuthRetryAfterMs(), 1000, `${environment} ${method} ${path}`);
        assertThrottled(proxy(request(path, correct, { method })));
        assertThrottled(proxy(request(path, wrong, { method })));
      }
    }
  }
});

test("page failures block API Basic and GET/POST login attempts", async (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  proxy(request("/", wrong));
  assertThrottled(proxy(request("/api/sessions", correct)));
  assertThrottled(await GET(request("/api/web-auth", correct)));
  assertThrottled(await POST(request("/api/web-auth", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })));
});

test("API and GET/POST login failures each block page Basic", async (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  const failures = [
    () => proxy(request("/api/sessions", wrong)),
    () => GET(request("/api/web-auth", wrong)),
    () => POST(request("/api/web-auth", undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect" }),
    })),
  ];
  for (const fail of failures) {
    recordAuthSuccess();
    await fail();
    assertThrottled(proxy(request("/", correct)));
    assertThrottled(proxy(request("/login", wrong)));
  }
});

test("GET and POST login share backoff directly without Basic success resetting it", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const login = (value) => POST(request("/api/web-auth", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: value }),
  }));
  assert.equal((await GET(request("/api/web-auth", wrong))).status, 401);
  assertThrottled(await login(password));
  now += 1000;
  assert.equal((await GET(request("/api/web-auth", correct))).status, 200);
  assert.equal((await login("incorrect")).status, 401);
  assert.equal(getAuthRetryAfterMs(), 2000);
  assertThrottled(await GET(request("/api/web-auth", correct)));
  assertThrottled(await GET(request("/api/web-auth", wrong)));
});

test("valid cookies take precedence over a blocked or incorrect Basic header", async (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  const headers = { Cookie: `pi_web_session=${createWebSessionToken(password)}` };
  proxy(request("/api/sessions", wrong));
  for (const path of ["/", "/api/sessions"]) {
    assert.equal(proxy(request(path, wrong, { headers })).headers.get("x-middleware-next"), "1");
  }
  assert.equal(proxy(request("/login", wrong, { headers })).status, 302);
  assert.equal((await GET(request("/api/web-auth", wrong, { headers }))).status, 200);
  assert.equal(getAuthRetryAfterMs(), 1000);
});

test("static assets and headerless login remain accessible during backoff", (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  proxy(request("/api/sessions", wrong));
  for (const path of ["/_next/static/chunk.js", "/favicon.svg", "/catppuccin-icons/mocha/file.svg"]) {
    assert.equal(proxy(request(path, wrong)).headers.get("x-middleware-next"), "1");
  }
  assert.equal(proxy(request("/login")).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(request("/")).status, 307);
  assert.equal(getAuthRetryAfterMs(), 1000);
});

test("page Basic works after backoff without resetting failure history", (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  proxy(request("/", wrong));
  assertThrottled(proxy(request("/", correct)));
  now += 1000;
  assert.equal(proxy(request("/", correct)).headers.get("x-middleware-next"), "1");
  proxy(request("/login", wrong));
  assert.equal(getAuthRetryAfterMs(), 2000);
});
