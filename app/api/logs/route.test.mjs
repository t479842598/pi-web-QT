import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("logs GET does not turn an omitted statusCode into status 0", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /const rawCodeText = params\.get\("statusCode"\)/);
  assert.match(source, /const rawCode = rawCodeText \? Number\(rawCodeText\) : Number\.NaN/);
});

test("logs POST rejects malformed JSON before recording", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const postSource = source.slice(source.indexOf("export async function POST"), source.indexOf("export async function DELETE"));
  assert.match(postSource, /try \{/);
  assert.match(postSource, /await req\.json\(\)/);
  assert.match(postSource, /status: 400/);
});
