import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { extractPlanText } = await createJiti(import.meta.url).import("./message-display.ts");

test("extracts plan from plan_mode_complete tool result", () => {
  const messages = [
    { role: "assistant", content: [{ type: "thinking", thinking: "let me plan" }] },
    { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "**Proposed Plan**\n\n1. Add a version badge\n2. Wire it to package.json" }] },
  ];
  assert.equal(extractPlanText(messages), "1. Add a version badge\n2. Wire it to package.json");
});

test("prefers the last assistant text block when present", () => {
  const messages = [
    { role: "assistant", content: [{ type: "text", text: "Plan: step one" }] },
    { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "**Proposed Plan**\n\nfallback plan" }] },
  ];
  assert.equal(extractPlanText(messages), "Plan: step one");
});

test("returns null when no plan text exists", () => {
  assert.equal(extractPlanText([]), null);
  assert.equal(extractPlanText([{ role: "user", content: "hi" }]), null);
  assert.equal(extractPlanText([{ role: "assistant", content: [{ type: "thinking", thinking: "..." }] }]), null);
});

test("handles string-content tool results", () => {
  const messages = [
    { role: "toolResult", content: "**Proposed Plan**\n\nsingle string plan" },
  ];
  assert.equal(extractPlanText(messages), "single string plan");
});
