import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const uiKit = await jiti.import("@/lib/ui-kit.ts");

/**
 * Registry coverage lock.
 *
 * A slot is "ready" when the registry carries an implementation for a kit.
 * Everything not ready must be declared in CLAUDE_PENDING with the wave that
 * owes it, so the switch can never present a blank surface without a test
 * failing first.
 */

const REGISTRY_SOURCE = await readFile(new URL("./registry.ts", import.meta.url), "utf8");

const declaredSlots = [...REGISTRY_SOURCE.matchAll(/^  ([a-zA-Z]+): \{ pi:/gm)].map((m) => m[1]);
const claudeReady = [...REGISTRY_SOURCE.matchAll(/^  ([a-zA-Z]+): \{ pi: [^}]*?claude: (?!null)/gm)].map((m) => m[1]);
const piReady = [...REGISTRY_SOURCE.matchAll(/^  ([a-zA-Z]+): \{ pi: (?!null)/gm)].map((m) => m[1]);
const pendingSource = REGISTRY_SOURCE.slice(REGISTRY_SOURCE.indexOf("CLAUDE_PENDING"));
const pendingSlots = [...pendingSource.matchAll(/^  ([a-zA-Z]+): "W/gm)].map((m) => m[1]);
const piPendingSource = REGISTRY_SOURCE.slice(
  REGISTRY_SOURCE.indexOf("export const PI_PENDING"),
  REGISTRY_SOURCE.indexOf("export function slotComponent"),
);
const piPending = [...piPendingSource.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);

test("the registry declares every slot exactly once", () => {
  assert.deepEqual(declaredSlots.slice().sort(), [...uiKit.SLOT_IDS].sort());
  assert.equal(new Set(declaredSlots).size, declaredSlots.length);
});

test("every slot has a pi implementation or a declared pi adapter debt", () => {
  const missing = uiKit.SLOT_IDS.filter((slot) => !piReady.includes(slot) && !piPending.includes(slot));
  assert.deepEqual(missing, [], "no slot may be silently unimplemented on the pi side");
  const both = piReady.filter((slot) => piPending.includes(slot));
  assert.deepEqual(both, [], "a slot is either bound to a component or pending, never both");
  // Every slot is bound on the pi side; anything listed here would be a hole in
  // the pi kit, which is the one thing this refactor must not introduce.
  assert.deepEqual(piPending.slice().sort(), []);
});

test("every unimplemented claude slot names the wave that owes it", () => {
  const missing = uiKit.SLOT_IDS.filter((slot) => !claudeReady.includes(slot) && !pendingSlots.includes(slot));
  assert.deepEqual(missing, [], "no claude slot may be missing without a wave tag");
  for (const slot of pendingSlots) {
    assert.ok(uiKit.SLOT_IDS.includes(slot), `${slot} is a real slot`);
  }
  for (const [, tag] of REGISTRY_SOURCE.matchAll(/^  [a-zA-Z]+: "(W[0-9])"/gm)) {
    assert.match(tag, /^W[0-9]$/, "pending tags are wave ids (W1..W5)");
  }
});

test("a slot is never both implemented and pending", () => {
  const overlap = claudeReady.filter((slot) => pendingSlots.includes(slot));
  assert.deepEqual(overlap, []);
});

test("both pending lists are empty and must stay empty", () => {
  // Wave-by-wave, a slot could be declared "not written yet" instead of bound.
  // Every slot is bound on both sides now, so the honest lock is the empty
  // list: a new entry here means a switch can present a blank surface, and the
  // settings panel no longer renders a pending badge to warn about it.
  assert.deepEqual(pendingSlots, [], "no claude slot may be left unimplemented");
  assert.deepEqual(piPending, [], "no pi slot may be left without an adapter");
  assert.equal(claudeReady.length, uiKit.SLOT_IDS.length, "every slot binds a claude side");
  assert.equal(piReady.length, uiKit.SLOT_IDS.length, "every slot binds a pi side");
  assert.equal(declaredSlots.length, 26, "26 switchable surfaces");
});

test("the pi column never points at a claude implementation", () => {
  // The pi column must stay bound to today's components. W1 made the file
  // import from both trees (the claude column is real now), so the rule is per
  // column: whatever `pi:` names may not be a Cds* component, and the pi
  // adapters themselves may not reach into the claude tree.
  const piRefs = [...REGISTRY_SOURCE.matchAll(/^  [a-zA-Z]+: \{ pi: ([^,}]+)/gm)].map((m) => m[1].trim());
  assert.ok(piRefs.length > 0, "the registry binds a pi component somewhere");
  for (const ref of piRefs) {
    assert.doesNotMatch(ref, /^Cds/, `${ref} is a claude implementation bound to the pi column`);
  }

  for (const file of ["Button", "Segmented", "Toggle", "Status", "Field"]) {
    const source = readFileSync(new URL(`./pi/${file}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /components\/claude/, `pi/${file}.tsx must not import the claude tree`);
  }
});