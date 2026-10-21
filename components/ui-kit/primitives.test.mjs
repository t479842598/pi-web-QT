import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * W1 primitive lock.
 *
 * The five atoms are the first surfaces that exist twice for real: a pi adapter
 * that must be pixel-identical to today's markup, and a CDS implementation that
 * must stay inside the token layer. This test pins the three things a later
 * wave could quietly break — the registry binding, the pi adapter debt, and the
 * colour discipline of the Claude tree.
 */

const REGISTRY_SOURCE = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");

const PRIMITIVE_SLOTS = ["button", "segmented", "toggle", "status", "field"];

function entry(slot) {
  const line = REGISTRY_SOURCE.split("\n").find((row) => row.startsWith(`  ${slot}: { pi:`));
  assert.ok(line, `the registry declares ${slot}`);
  return line;
}

test("every primitive is bound in both columns", () => {
  for (const slot of PRIMITIVE_SLOTS) {
    const line = entry(slot);
    const [, pi, claude] = line.match(/^  [a-zA-Z]+: \{ pi: ([^,}]+), claude: ([^,}]+) \},$/) ?? [];
    assert.ok(pi, `${slot} has a pi implementation: ${line.trim()}`);
    assert.ok(claude, `${slot} has a claude implementation: ${line.trim()}`);
    assert.notEqual(pi.trim(), "null", `${slot}.pi is not null`);
    assert.notEqual(claude.trim(), "null", `${slot}.claude is not null`);
  }
});

test("the pi adapter debt is paid off", () => {
  const start = REGISTRY_SOURCE.indexOf("export const PI_PENDING");
  const end = REGISTRY_SOURCE.indexOf("export function slotComponent");
  assert.ok(start > 0 && end > start, "PI_PENDING sits between the registry and slotComponent");
  const debt = [...REGISTRY_SOURCE.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  // Every slot now has a pi side — including `sessionRow`, which the sidebar
  // used to render inline and now has a real adapter for. An entry here would
  // mean the pi kit has a hole, so the expected value is empty.
  assert.deepEqual(debt, []);
});

test("the Claude primitives stay inside the token layer", () => {
  // vendor/ is exempt by design: its NOTICE records what came from upstream and
  // why nothing was copied verbatim. Only shipped primitives are scanned.
  const dir = new URL("../claude/primitives/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".tsx"));
  assert.ok(files.length >= 5, `five primitives shipped, found ${files.length}`);

  for (const file of files) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /rgba\(/, `${file} must not use rgba() literals`);
    assert.doesNotMatch(source, /motion\./, `${file} must not use motion.* (LazyMotion strict)`);
    assert.doesNotMatch(source, /from\s+["']framer-motion["']/, `${file} must not import framer-motion`);
    const hex = source.match(/#[0-9a-fA-F]{3,6}\b/g);
    assert.equal(hex, null, `${file} must not use bare hex colours (${hex && hex.join(", ")})`);
    assert.doesNotMatch(source, /fontSize:\s*\d/, `${file} must use text-* utilities, not inline numeric fontSize`);
  }
});

test("ui-kit-claude.css masks motion only, and only in the reduced-motion block", () => {
  const css = readFileSync(new URL("../../app/ui-kit-claude.css", import.meta.url), "utf8");
  const hits = [...css.matchAll(/!important/g)].map((m) => m.index ?? 0);
  // The shipped gate carries three declarations today (animation-duration,
  // animation-iteration-count, transition-duration); a fourth —
  // animation-delay — is the only other one that belongs there. The lock is
  // drift detection: the gate may grow to four, never to a scattering.
  assert.ok(
    hits.length >= 3 && hits.length <= 4,
    `the reduced-motion gate carries 3-4 !important declarations, found ${hits.length}`,
  );
  const gate = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(gate > 0, "the reduced-motion gate exists");
  for (const index of hits) {
    assert.ok(index > gate, "!important is only allowed inside the reduced-motion block");
  }
});