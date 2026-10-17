import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./motion-presets.ts");
  } catch {
    return import("./motion-presets.ts");
  }
}

const {
  MOTION_PRESETS,
  REDUCED_MOTION_QUERY,
  calcDampedHarmonicOscillator,
  dampingRatio,
  springDuration,
  springOvershoot,
  springSettleTime,
  springToLinearCss,
  springTransition,
} = await loadSubject();

const presetKeys = ["control", "sheet", "overlay", "pop"];

test("damped oscillator starts at 0 and converges to 1 for every branch", () => {
  for (const key of presetKeys) {
    const { stiffness, damping, mass } = MOTION_PRESETS[key];
    assert.equal(calcDampedHarmonicOscillator(stiffness, damping, mass, 0), 0, `${key} at t=0`);
    assert.equal(calcDampedHarmonicOscillator(stiffness, damping, mass, -1), 0, `${key} at t<0`);
    const settled = calcDampedHarmonicOscillator(stiffness, damping, mass, 50);
    assert.ok(Math.abs(settled - 1) < 1e-6, `${key} settles: ${settled}`);
    assert.ok(Number.isFinite(settled), `${key} finite`);
  }
});

test("under-damped presets overshoot past 1, over-damped ones never do", () => {
  const underDamped = MOTION_PRESETS.pop;
  assert.ok(underDamped.zeta < 1);
  let peak = 0;
  for (let t = 0.005; t <= 2; t += 0.005) {
    peak = Math.max(peak, calcDampedHarmonicOscillator(underDamped.stiffness, underDamped.damping, underDamped.mass, t));
  }
  assert.ok(peak > 1, `pop should overshoot, peak=${peak}`);

  const overDamped = { stiffness: 220, damping: 60, mass: 1 };
  assert.ok(dampingRatio(overDamped) > 1);
  for (let t = 0.005; t <= 4; t += 0.005) {
    const value = calcDampedHarmonicOscillator(overDamped.stiffness, overDamped.damping, overDamped.mass, t);
    assert.ok(value <= 1 + 1e-12, `over-damped must not exceed 1, got ${value} at t=${t}`);
  }
});

test("critical damping branch matches the (1 - e^-ω₀t(1+ω₀t)) solution", () => {
  const stiffness = 400;
  const mass = 1;
  const criticalDamping = 2 * Math.sqrt(stiffness * mass);
  const omega0 = Math.sqrt(stiffness / mass);
  for (const t of [0.01, 0.05, 0.1, 0.5]) {
    const actual = calcDampedHarmonicOscillator(stiffness, criticalDamping, mass, t);
    const expected = 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
    assert.ok(Math.abs(actual - expected) < 1e-9, `t=${t}: ${actual} vs ${expected}`);
  }
});

test("MOTION_PRESETS exposes all four springs with derived damping ratios", () => {
  assert.deepEqual(Object.keys(MOTION_PRESETS).sort(), [...presetKeys].sort());
  for (const key of presetKeys) {
    const preset = MOTION_PRESETS[key];
    assert.equal(preset.kind, "spring");
    const expected = preset.damping / (2 * Math.sqrt(preset.stiffness * preset.mass));
    assert.ok(Math.abs(preset.zeta - expected) < 1e-9, `${key} zeta ${preset.zeta} vs ${expected}`);
  }
  // The documented physics targets, not hand-copied numbers.
  assert.ok(Math.abs(MOTION_PRESETS.control.zeta - 0.78) < 0.01);
  assert.ok(Math.abs(MOTION_PRESETS.sheet.zeta - 0.98) < 0.01);
  assert.ok(Math.abs(MOTION_PRESETS.overlay.zeta - 1.01) < 0.02);
  assert.ok(Math.abs(MOTION_PRESETS.pop.zeta - 0.70) < 0.02);
});

test("springToLinearCss emits a well-formed linear() easing", () => {
  for (const key of presetKeys) {
    const css = springToLinearCss(MOTION_PRESETS[key]);
    assert.ok(css.startsWith("linear("), `${key} starts with linear(: ${css}`);
    assert.ok(css.endsWith(")"), `${key} ends with ): ${css}`);
    const items = css.slice("linear(".length, -1).split(", ");
    assert.equal(items.length, 15, `${key} default sampling count`);
    assert.equal(items[0], "0", `${key} starts at 0`);
    assert.equal(items[items.length - 1], "1", `${key} ends at 1`);
    assert.doesNotMatch(css, /NaN|Infinity|undefined/);
    for (const item of items) assert.match(item, /^-?\d+(\.\d{1,4})?$/, `${key} item ${item}`);
  }
  const custom = springToLinearCss(MOTION_PRESETS.control, 9);
  assert.equal(custom.slice("linear(".length, -1).split(", ").length, 9);
});

