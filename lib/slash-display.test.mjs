import assert from "node:assert/strict";
import test from "node:test";

// 斜杠命令展开消息的展示还原工具单测（与 lib/slash-display.ts 配套）
const {
  parseSlashCommandName,
  skillExpansionToCommand,
  resolveSlashDisplayText,
  userMessagePlainText,
  SlashOriginalTracker,
} = await import("./slash-display.ts");

// --- parseSlashCommandName ---

test("parseSlashCommandName: 解析带参数的命令", () => {
  assert.equal(parseSlashCommandName("/hello 123132"), "hello");
  assert.equal(parseSlashCommandName("/skill:review src/main.go"), "skill:review");
});

test("parseSlashCommandName: 无参数命令与边界", () => {
  assert.equal(parseSlashCommandName("/nospace"), "nospace");
  assert.equal(parseSlashCommandName("/"), null);
  assert.equal(parseSlashCommandName("  /hello  x  "), "hello");
});

test("parseSlashCommandName: 非命令文本返回 null", () => {
  assert.equal(parseSlashCommandName("hello world"), null);
  assert.equal(parseSlashCommandName(""), null);
  assert.equal(parseSlashCommandName("!ls -la"), null);
});

// --- skillExpansionToCommand ---

const SKILL_WITH_ARGS = `<skill name="hello" location="/path/to/hello.md">
References are relative to /path/to.

Hello world skill body

</skill>

123132`;

const SKILL_NO_ARGS = `<skill name="hello" location="/path/to/hello.md">
References are relative to /path/to.

Hello world skill body

</skill>`;

test("skillExpansionToCommand: 带参数还原为 /skill:name args", () => {
  assert.equal(skillExpansionToCommand(SKILL_WITH_ARGS), "/skill:hello 123132");
});

test("skillExpansionToCommand: 无参数还原为 /skill:name", () => {
  assert.equal(skillExpansionToCommand(SKILL_NO_ARGS), "/skill:hello");
});

test("skillExpansionToCommand: 多行参数 trim 后保留", () => {
  const multiLine = `<skill name="x" location="/l.md">
References are relative to /l.

body

</skill>

line1
line2`;
  assert.equal(skillExpansionToCommand(multiLine), "/skill:x line1\nline2");
});

test("skillExpansionToCommand: 非 skill 展开文本返回 null", () => {
  assert.equal(skillExpansionToCommand("普通文本"), null);
  assert.equal(skillExpansionToCommand("<skill>没有属性</skill>"), null);
  assert.equal(skillExpansionToCommand(""), null);
});

// --- resolveSlashDisplayText ---

test("resolveSlashDisplayText: 未展开的命令原样返回", () => {
  assert.equal(resolveSlashDisplayText("/hello 123132"), "/hello 123132");
  assert.equal(resolveSlashDisplayText("/compact"), "/compact");
});

test("resolveSlashDisplayText: skill 展开还原为命令", () => {
  assert.equal(resolveSlashDisplayText(SKILL_WITH_ARGS), "/skill:hello 123132");
});

test("resolveSlashDisplayText: 普通文本返回 null（保持全文）", () => {
  assert.equal(resolveSlashDisplayText("hello world"), null);
  assert.equal(resolveSlashDisplayText(""), null);
  assert.equal(resolveSlashDisplayText("   "), null);
});

// --- userMessagePlainText ---

test("userMessagePlainText: string 形式原样返回", () => {
  assert.equal(userMessagePlainText("/hello 1"), "/hello 1");
});

test("userMessagePlainText: blocks 形式拼接文本块，忽略非文本块", () => {
  assert.equal(
    userMessagePlainText([
      { type: "text", text: "第一行" },
      { type: "image" },
      { type: "text", text: "第二行" },
    ]),
    "第一行\n第二行",
  );
});

test("userMessagePlainText: 空数组返回空串", () => {
  assert.equal(userMessagePlainText([]), "");
});

// --- SlashOriginalTracker ---

test("SlashOriginalTracker: FIFO 顺序注入", () => {
  const tracker = new SlashOriginalTracker();
  tracker.push("/skill:a 1");
  tracker.push("/template-b hello");
  // 展开文本与原文不同，注入原文
  assert.equal(tracker.consumeFor("<skill name=\"a\" location=\"/a.md\">\n</skill>\n\n1"), "/skill:a 1");
  assert.equal(tracker.consumeFor("模板 B 的展开正文 hello"), "/template-b hello");
  assert.equal(tracker.size, 0);
});

test("SlashOriginalTracker: 空栈返回 null", () => {
  const tracker = new SlashOriginalTracker();
  assert.equal(tracker.consumeFor("任意文本"), null);
});

test("SlashOriginalTracker: 回传文本与原文相同（未展开）时消费但不注入", () => {
  const tracker = new SlashOriginalTracker();
  tracker.push("/unknown-cmd x");
  // 防御分支：SDK 未展开（命令未命中），原样回传
  assert.equal(tracker.consumeFor("/unknown-cmd x"), null);
  assert.equal(tracker.size, 0);
});

test("SlashOriginalTracker: clear 清空所有记录", () => {
  const tracker = new SlashOriginalTracker();
  tracker.push("/a 1");
  tracker.push("/b 2");
  tracker.clear();
  assert.equal(tracker.size, 0);
  assert.equal(tracker.consumeFor("任意文本"), null);
});

test("SlashOriginalTracker: 跨多条消息保持顺序", () => {
  const tracker = new SlashOriginalTracker();
  tracker.push("/a 1");
  tracker.push("/b 2");
  tracker.push("/c 3");
  assert.equal(tracker.consumeFor("A 展开文本 1"), "/a 1");
  assert.equal(tracker.consumeFor("B 展开文本 2"), "/b 2");
  assert.equal(tracker.consumeFor("C 展开文本 3"), "/c 3");
  assert.equal(tracker.consumeFor("多余的普通消息"), null);
});
