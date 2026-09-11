import assert from "node:assert/strict";
import test from "node:test";
import { isAppAbsolutePath, isHtmlResponse, isRelayOwnedPath, rewriteHtml, rewriteLocation, toProxiedPath, toUpstreamPath } from "./proxy.mjs";

test("incoming /web paths map to the upstream path", () => {
  assert.equal(toUpstreamPath("/web"), "/");
  assert.equal(toUpstreamPath("/web/"), "/");
  assert.equal(toUpstreamPath("/web/api/sessions"), "/api/sessions");
  assert.equal(toUpstreamPath("/web/_next/static/x.js"), "/_next/static/x.js");
  // An asset path the app itself emitted is already absolute upstream.
  assert.equal(toUpstreamPath("/api/sessions"), "/api/sessions");
});

test("app-emitted absolute paths are recognised and prefixed", () => {
  assert.equal(isAppAbsolutePath("/_next/static/chunk.js"), true);
  assert.equal(isAppAbsolutePath("/api/sessions"), true);
  assert.equal(isAppAbsolutePath("/r/token"), false);
  assert.equal(isAppAbsolutePath("/web/api/sessions"), false, "already prefixed");
  assert.equal(toProxiedPath("/api/sessions"), "/web/api/sessions");
  assert.equal(toProxiedPath("/r/x"), "/r/x", "relay-owned paths stay put");
});

test("the relay's own entry point is not treated as app content", () => {
  assert.equal(isRelayOwnedPath("/web"), true);
  assert.equal(isRelayOwnedPath("/web/"), true);
  assert.equal(isRelayOwnedPath("/web/api"), false);
});

test("redirects pointing at the app stay inside the prefix", () => {
  assert.equal(rewriteLocation("/login"), "/web/login");
  assert.equal(rewriteLocation("https://elsewhere/x"), "https://elsewhere/x", "absolute URLs untouched");
  assert.equal(rewriteLocation(undefined), undefined);
});

test("HTML asset references are rewritten exactly once", () => {
  const html = '<script src="/_next/static/a.js"></script><link href="/icon.svg">';
  const once = rewriteHtml(html);
  assert.match(once, /"\/web\/_next\/static\/a\.js"/);
  assert.match(once, /"\/web\/icon\.svg"/);
  // A second pass must not double-prefix.
  assert.equal(rewriteHtml(once), once);
});

test("only HTML responses get the rewrite pass", () => {
  assert.equal(isHtmlResponse({ "content-type": "text/html; charset=utf-8" }), true);
  assert.equal(isHtmlResponse({ "Content-Type": "text/html" }), true);
  assert.equal(isHtmlResponse({ "content-type": "application/json" }), false);
  assert.equal(isHtmlResponse({}), false);
});