test("overshoot follows zeta; duration does not follow from zeta", () => {
  // Overshoot is governed by zeta alone; total time is governed by omega0 and
  // zeta together. The two cannot be inferred from each other: `pop` has the
  // lowest zeta (biggest bounce) yet reaches the band first, because its
  // higher stiffness / lower mass raises omega0. Never re-add a
  // "pop settles later than control" assertion.
  //
  // Overshoot is measured as how far the curve climbs ABOVE 1; for zeta >= 1
  // there is nothing to measure (a curve that only approaches 1 from below
  // would otherwise look like a "peak" and make the ordering accidental).
  const overshoot = (preset) => Math.max(0, springOvershoot(preset, springSettleTime(preset)) - 1);
  const bounce = Object.fromEntries(presetKeys.map((key) => [key, overshoot(MOTION_PRESETS[key])]));
  assert.ok(bounce.pop > bounce.control, `pop ${bounce.pop} > control ${bounce.control}`);
  assert.ok(bounce.control > 1e-6, `control must visibly overshoot, got ${bounce.control}`);
  for (const key of ["sheet", "overlay"]) {
    assert.ok(MOTION_PRESETS[key].zeta >= 0.98, `${key} is at or over critical`);
    assert.ok(bounce[key] <= 1e-4, `${key} must not overshoot, got ${bounce[key]}`);
    assert.ok(
      springOvershoot(MOTION_PRESETS[key], springSettleTime(MOTION_PRESETS[key])) <= 1.0001,
      `${key} stays under 1.0001`,
    );
  }
});

test("springDuration (first entry) stays inside (0, 2] with the documented ordering", () => {
  const durations = {};
  for (const key of presetKeys) {
    const duration = springDuration(MOTION_PRESETS[key]);
    durations[key] = duration;
    assert.ok(duration > 0 && duration <= 2, `${key} duration ${duration}`);
  }
  // Low-stiffness presets genuinely take longer to arrive than a control.
  assert.ok(durations.sheet > durations.control, `sheet ${durations.sheet} > control ${durations.control}`);
  assert.ok(durations.overlay > durations.control, `overlay ${durations.overlay} > control ${durations.control}`);
});

test("springSettleTime is never earlier than springDuration", () => {
  for (const key of presetKeys) {
    const settle = springSettleTime(MOTION_PRESETS[key]);
    const first = springDuration(MOTION_PRESETS[key]);
    assert.ok(settle >= first, `${key}: settle ${settle} >= first entry ${first}`);
    assert.ok(settle > 0 && settle <= 2, `${key}: settle ${settle}`);
  }
});

test("linear() sampling keeps the bounce instead of truncating it", () => {
  const items = (preset) => springToLinearCss(preset).slice("linear(".length, -1).split(", ").map(Number);
  for (const key of ["control", "pop"]) {
    assert.ok(Math.max(...items(MOTION_PRESETS[key])) > 1, `${key} must retain an overshoot sample`);
  }
  assert.ok(Math.max(...items(MOTION_PRESETS.overlay)) <= 1.0001, "overlay has no overshoot to retain");
  assert.equal(items(MOTION_PRESETS.control).at(-1), 1);
});

test("springTransition yields a framer-shaped spring transition object", () => {
  assert.equal(typeof springTransition, "function");
  const transition = springTransition(MOTION_PRESETS.sheet);
  assert.deepEqual(Object.keys(transition).sort(), ["damping", "mass", "stiffness", "type"]);
  assert.equal(transition.type, "spring");
  assert.equal(transition.stiffness, MOTION_PRESETS.sheet.stiffness);
  assert.equal(transition.damping, MOTION_PRESETS.sheet.damping);
  assert.equal(transition.mass, MOTION_PRESETS.sheet.mass);
});

test("REDUCED_MOTION_QUERY is the exact media query string", () => {
  assert.equal(REDUCED_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
});
