import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 隔离环境变量：默认参数会读取 PI_WEB_PASSWORD，测试不应依赖外部环境
const origPassword = process.env.PI_WEB_PASSWORD;
delete process.env.PI_WEB_PASSWORD;
process.on("exit", () => { if (origPassword) process.env.PI_WEB_PASSWORD = origPassword; });

const { credentialsMatch, isWebPasswordEnabled, isValidBasicAuthorization } = await createJiti(import.meta.url).import("./web-auth.ts");
const authorization = (username, password) => `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;

test("enables Basic auth only for a non-empty configured password", () => {
  assert.equal(isWebPasswordEnabled(undefined), false);
  assert.equal(isWebPasswordEnabled(""), false);
  assert.equal(isWebPasswordEnabled("secret"), true);
});

test("requires fixed pi username and accepts UTF-8 passwords with colons", () => {
  const password = "口令:with:colons";
  assert.equal(isValidBasicAuthorization(authorization("pi", password), password), true);
  assert.equal(isValidBasicAuthorization(authorization("admin", password), password), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "wrong"), password), false);
});

test("rejects malformed and non-canonical authorization values", () => {
  const valid = authorization("pi", "secret");
  assert.equal(isValidBasicAuthorization(null, "secret"), false);
  assert.equal(isValidBasicAuthorization("Basic !!!", "secret"), false);
  assert.equal(isValidBasicAuthorization(`${valid}!`, "secret"), false);
});

test("compares username and password even when username mismatches", () => {
  const comparisons = [];
  const compareSecrets = (actual, expected) => {
    comparisons.push([actual, expected]);
    return false;
  };

  assert.equal(credentialsMatch("not-pi", "secret", "expected", compareSecrets), false);
  assert.deepEqual(comparisons, [
    ["not-pi", "pi"],
    ["secret", "expected"],
  ]);
});
