import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { stripModeInstructionBlocks, buildModeSystemPrompt } = await createJiti(import.meta.url).import(new URL("./modes.ts", import.meta.url).href);

test("strips economy profile block, keeps user text", () => {
  const block = buildModeSystemPrompt({ collaborationMode: "normal", tokenMode: "economy" });
  const out = stripModeInstructionBlocks(`${block}\n\n我的消息`);
  assert.equal(out, "我的消息");
});

test("strips delivery profile block", () => {
  const block = buildModeSystemPrompt({ collaborationMode: "normal", tokenMode: "delivery" });
  const out = stripModeInstructionBlocks(`${block}\n\n执行计划`);
  assert.equal(out, "执行计划");
});

test("strips stacked plan + delivery blocks", () => {
  const block = buildModeSystemPrompt({ collaborationMode: "plan", tokenMode: "delivery" });
  const out = stripModeInstructionBlocks(`${block}\n\n分析一下`);
  assert.equal(out, "分析一下");
});

test("strips goal block with Goal: trailer", () => {
  const block = buildModeSystemPrompt({ collaborationMode: "goal", tokenMode: "full", goalText: "写一个爬虫" });
  const out = stripModeInstructionBlocks(`${block}\n\n开始`);
  assert.equal(out, "开始");
});

test("strips legacy PLAN MODE block", () => {
  const out = stripModeInstructionBlocks("You are in PLAN MODE. Work as a read-only planning assistant.\n- Analyze\n- Plan\n\n设计接口");
  assert.equal(out, "设计接口");
});

test("returns empty for a prompt that is only a block", () => {
  const block = buildModeSystemPrompt({ collaborationMode: "plan", tokenMode: "delivery" });
  assert.equal(stripModeInstructionBlocks(block), "");
});

test("leaves ordinary text untouched", () => {
  assert.equal(stripModeInstructionBlocks("普通的用户消息"), "普通的用户消息");
  assert.equal(stripModeInstructionBlocks(""), "");
});
