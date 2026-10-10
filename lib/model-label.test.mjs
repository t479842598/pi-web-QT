import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { truncateModelLabel, MODEL_LABEL_MAX_CHARS } =
  await createJiti(import.meta.url).import("./model-label.ts");

test("keeps names at or under the limit untouched", () => {
  assert.equal(truncateModelLabel("deepseek"), "deepseek");
  assert.equal(truncateModelLabel("opus-5.5"), "opus-5.5");
  assert.equal(truncateModelLabel("a".repeat(MODEL_LABEL_MAX_CHARS)), "a".repeat(MODEL_LABEL_MAX_CHARS));
});

test("truncates only past the limit, appending one ellipsis", () => {
  const long = "claude-opus-5-5";
  const result = truncateModelLabel(long);
  assert.equal(result, `${long.slice(0, MODEL_LABEL_MAX_CHARS)}…`);
  assert.equal(result.length, MODEL_LABEL_MAX_CHARS + 1);
  assert.ok(result.endsWith("…"));
});

test("honours a custom limit and trims surrounding whitespace", () => {
  assert.equal(truncateModelLabel("abcdefghijk", 4), "abcd…");
  assert.equal(truncateModelLabel("  short  "), "short");
});
