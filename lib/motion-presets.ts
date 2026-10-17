/**
 * Motion presets — pure data + pure math, deliberately free of any
 * `framer-motion` import so node:test can load this module through jiti.
 *
 * The same numbers drive both surfaces: framer's spring transition
 * (`springTransition`) and, for pure-CSS consumers, a `linear()` easing
 * sampled from the identical physical response (`springToLinearCss`).
 */

export interface SpringParameters {
  stiffness: number;
  damping: number;
  mass: number;
}

export type MotionPresetKey = "control" | "sheet" | "overlay" | "pop";

export interface MotionPreset extends SpringParameters {
  kind: "spring";
  /** Nominal damping ratio, derived — never hand-written. */
  zeta: number;
}

/**
 * Normalized displacement (0→1) of a second-order damped harmonic oscillator.
 *
 *   ζ = c / (2·√(k·m)),  ω₀ = √(k/m),  ω_d = ω₀·√(1-ζ²)
 *
 * Three closed-form branches: under-damped (ζ<1), critical (ζ≈1) and
 * over-damped (ζ>1). Boundaries: t<=0 → 0, t→∞ → 1, never NaN/Infinity.
 */
export function calcDampedHarmonicOscillator(
  k: number,
  c: number,
  m: number,
  t: number,
): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (!(k > 0) || !(m > 0) || !(c >= 0)) return 1;
  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (!Number.isFinite(omega0) || !Number.isFinite(zeta)) return 1;

  if (Math.abs(zeta - 1) < 1e-4) {
    return clampUnit(1 - Math.exp(-omega0 * t) * (1 + omega0 * t));
  }

  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
    const decay = Math.exp(-zeta * omega0 * t);
    const envelope =
      Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t);
    return clampUnit(1 - decay * envelope);
  }

  const rootTerm = Math.sqrt(zeta * zeta - 1);
  const s1 = -omega0 * (zeta - rootTerm);
  const s2 = -omega0 * (zeta + rootTerm);
  const denominator = s2 - s1;
  if (!Number.isFinite(denominator) || denominator === 0) return 1;
  return clampUnit(1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / denominator);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return value;
  return value;
}

export function dampingRatio(preset: SpringParameters): number {
  const denominator = 2 * Math.sqrt(preset.stiffness * preset.mass);
  if (!(denominator > 0)) return 0;
  return preset.damping / denominator;
}

const SPEED_SPECS: ReadonlyArray<{ key: MotionPresetKey } & SpringParameters> = [
  // High-frequency micro-spring for buttons and switches (ζ ≈ 0.78).
  { key: "control", stiffness: 420, damping: 32, mass: 1 },
  // Side sheet: nearly critical, effectively zero overshoot (ζ ≈ 0.98).
  { key: "sheet", stiffness: 300, damping: 34, mass: 1 },
  // Scrim/backdrop: at or just over critical so it never bounces (ζ ≈ 1.01).
  { key: "overlay", stiffness: 220, damping: 30, mass: 1 },
  // Popovers: visibly bouncy by design (ζ ≈ 0.70).
  { key: "pop", stiffness: 380, damping: 26, mass: 0.9 },
];

export const MOTION_PRESETS = Object.fromEntries(
  SPEED_SPECS.map(({ key, stiffness, damping, mass }) => {
    const parameters: SpringParameters = { stiffness, damping, mass };
    const preset: MotionPreset = { kind: "spring", ...parameters, zeta: dampingRatio(parameters) };
    return [key, preset];
  }),
) as Record<MotionPresetKey, MotionPreset>;

/**
 * Framer-motion `Transition` shape, expressed structurally so this module
 * stays framework-free. `type` is narrowed with a const assertion instead of
 * importing framer's types.
 */
export interface SpringTransition {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

export function springTransition(preset: MotionPreset): SpringTransition {
  return {
    type: "spring",
    stiffness: preset.stiffness,
    damping: preset.damping,
    mass: preset.mass,
  };
}

const SETTLE_STEP = 0.005;
const SETTLE_LIMIT = 2;

/**
 * Seconds until the spring **first** enters 1 ± 0.01 (step 0.005, cap 2 s).
 *
 * This is "how long until it looks arrived", which is the right duration for
 * an enter transition. It is NOT the settling time: for an under-damped
 * spring the first entry happens *before* the overshoot, so `pop` reports
 * 0.160 s while `control` reports 0.185 s — `pop` reaches the band sooner
 * simply because its higher ω₀ (stiffness/mass) dominates its lower ζ.
 * Never derive ordering from ζ alone: overshoot is governed by ζ, while
 * timing is governed by ω₀ and ζ together.
 *
 * Sampling a CSS easing with this value would truncate the overshoot; use
 * `springSettleTime` for that instead.
 */
export function springDuration(preset: MotionPreset): number {
  for (let t = SETTLE_STEP; t <= SETTLE_LIMIT + 1e-9; t += SETTLE_STEP) {
    const value = calcDampedHarmonicOscillator(
      preset.stiffness,
      preset.damping,
      preset.mass,
      t,
    );
    if (value >= 0.99 && value <= 1.01) return round(t, 3);
  }
  return SETTLE_LIMIT;
}

/**
 * Seconds until the spring leaves 1 ± 0.01 for the last time (step 0.005,
 * cap 2 s) — the moment the curve has genuinely converged. This is the span a
 * `linear()` easing must be sampled over, otherwise the bounce is cut off
 * before it happens. `control` 0.320 s, `pop` 0.325 s, `sheet` 0.370 s,
 * `overlay` 0.460 s: a small band makes the two under-damped presets settle
 * almost together even though `pop` overshoots five times as far.
 */
export function springSettleTime(preset: MotionPreset): number {
  let lastOutside = 0;
  for (let t = SETTLE_STEP; t <= SETTLE_LIMIT + 1e-9; t += SETTLE_STEP) {
    const value = calcDampedHarmonicOscillator(
      preset.stiffness,
      preset.damping,
      preset.mass,
      t,
    );
    if (value < 0.99 || value > 1.01) lastOutside = t;
  }
  if (lastOutside === 0) return round(SETTLE_STEP, 3);
  return round(Math.min(SETTLE_LIMIT, lastOutside + SETTLE_STEP), 3);
}

/** Peak displacement over a window — the overshoot a preset is chosen for. */
export function springOvershoot(preset: MotionPreset, until: number): number {
  const step = 0.0005;
  let peak = 0;
  for (let t = step; t <= until + 1e-9; t += step) {
    const value = calcDampedHarmonicOscillator(
      preset.stiffness,
      preset.damping,
      preset.mass,
      t,
    );
    if (value > peak) peak = value;
  }
  return peak;
}

/**
 * Sample the spring response into a CSS `linear()` easing, so a pure-CSS
 * surface can reuse the exact same physics as the framer transition.
 *
 * Samples span `springSettleTime` (not `springDuration`): the final point is
 * written as `1`, which by then is the real converged value rather than a
 * forced endpoint, and every sample in between keeps the preset's overshoot.
 */
export function springToLinearCss(preset: MotionPreset, steps = 15): string {
  const count = Number.isFinite(steps) ? Math.max(2, Math.floor(steps)) : 15;
  const duration = springSettleTime(preset);
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      points.push("1");
      break;
    }
    const t = (duration * index) / (count - 1);
    const value = index === 0 ? 0 : calcDampedHarmonicOscillator(preset.stiffness, preset.damping, preset.mass, t);
    points.push(String(round(value, 4)));
  }
  return `linear(${points.join(", ")})`;
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return digits === 0 ? 0 : Number((0).toFixed(digits));
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)" as const;
