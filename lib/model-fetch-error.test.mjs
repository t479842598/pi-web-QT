import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const { describeModelsFetchError } = await jiti.import("./model-fetch-error.ts");

function named(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

const cases = [
  // [label, error, httpStatus, expectedKind]
  ["TimeoutError", named("TimeoutError"), undefined, "timeout"],
  ["AbortError", named("AbortError"), undefined, "timeout"],
  ["401", new Error("Unauthorized"), 401, "unauthorized"],
  ["403", new Error("Forbidden"), 403, "forbidden"],
  ["404", new Error("Not Found"), 404, "notFound"],
  ["429", new Error("Too Many Requests"), 429, "rateLimited"],
  ["500", new Error("Internal Server Error"), 500, "upstream"],
  ["502", new Error("Bad Gateway"), 502, "upstream"],
  ["503", new Error("Service Unavailable"), 503, "upstream"],
  ["TypeError", new TypeError("fetch failed"), undefined, "network"],
  ["SyntaxError", new SyntaxError("Unexpected token < in JSON"), undefined, "invalidResponse"],
  ["unknown", new Error("something else"), undefined, "unknown"],
  ["no error", undefined, undefined, "unknown"],
];

for (const [label, error, status, kind] of cases) {
  test(`describeModelsFetchError: ${label} maps to ${kind}`, () => {
    const described = describeModelsFetchError(error, status);
    assert.equal(described.kind, kind);
    assert.equal(typeof described.message, "string");
    assert.ok(described.message.length > 0);
    // the message is human-facing English chrome, never the raw object dump
    assert.ok(!described.message.includes("[object Object]"));
    if (typeof status === "number") assert.equal(described.httpStatus, status);
    else assert.equal(described.httpStatus, undefined);
  });
}

test("describeModelsFetchError: an HTTP status wins over the thrown value", () => {
  const timeout = named("TimeoutError");
  assert.equal(describeModelsFetchError(timeout, 401).kind, "unauthorized");
  assert.equal(describeModelsFetchError(timeout, 404).kind, "notFound");
  assert.equal(describeModelsFetchError(new TypeError("fetch failed"), 503).kind, "upstream");
  assert.equal(describeModelsFetchError(new SyntaxError("bad json"), 500).kind, "upstream");
});

test("describeModelsFetchError: any 5xx is upstream, an unmapped 4xx stays unknown", () => {
  assert.equal(describeModelsFetchError(new Error("gateway"), 504).kind, "upstream");
  assert.equal(describeModelsFetchError(new Error("gateway timeout"), 408).kind, "unknown");
  assert.equal(describeModelsFetchError(new Error("teapot"), 418).kind, "unknown");
  assert.equal(describeModelsFetchError(new Error("unprocessable"), 422).kind, "unknown");
  assert.equal(describeModelsFetchError(new Error("teapot"), 418).httpStatus, 418);
});

test("describeModelsFetchError: every kind has its own message", () => {
  const kinds = new Set(cases.map((entry) => entry[3]));
  const messages = new Map();
  for (const [label, error, status, kind] of cases) {
    const { message } = describeModelsFetchError(error, status);
    if (!messages.has(kind)) messages.set(kind, new Set());
    messages.get(kind).add(message);
    assert.ok(message.length > 0, label);
  }
  for (const kind of ["unauthorized", "forbidden", "notFound", "rateLimited", "upstream", "timeout", "network", "invalidResponse"]) {
    assert.ok(kinds.has(kind), kind);
    assert.equal(messages.get(kind).size, 1, kind);
  }
});

test("describeModelsFetchError: never throws on hostile inputs", () => {
  for (const value of [null, undefined, 0, "boom", {}, [], Symbol("x"), () => {}, { name: 42 }]) {
    assert.doesNotThrow(() => describeModelsFetchError(value));
    assert.equal(typeof describeModelsFetchError(value).kind, "string");
  }
  assert.equal(describeModelsFetchError("boom").kind, "unknown");
  assert.equal(describeModelsFetchError({ name: "TimeoutError" }).kind, "timeout");
});
