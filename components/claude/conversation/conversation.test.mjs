import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import test from "node:test";

/**
 * Conversation-layer lock.
 *
 * The transcript is the surface a reader spends all their time in, so the rules
 * here are stricter than elsewhere: no palette literals, no framer-motion (the
 * provider runs `LazyMotion strict`, which throws on `motion.*`), and the
 * loading strategy must stay a real choice — the pi list windows with
 * `@tanstack/react-virtual`, the Claude list keeps the window but adds the CDS
 * edge treatment. If someone later "simplifies" either one into the other, the
 * slot stops being a slot.
 */

const DIR = new URL("./", import.meta.url);
const files = readdirSync(DIR).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx")).sort();
const read = (name) => readFileSync(new URL(name, DIR), "utf8");

const EXPECTED = [
  "ClaudeCompactionSummary.tsx",
  "ClaudeMessageList.tsx",
  "ClaudeMessageShell.tsx",
  "ClaudeSubagentPanel.tsx",
  "ClaudeSubagentRow.tsx",
  "ClaudeThinking.tsx",
  "ClaudeToolCard.tsx",
];

test("all seven conversation slots ship", () => {
  assert.deepEqual(files, EXPECTED);
});

test("conversation components stay inside the token layer", () => {
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /rgba\(/, `${file}: no rgba() literals`);
    assert.doesNotMatch(source, /motion\./, `${file}: no motion.* (LazyMotion strict)`);
    assert.doesNotMatch(source, /from\s+["']framer-motion["']/, `${file}: no framer-motion import`);
    assert.doesNotMatch(source, /fontSize:\s*\d/, `${file}: font sizes come from tokens/utilities`);
    // Colors must resolve through a CSS variable; a bare hex is a palette fork.
    const hex = source.match(/#[0-9a-fA-F]{3,6}\b/g);
    assert.equal(hex, null, `${file}: no bare hex colours (${hex?.join(", ")})`);
  }
});

test("the loading strategy really differs from the pi list", () => {
  const claude = read("ClaudeMessageList.tsx");
  const pi = readFileSync(new URL("../../VirtualizedMessageList.tsx", import.meta.url), "utf8");

  // Both keep a window (a 5000-message session must not mount 5000 rows)…
  assert.match(claude, /useVirtualizer/);
  assert.match(pi, /useVirtualizer/);

  // …but the Claude list owns the CDS loading treatment the pi list has none of.
  assert.match(claude, /maskImage|mask-image/, "edge fade masks");
  assert.match(claude, /PIN_TOLERANCE_PX/, "explicit scroll-pin tolerance");
  assert.match(claude, /skeleton|ready/, "a first-paint skeleton pass");
  assert.doesNotMatch(pi, /maskImage/, "the pi list stays plain — that is the difference");
});

test("thinking stays locked open while streaming", () => {
  const thinking = read("ClaudeThinking.tsx");
  // The pi block refuses to collapse mid-stream; a collapsed box would hide the
  // token tail the reader is watching.
  assert.match(thinking, /lockRef|isStreaming/);
  assert.match(thinking, /disabled=\{isStreaming\}/);
  assert.match(thinking, /aria-expanded=/);
});

test("the subagent surfaces keep the pi data contract", () => {
  const row = read("ClaudeSubagentRow.tsx");
  const panel = read("ClaudeSubagentPanel.tsx");
  // Six status values, one colour source, and the same open callback.
  for (const status of ["running", "queued", "completed", "failed", "aborted"]) {
    assert.match(row, new RegExp(`"${status}"`), `subagent row knows ${status}`);
  }
  assert.match(row, /onOpenSubagent/);
  assert.match(panel, /role="listbox"/, "the board keeps the listbox contract");
  assert.match(panel, /role="option"/);
  assert.match(panel, /aria-selected=/);
  assert.match(panel, /runningSessionIds/, "liveness still comes from the live set");
});

test("tool cards delegate step bodies instead of re-implementing them", () => {
  const card = read("ClaudeToolCard.tsx");
  // Rendering tool output (ANSI, images, paired diffs) belongs to the shared
  // pipeline; the skin only draws the frame around it.
  assert.match(card, /renderStep/);
  assert.match(card, /ProcessContentBlock/);
  assert.doesNotMatch(card, /AnsiText|PairedDiffResult|SplitPatchView/, "no re-implementation of step rendering");
});
