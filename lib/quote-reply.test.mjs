import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { detectOptions, extractFilePaths, formatQuote, parseParagraph } = await jiti.import("./quote-reply.ts");

test("quote reply detects closed choices and formats a reply without sending", () => {
  assert.deepEqual(detectOptions("使用 A 还是 B？"), [
    { label: "A", value: "A" },
    { label: "B", value: "B" },
  ]);
  assert.equal(formatQuote("继续执行吗？", "是的"), "> 继续执行吗？\n是的");
  assert.deepEqual(parseParagraph("先保存吗？然后使用 A 还是 B？").map(({ options }) => options?.length ?? 0), [2, 2]);
});

test("quote reply exposes de-duplicated inline file candidates", () => {
  assert.deepEqual(extractFilePaths("请看 app/page.tsx 和 docs/readme.md；app/page.tsx"), [
    "app/page.tsx",
    "docs/readme.md",
  ]);
});
