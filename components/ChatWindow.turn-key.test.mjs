import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// The chat list keys ProcessGroup/MessageView rows by item key. If a row's key
// changes between two renders, React remounts it and every piece of local UI
// state (expanded tool details, active process tab) is lost. These tests pin
// the keying rules that keep the LIVE tail stable while tokens stream.

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("live-tail keys are scoped to the turn's user index", () => {
  assert.match(source, /const liveProcessItemKey = \(userIdx: number\) => `live-process-u\$\{userIdx\}`/);
  assert.match(source, /const liveAnswerItemKey = \(userIdx: number\) => `live-answer-u\$\{userIdx\}`/);
});

test("historical keys stay entryId-based so prepending an older page is safe", () => {
  assert.match(source, /const processItemKey = \(userIdx: number\) => `process-\$\{messageItemKey\(userIdx, "user"\)\}`/);
  assert.match(source, /const answerItemKey = \(userIdx: number\) => `answer-\$\{messageItemKey\(userIdx, "user"\)\}`/);
});

test("the live branch uses the live keys, not the entryId-based ones", () => {
  const live = source.slice(source.indexOf("const isLiveTail"), source.indexOf("if (finalAssistantIdx === -1"));
  // Process groups may be split into per-segment keys once subagent rows are
  // hoisted out, so accept the segment form as long as it is rooted in the
  // turn's user index (live) and never the entryId-based key.
  assert.match(live, /liveProcess(Item|Segment)Key\(userIdx/);
  assert.match(live, /liveAnswerItemKey\(userIdx\)/);
  assert.doesNotMatch(live, /answerItemKey\(userIdx\)/);
  assert.doesNotMatch(live, /processItemKey\(userIdx\)/);
});

test("keys no longer embed values that change mid-run", () => {
  // Regression: the process key embedded the first process-message index, which
  // changed as soon as a process block appeared; the answer key switched from a
  // streaming form to an entryId form on every assistant message_end (once per
  // tool step), remounting the group and dropping the user's expanded details.
  assert.doesNotMatch(source, /live-process-\$\{userIdx\}-\$\{liveProcessIndices\[0\]/);
  assert.doesNotMatch(source, /live-answer-streaming-\$\{userIdx\}/);
  assert.doesNotMatch(source, /`process-\$\{userIdx >= 0 \? messageItemKey/);
});

