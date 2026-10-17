import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * W3 overlay lock.
 *
 * The seven overlay surfaces are the second family that exists twice for real.
 * Unlike the primitives, they carry business logic — a keyboard model, a queue
 * restore flow, an abortable search — so the risk is not colour drift but a
 * silent behaviour fork between the pi component and its Claude twin. This test
 * pins the three things that can be checked without rendering:
 *
 *   1. every slot file exists and exports the agreed name;
 *   2. the Claude tree stays inside the token layer (no raw colours, no motion
 *      library — MotionProvider is `LazyMotion strict`);
 *   3. the accessibility contract and the reuse contract survive: five modal
 *      surfaces keep `role="dialog"` + `aria-modal`, and the palette imports
 *      the pi command builder instead of copying it.
 */

const dir = new URL("./overlay/", import.meta.url);
const source = (name) => readFileSync(new URL(name, dir), "utf8");

/** slot file → exported symbol. */
const SLOTS = {
  "ClaudeDialogShell.tsx": "ClaudeDialogShell",
  "ClaudeApprovalCard.tsx": "ClaudeApprovalCard",
  "ClaudePlanReview.tsx": "ClaudePlanReview",
  "ClaudeTrustDialog.tsx": "ClaudeTrustDialog",
  "ClaudeQueueRecovery.tsx": "ClaudeQueueRecovery",
  "ClaudePalette.tsx": "ClaudePalette",
  "ClaudeImageLightbox.tsx": "ClaudeImageLightbox",
};

/** Surfaces that are genuinely modal and must announce it. */
const MODAL_SLOTS = [
  "ClaudeDialogShell.tsx",
  "ClaudeApprovalCard.tsx",
  "ClaudePlanReview.tsx",
  "ClaudeTrustDialog.tsx",
  "ClaudeQueueRecovery.tsx",
];

test("all seven overlay slots ship and export the agreed name", () => {
  const files = readdirSync(dir).filter((name) => name.endsWith(".tsx")).sort();
  assert.deepEqual(files, Object.keys(SLOTS).sort(), "exactly the seven overlay components live here");

  for (const [file, symbol] of Object.entries(SLOTS)) {
    const text = source(file);
    assert.match(text, /^"use client";/, `${file} is a client component`);
    assert.match(
      text,
      new RegExp(`export function ${symbol}\\(`),
      `${file} exports ${symbol}`,
    );
    // Props are derived from the pi component through the slot contract, never
    // re-declared: a hand-written interface is how the two kits drift apart.
    assert.match(
      text,
      /SlotPropsMap\["[a-zA-Z]+"\]/,
      `${file} derives its props from SlotPropsMap`,
    );
  }
});

test("the Claude overlay tree stays inside the token layer", () => {
  for (const file of Object.keys(SLOTS)) {
    const text = source(file);
    assert.doesNotMatch(text, /rgba\(/, `${file} must not use rgba() literals`);
    assert.doesNotMatch(text, /\bmotion\./, `${file} must not use motion.* (LazyMotion strict)`);
    assert.doesNotMatch(text, /from\s+["']framer-motion["']/, `${file} must not import framer-motion`);
    const hex = text.match(/#[0-9a-fA-F]{3,6}\b/g);
    assert.equal(hex, null, `${file} must not use bare hex colours (${hex && hex.join(", ")})`);
    assert.doesNotMatch(text, /fontSize:\s*\d/, `${file} must not set an inline numeric fontSize`);
  }
});

test("every modal surface keeps role=dialog and aria-modal", () => {
  for (const file of MODAL_SLOTS) {
    const text = source(file);
    assert.match(text, /"dialog"/, `${file} still names the dialog role`);
    assert.match(text, /aria-modal/, `${file} still declares aria-modal`);
    assert.match(text, /aria-label|aria-labelledby/, `${file} still carries an accessible name`);
  }
  // The lightbox deliberately stays a native <dialog>: showModal() gives it the
  // top layer and Escape handling, which a div-based role would have to fake.
  assert.match(source("ClaudeImageLightbox.tsx"), /<dialog/, "the lightbox keeps the native dialog element");
});

test("the palette reuses the pi command builder instead of copying it", () => {
  const text = source("ClaudePalette.tsx");
  assert.match(
    text,
    /import\s*{[^}]*buildPaletteCommands[^}]*}\s*from\s*["']@\/components\/CommandPalette["']/,
    "ClaudePalette imports buildPaletteCommands from the pi module",
  );
  assert.match(text, /export { buildPaletteCommands, PaletteHint }/, "and re-exports the reused helpers");
  // A second definition of the command set is exactly the drift this guards.
  assert.doesNotMatch(text, /export function buildPaletteCommands/, "the command set is never duplicated");
  assert.doesNotMatch(text, /section: "suggested"/, "the command list is never inlined here");
});

test("the focus trap is a real shared hook, wired by the modal surfaces", () => {
  const hookPath = fileURLToPath(new URL("../../hooks/useFocusTrap.ts", import.meta.url));
  assert.ok(existsSync(hookPath), "hooks/useFocusTrap.ts exists");
  const hook = readFileSync(hookPath, "utf8");
  assert.match(hook, /export function useFocusTrap\(ref: RefObject<HTMLElement \| null>, active: boolean\)/);
  assert.match(hook, /data-settings-child-dialog/, "a nested dialog takes Tab/Escape before the outer one");
  assert.match(hook, /previous\.focus/, "focus returns to the opener on close");

  for (const file of ["ClaudeDialogShell.tsx", "ClaudeApprovalCard.tsx", "ClaudeTrustDialog.tsx", "ClaudeQueueRecovery.tsx"]) {
    assert.match(source(file), /useFocusTrap\(/, `${file} installs the trap`);
  }
});

test("no new !important and no raw colours in the Claude CSS layer", () => {
  const css = readFileSync(new URL("../../app/settings-claude.css", import.meta.url), "utf8");
  // `!important` may only be MENTIONED in the prose that explains why there is
  // none; a declaration using it would be a regression. Comments are stripped
  // first, since a block comment's continuation lines do not start with `*`.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const codeDeclarations = code.split("\n").filter((line) => line.includes("!important"));
  assert.deepEqual(codeDeclarations, [], "no declaration uses !important");
  const hex = css.match(/#[0-9a-fA-F]{3,6}\b/g);
  assert.equal(hex, null, `settings-claude.css must not use bare hex colours (${hex && hex.join(", ")})`);
  assert.doesNotMatch(css, /rgba\(/, "settings-claude.css must not use rgba() literals");
  assert.match(css, /\.cds-overlay \.is-modal,|\n\.cds-overlay\.is-modal \{/, "the modal scrim is styled here");
});
