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
