import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions, assessLanExposure } = require("../bin/pi-web-options.js");

test("does not open the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30141",
    hostname: "0.0.0.0",
    openBrowser: false,
  });
});

test("opens the browser only with --open", () => {
  assert.equal(parseLaunchOptions(["--open"], {}).openBrowser, true);
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy PI_WEB_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false PI_WEB_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions(["--open"], { PI_WEB_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "127.0.0.1"], {}),
    {
      port: "8080",
      hostname: "127.0.0.1",
      openBrowser: false,
    },
  );
});

// ─── assessLanExposure (P0: refuse unauthenticated non-loopback start) ──────

test("assessLanExposure: loopback hosts never warn", () => {
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    assert.equal(assessLanExposure(host, {}), "loopback");
  }
});

test("assessLanExposure: non-loopback with password warns about plaintext HTTP", () => {
  assert.equal(assessLanExposure("0.0.0.0", { PI_WEB_PASSWORD: "secret" }), "warn-plaintext");
});

test("assessLanExposure: non-loopback without password refuses to start", () => {
  assert.equal(assessLanExposure("0.0.0.0", {}), "refuse");
  assert.equal(assessLanExposure("192.168.1.5", {}), "refuse");
});

test("assessLanExposure: explicit insecure-LAN override downgrades refuse to a warning", () => {
  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(assessLanExposure("0.0.0.0", { PI_WEB_ALLOW_INSECURE_LAN: value }), "warn-insecure-lan");
  }
  assert.equal(assessLanExposure("0.0.0.0", { PI_WEB_ALLOW_INSECURE_LAN: "0" }), "refuse");
});
