/**
 * Cross-platform normaliser contract.
 *
 * A normaliser that silently matches nothing still passes on the machine the
 * baseline was captured on: capture and compare both leave the platform
 * spelling intact, so the drift only ever shows up on the other OS, in CI, one
 * job later. This pins the behaviour directly instead.
 *
 * The product renders exactly two spellings of one shortcut
 * (lib/command-palette-match.ts:115 returns `⌘K` on macOS and `Ctrl+K`
 * elsewhere), so those are the strings that must collapse. Stacked modifiers
 * are out of scope: nothing in the UI renders one, and folding a single
 * modifier pair is what keeps `<SHORTCUT>` from swallowing a bare key.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { normalizeTextInPage } = await import("../e2e/kit-parity.mjs");

const norm = (value) => normalizeTextInPage(value, "");

test("both platform spellings of the palette shortcut fold to one placeholder", () => {
  assert.equal(norm("⌘K"), norm("Ctrl+K"));
  assert.equal(norm("⌘K"), "<SHORTCUT>");
  assert.equal(norm("Cmd+K"), "<SHORTCUT>");
  assert.equal(norm("Meta+K"), "<SHORTCUT>");
  assert.equal(norm("Alt+K"), "<SHORTCUT>");
});

test("a shortcut embedded in markup folds too", () => {
  const linux = `<button>Search<span class="palette-kbd">Ctrl+K</span></button>`;
  const mac = `<button>Search<span class="palette-kbd">⌘K</span></button>`;
  assert.equal(norm(linux), norm(mac));
  assert.ok(norm(linux).includes("<SHORTCUT>"), norm(linux));
});

test("ordinary text is untouched", () => {
  assert.equal(norm("plain text"), "plain text");
  assert.equal(norm("K"), "K");
  assert.equal(norm("C++"), "C++");
  assert.equal(norm("Ctrl"), "Ctrl");
});

test("an already-folded value stays folded", () => {
  assert.equal(norm("<SHORTCUT>"), "<SHORTCUT>");
});
