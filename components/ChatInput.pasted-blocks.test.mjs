import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-structure assertions for the folded-paste send paths in ChatInput
// (component internals cannot be executed outside React; repo convention is
// source assertions, see hooks/useAgentSession.test.mjs).
const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("queued sends expand folded paste placeholders like direct sends", () => {
  const queuedStart = source.indexOf("const sendQueued = useCallback");
  const queuedEnd = source.indexOf("const getNextSlashIndex", queuedStart);
  const queuedSource = source.slice(queuedStart, queuedEnd);

  assert.match(queuedSource, /expandPastedLabels\(value, pastedBlocks\)/, "queue path must re-expand pasted blocks");
  assert.match(queuedSource, /const msg = expanded\.trim\(\)/);
  // Regression guard for the 0.14.2 leak: the queue path must not read the raw
  // un-expanded value directly anymore.
  assert.doesNotMatch(queuedSource, /const msg = value\.trim\(\)/);
});

test("folded pastes survive draft save, session switch, and remount", () => {
  const saveStart = source.indexOf("if (!draftKey || draftKeyRef.current !== draftKey) return;");
  const saveEnd = source.indexOf("useEffect(() => {", saveStart);
  const saveSource = source.slice(saveStart, saveEnd);
  assert.match(saveSource, /pastedBlocks: pastedBlocks\.length \? pastedBlocks : undefined/);

  const rekeyStart = source.indexOf("const previousDraftKey = draftKeyRef.current;");
  const rekeyEnd = source.indexOf("}, [draftKey]);", rekeyStart);
  const rekeySource = source.slice(rekeyStart, rekeyEnd);
  assert.match(rekeySource, /pastedBlocks: pastedBlocksRef\.current\.length \? pastedBlocksRef\.current : undefined/);
  assert.match(rekeySource, /setPastedBlocks\(draft\?\.pastedBlocks \?\? \[\]\)/);

  // Initial state restores blocks from the draft on first mount.
  assert.match(source, /getDraft\(draftKey\)\?\.pastedBlocks \?\? \[\]/);
});

test("send paths refuse messages that still contain a lost paste placeholder", () => {
  const handleSendStart = source.indexOf("const handleSend = useCallback");
  const handleSendEnd = source.indexOf("const slashQuery = value.startsWith", handleSendStart);
  const handleSendSource = source.slice(handleSendStart, handleSendEnd);
  assert.match(handleSendSource, /findLeftoverPasteLabel\(finalValue\)/);
  assert.match(handleSendSource, /showPasteGuardWarning\(\);\s*\n\s*return;/);

  const guardStart = source.indexOf("const findLeftoverPasteLabel = useCallback");
  const guardEnd = source.indexOf("const showPasteGuardWarning", guardStart);
  const guardSource = source.slice(guardStart, guardEnd);
  // Known labels and label-shaped text inside a block's raw content are not
  // leftovers — only an unmatched label blocks the send.
  assert.match(guardSource, /block\.label === label/);
  assert.match(guardSource, /block\.text\.includes\(label\)/);
});
