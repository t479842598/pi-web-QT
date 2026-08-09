import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { dedupeProxies } = await createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
}).import("./OpenCodeZenConfig.tsx");

const proxy = (overrides = {}) => ({
  protocol: "http",
  url: "proxy.example.com",
  port: 7890,
  username: "",
  password: "",
  hasPassword: false,
  ...overrides,
});

test("dedupeProxies drops repeated identical nodes", () => {
  const proxies = [proxy(), proxy(), proxy({ port: 7891 })];
  const deduped = dedupeProxies(proxies);
  assert.equal(deduped.length, 2);
});

test("dedupeProxies ignores username/password differences for the same node", () => {
  const proxies = [proxy(), proxy({ username: "u2", password: "p2", hasPassword: true })];
  assert.equal(dedupeProxies(proxies).length, 1);
});

test("dedupeProxies normalizes host case", () => {
  const proxies = [proxy(), proxy({ url: "Proxy.Example.COM" })];
  assert.equal(dedupeProxies(proxies).length, 1);
});

test("dedupeProxies distinguishes protocol and port", () => {
  const proxies = [proxy(), proxy({ protocol: "socks5" }), proxy({ port: 7891 })];
  assert.equal(dedupeProxies(proxies).length, 3);
});

test("dedupeProxies keeps the first occurrence", () => {
  const proxies = [proxy({ username: "first" }), proxy({ username: "second" })];
  const deduped = dedupeProxies(proxies);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].username, "first");
});