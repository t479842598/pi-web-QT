import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveDeepSeekPrice, matchesDeepSeekCNY, cnyCost, formatCNY, DEEPSEEK_CNY_PRICING } =
  await jiti.import("./deepseek-pricing.ts");

test("resolveDeepSeekPrice matches by sub-string, provider-independent", () => {
  assert.equal(resolveDeepSeekPrice("deepseek-v4-flash"), "flash");
  assert.equal(resolveDeepSeekPrice("deepseek-v4-pro"), "pro");
  // gateway / proxy / dated ids resolve the same way
  assert.equal(resolveDeepSeekPrice("zenmux/deepseek-v4-pro"), "pro");
  assert.equal(resolveDeepSeekPrice("deepseek-v4-pro-20260809"), "pro");
  assert.equal(resolveDeepSeekPrice("proxy/deepseek-v4-flash/ctx64k"), "flash");
  // non-matching models stay un-priced
  assert.equal(resolveDeepSeekPrice("deepseek-chat"), null);
  assert.equal(resolveDeepSeekPrice("deepseek-reasoner"), null);
  assert.equal(resolveDeepSeekPrice("claude-sonnet-4-6"), null);
  assert.equal(resolveDeepSeekPrice(""), null);
  assert.equal(resolveDeepSeekPrice(undefined), null);
  assert.equal(resolveDeepSeekPrice(null), null);
});

test("matchesDeepSeekCNY mirrors resolveDeepSeekPrice", () => {
  assert.equal(matchesDeepSeekCNY("deepseek-v4-flash"), true);
  assert.equal(matchesDeepSeekCNY("zenmux/deepseek-v4-pro"), true);
  assert.equal(matchesDeepSeekCNY("deepseek-chat"), false);
  assert.equal(matchesDeepSeekCNY("gpt-5.6"), false);
});

test("cnyCost uses official CNY table (flash)", () => {
  // input 1M * ¥1 + output 500k * ¥2 + cacheRead 200k * ¥0.02 → ¥2.004
  const cost = cnyCost("deepseek-v4-flash", {
    input: 1_000_000,
    output: 500_000,
    cacheRead: 200_000,
  });
  assert.ok(Math.abs(cost - 2.004) < 1e-9, `expected 2.004, got ${cost}`);
  // flash official per-M prices
  const p = DEEPSEEK_CNY_PRICING.flash;
  assert.deepEqual(p, { cacheRead: 0.02, input: 1, output: 2, cacheWrite: 0 });
});

test("cnyCost uses official CNY table (pro)", () => {
  const cost = cnyCost("zenmux/deepseek-v4-pro", {
    input: 1_000_000,
    output: 1_000_000,
    cacheRead: 0,
  });
  assert.ok(Math.abs(cost - 9) < 1e-9, `expected 9, got ${cost}`);
});

test("cnyCost ignores cacheWrite (free) and handles missing fields", () => {
  const cost = cnyCost("deepseek-v4-flash", { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 1_000_000 });
  assert.ok(Math.abs(cost - 0.5) < 1e-9);
  assert.equal(cnyCost("deepseek-v4-flash", {}), 0);
  assert.equal(cnyCost("deepseek-v4-flash", null), 0);
  assert.equal(cnyCost("deepseek-chat", { input: 1_000_000 }), 0);
  assert.equal(cnyCost("deepseek-v4-flash", { input: -5, output: NaN }), 0);
});

test("formatCNY edge cases", () => {
  assert.equal(formatCNY(0), "¥0.00");
  assert.equal(formatCNY(-1), "¥0.00");
  assert.equal(formatCNY(0.004), "<¥0.01");
  assert.equal(formatCNY(0.0123), "¥0.0123");
  assert.equal(formatCNY(1.5), "¥1.50");
  assert.equal(formatCNY(38.93), "¥38.93");
  assert.equal(formatCNY(NaN), "¥0.00");
  assert.equal(formatCNY(Infinity), "¥0.00");
});
