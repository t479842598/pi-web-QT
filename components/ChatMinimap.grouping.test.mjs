import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const minimap = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("minimap deduplicates raw assistant messages that share one rendered process group", () => {
  assert.match(chat, /for \(let refIndex = item\.startRef; refIndex < nextStart; refIndex\+\+\)/);
  assert.match(minimap, /const seenItems = new Set<number>\(\)/);
  assert.match(minimap, /seenItems\.has\(itemIndex\)/);
  assert.match(minimap, /seenItems\.add\(itemIndex\)/);
});

// --- S6: keyboard reachability + the e2e attribute contract -----------------

test("S6: the minimap container is a focusable listbox", () => {
  assert.match(minimap, /role="listbox"/);
  assert.match(minimap, /tabIndex=\{0\}/);
  assert.match(minimap, /onKeyDown=\{handleKeyDown\}/);
  // The active marker is exposed through aria-activedescendant, so focus never
  // leaves the container and no marker needs to be a tab stop.
  assert.match(minimap, /aria-activedescendant=\{activeNode \? `\$\{containerId\}-node-\$\{activeNode\.index\}` : undefined\}/);
  assert.match(minimap, /const containerId = useId\(\);/);
  // Markers are options, never tab stops.
  assert.match(minimap, /role="option"/);
  assert.doesNotMatch(minimap, /data-minimap-node-index=\{node\.index\}[\s\S]{0,400}tabIndex/, "markers must not become tab stops");
});

test("S6: arrow keys walk the markers and Home/End jump to the ends", () => {
  const handler = minimap.match(/const handleKeyDown = useCallback\(\(event: React\.KeyboardEvent<HTMLDivElement>\) => \{[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(handler, "handleKeyDown must be a single memoized callback");
  const body = handler[0];
  for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End", "Enter", " "]) {
    assert.ok(body.includes(`"${key}"`) || body.includes(`'${key}'`), `handleKeyDown must bind ${key}`);
  }
  // Every bound key consumes the event, otherwise ArrowUp/Down scroll the page
  // as well as the transcript.
  assert.ok((body.match(/event\.preventDefault\(\)/g) ?? []).length >= 5, "keys must preventDefault");
  assert.match(body, /moveActiveNode\(current \+ 1, list\)/);
  assert.match(body, /moveActiveNode\(0, list\)/);
  assert.match(body, /moveActiveNode\(list\.length - 1, list\)/);
});

test("S6: keyboard selection scrolls the transcript to the active marker", () => {
  const reveal = minimap.match(/const revealNode = useCallback\(\(nodeIndex: number\) => \{[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(reveal, "revealNode must exist");
  // Same mapping the drag path uses, so keyboard and mouse land identically.
  assert.match(reveal[0], /scrollToMinimapRatio\(node\.topRatio - viewportRatio \/ 2\)/);
  assert.match(minimap, /scrollToMinimapRatio\(r - offset\)/);
});

test("S6: marker labels reuse catalog keys and add no hardcoded strings", () => {
  const describe = minimap.match(/const describeNode = \(node: DisplayNode\): string => \{[\s\S]*?\n  \};/);
  assert.ok(describe, "describeNode must exist");
  for (const key of ["desktop.transcriptRoleUser", "desktop.transcriptRoleAssistant", "desktop.noMessage", "chatMinimap.toolCalls"]) {
    assert.ok(describe[0].includes(`"${key}"`), `describeNode must reuse ${key}`);
  }
  // The container name is an existing key too.
  assert.match(minimap, /aria-label=\{t\("session\.messages"\)\}/);
  // No CJK literal and no English sentence is hardcoded into the new markup.
  assert.doesNotMatch(minimap.slice(minimap.indexOf("const describeNode"), minimap.indexOf("const describeNode") + 1200), /[\u4e00-\u9fff]/);
});

test("S6: the e2e data-minimap-* contract keeps its attribute names", () => {
  // e2e/run.mjs selects "[data-minimap-node-index='0']" and hovers it; both
  // run.mjs and e2e/extension-dialog.mjs wait on [data-minimap-preview-box].
  // Renaming either breaks the suite, so the names are pinned here.
  assert.match(minimap, /data-minimap-node-index=\{node\.index\}/);
  assert.match(minimap, /data-minimap-preview-box=""/);
  assert.doesNotMatch(minimap, /data-minimap-(node|preview|marker)-[a-z-]*(index|box)=[^\n]*\/\* renamed/);
  // The preview stays a single tooltip and is hidden from assistive tech, so
  // the listbox only ever contains options.
  assert.equal((minimap.match(/data-minimap-preview-box=""/g) ?? []).length, 1);
  assert.match(minimap, /data-minimap-preview-box=""\s*\/\/[^]*aria-hidden="true"/);
});
