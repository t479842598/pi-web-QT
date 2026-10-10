import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FONT_SCALE,
  MIN_FONT_SCALE,
  MAX_FONT_SCALE,
  FONT_SCALE_STEP,
  FONT_SCALE_PRESETS,
  normalizeFontScale,
  isFontScale,
  fontScaleFromLegacyFontSize,
  resolveFontScale,
  fontScalePercent,
} from "./font-scale.ts";

test("defaults and bounds match PI-Desktop", () => {
  assert.equal(DEFAULT_FONT_SCALE, 1);
  assert.equal(MIN_FONT_SCALE, 0.8);
  assert.equal(MAX_FONT_SCALE, 1.5);
  assert.equal(FONT_SCALE_STEP, 0.025);
  assert.deepEqual(FONT_SCALE_PRESETS, { small: 0.85, default: 1, large: 1.15, xl: 1.25 });
});

test("normalizeFontScale clamps to the range", () => {
  assert.equal(normalizeFontScale(0.1), MIN_FONT_SCALE);
  assert.equal(normalizeFontScale(9), MAX_FONT_SCALE);
});

test("normalizeFontScale snaps onto the step grid", () => {
  assert.equal(normalizeFontScale(1.26), 1.25);
  assert.equal(normalizeFontScale(1.23), 1.225);
  assert.equal(normalizeFontScale(1.1249), 1.125);
});

test("normalizeFontScale falls back on non-numbers", () => {
  assert.equal(normalizeFontScale("1.2"), DEFAULT_FONT_SCALE);
  assert.equal(normalizeFontScale(NaN), DEFAULT_FONT_SCALE);
  assert.equal(normalizeFontScale(undefined), DEFAULT_FONT_SCALE);
});

test("isFontScale only accepts normalized values", () => {
  assert.equal(isFontScale(1.25), true);
  assert.equal(isFontScale(1), true);
  assert.equal(isFontScale(1.26), false);
  assert.equal(isFontScale(2), false);
});

test("legacy fontSize px converts at 14px base", () => {
  assert.equal(fontScaleFromLegacyFontSize(14), 1);
  assert.equal(fontScaleFromLegacyFontSize(21), 1.5);
  assert.equal(fontScaleFromLegacyFontSize(11), 0.8);
  assert.equal(fontScaleFromLegacyFontSize(-1), undefined);
  assert.equal(fontScaleFromLegacyFontSize(13.5), undefined);
});

test("resolveFontScale prefers fontScale, falls back to legacy fontSize", () => {
  assert.equal(resolveFontScale({ fontScale: 1.15 }), 1.15);
  assert.equal(resolveFontScale({ fontSize: 21 }), 1.5);
  assert.equal(resolveFontScale({}), DEFAULT_FONT_SCALE);
});

test("fontScalePercent renders a whole percentage", () => {
  assert.equal(fontScalePercent(1), "100%");
  assert.equal(fontScalePercent(1.25), "125%");
  assert.equal(fontScalePercent(0.85), "85%");
});
