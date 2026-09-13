import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isPlaceholderTitle, sessionDisplayTitle, NO_MESSAGES_PLACEHOLDER } = await jiti.import(
  "./session-display-title.ts",
);

test("placeholder detection covers the pi sentinel and its cosmetic variants", () => {
  assert.equal(isPlaceholderTitle(NO_MESSAGES_PLACEHOLDER), true);
  assert.equal(isPlaceholderTitle("(No Messages)"), true);
  assert.equal(isPlaceholderTitle("（no messages）"), true);
  assert.equal(isPlaceholderTitle("(no messages…"), true);
  assert.equal(isPlaceholderTitle("  (no messages)  "), true);
  assert.equal(isPlaceholderTitle(""), true);
  assert.equal(isPlaceholderTitle(null), true);
  assert.equal(isPlaceholderTitle(undefined), true);
  assert.equal(isPlaceholderTitle("\u200B(no messages)\uFEFF"), true);
});

test("placeholder detection keeps real titles", () => {
  assert.equal(isPlaceholderTitle("调研 CPAMP 上游变更"), false);
  assert.equal(isPlaceholderTitle("no messages about the bug"), false);
  assert.equal(isPlaceholderTitle("(no message)"), false);
});

test("sessionDisplayTitle prefers name, then firstMessage, then short id", () => {
  assert.equal(
    sessionDisplayTitle({ name: "Named", firstMessage: "Body", id: "abcdef1234567890" }),
    "Named",
  );
  assert.equal(
    sessionDisplayTitle({ firstMessage: "Body text", id: "abcdef1234567890" }),
    "Body text",
  );
  assert.equal(sessionDisplayTitle({ firstMessage: "", id: "abcdef1234567890" }), "abcdef123456");
});

test("sessionDisplayTitle never surfaces the placeholder", () => {
  assert.equal(sessionDisplayTitle({ firstMessage: "(no messages)", id: "abcdef1234567890" }), "abcdef123456");
  assert.equal(sessionDisplayTitle({ name: "(no messages)", firstMessage: "(no messages)", id: "abc" }), "abc");
});

test("sessionDisplayTitle strips mode-instruction-only first messages to the fallback", () => {
  const modeOnly = "<delivery-profile>\nPrioritize a verified result.\n</delivery-profile>";
  assert.equal(sessionDisplayTitle({ firstMessage: modeOnly, id: "abcdef1234567890" }), "abcdef123456");
  assert.equal(
    sessionDisplayTitle({ firstMessage: modeOnly, id: "abcdef1234567890" }, "cpa-manager-plus"),
    "abcdef123456",
  );
  // id 缺失（如 UsageConfig 的 report 行）时才落到 fallback。
  assert.equal(sessionDisplayTitle({ firstMessage: modeOnly }, "cpa-manager-plus"), "cpa-manager-plus");
});

test("sessionDisplayTitle keeps the user text that follows a mode block", () => {
  const mixed = "<delivery-profile>\npriorities\n</delivery-profile>\n\n之前更新了一下内容和版本，现在看看服务器上面日志";
  assert.equal(sessionDisplayTitle({ firstMessage: mixed }), "之前更新了一下内容和版本，现在看看服务器上面日志");
});

test("sessionDisplayTitle caps firstMessage at 50 chars and tolerates missing fields", () => {
  assert.equal(sessionDisplayTitle({ firstMessage: "x".repeat(80) }).length, 50);
  assert.equal(sessionDisplayTitle({}), "");
  assert.equal(sessionDisplayTitle({}, "fallback"), "fallback");
});
