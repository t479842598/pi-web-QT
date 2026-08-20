import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sameDeepSeekBalance } = await jiti.import("../hooks/useDeepSeekBalance.ts");

const base = {
  available: true,
  reason: undefined,
  currency: "CNY",
  totalBalance: "10.00",
  grantedBalance: "5.00",
  toppedUpBalance: "5.00",
};

test("identical field values are equal (even with different object identities)", () => {
  assert.equal(sameDeepSeekBalance(base, { ...base }), true);
});

test("any changed field makes them unequal", () => {
  assert.equal(sameDeepSeekBalance(base, { ...base, totalBalance: "9.99" }), false);
  assert.equal(sameDeepSeekBalance(base, { ...base, available: false }), false);
  assert.equal(sameDeepSeekBalance(base, { ...base, currency: "USD" }), false);
  assert.equal(sameDeepSeekBalance(base, { ...base, grantedBalance: "4.00" }), false);
  assert.equal(sameDeepSeekBalance(base, { ...base, toppedUpBalance: "6.00" }), false);
  assert.equal(sameDeepSeekBalance(base, { ...base, reason: "error" }), false);
});
