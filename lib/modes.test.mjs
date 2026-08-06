import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeCollaborationMode,
  normalizeTokenMode,
  normalizeToolApprovalMode,
  buildModeSystemPrompt,
  ECONOMY_TOOL_WHITELIST,
  DEFAULT_COLLABORATION_MODE,
  DEFAULT_TOKEN_MODE,
  DEFAULT_TOOL_APPROVAL_MODE,
} = await jiti.import("./modes.ts");

// --- Normalizers -----------------------------------------------------------

test("normalizeCollaborationMode accepts canonical values", () => {
  assert.equal(normalizeCollaborationMode("normal"), "normal");
  assert.equal(normalizeCollaborationMode("plan"), "plan");
  assert.equal(normalizeCollaborationMode("goal"), "goal");
});

test("normalizeCollaborationMode falls back on unknown values", () => {
  assert.equal(normalizeCollaborationMode("bogus"), DEFAULT_COLLABORATION_MODE);
  assert.equal(normalizeCollaborationMode(undefined), DEFAULT_COLLABORATION_MODE);
  assert.equal(normalizeCollaborationMode(null), DEFAULT_COLLABORATION_MODE);
  assert.equal(normalizeCollaborationMode(42), DEFAULT_COLLABORATION_MODE);
});

test("normalizeTokenMode accepts canonical values", () => {
  assert.equal(normalizeTokenMode("full"), "full");
  assert.equal(normalizeTokenMode("economy"), "economy");
  assert.equal(normalizeTokenMode("delivery"), "delivery");
});

test("normalizeTokenMode falls back on unknown values", () => {
  assert.equal(normalizeTokenMode("save"), DEFAULT_TOKEN_MODE);
  assert.equal(normalizeTokenMode(""), DEFAULT_TOKEN_MODE);
  assert.equal(normalizeTokenMode(undefined), DEFAULT_TOKEN_MODE);
});

test("normalizeToolApprovalMode accepts canonical values", () => {
  assert.equal(normalizeToolApprovalMode("ask"), "ask");
  assert.equal(normalizeToolApprovalMode("auto"), "auto");
  assert.equal(normalizeToolApprovalMode("yolo"), "yolo");
});

test("normalizeToolApprovalMode falls back on unknown values", () => {
  assert.equal(normalizeToolApprovalMode("always"), DEFAULT_TOOL_APPROVAL_MODE);
  assert.equal(normalizeToolApprovalMode(undefined), DEFAULT_TOOL_APPROVAL_MODE);
});

// --- Prompt builder --------------------------------------------------------

test("normal + full produces no injection", () => {
  assert.equal(buildModeSystemPrompt({ collaborationMode: "normal", tokenMode: "full" }), "");
});

test("plan mode injects read-only plan block", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "plan", tokenMode: "full" });
  assert.match(prompt, /PLAN MODE/);
  assert.match(prompt, /read-only planning assistant/);
  assert.match(prompt, /do NOT modify any files/i);
});

test("economy mode injects economy profile", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "normal", tokenMode: "economy" });
  assert.match(prompt, /<economy-profile>/);
  assert.match(prompt, /Economy mode is on/);
  assert.match(prompt, /Minimize context/);
});

test("delivery mode injects delivery profile", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "normal", tokenMode: "delivery" });
  assert.match(prompt, /<delivery-profile>/);
  assert.match(prompt, /verified, complete result/);
  assert.match(prompt, /Do not claim success without/);
});

test("goal mode injects goal profile with goal text", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "goal", tokenMode: "full", goalText: "Fix the login bug" });
  assert.match(prompt, /<goal-profile>/);
  assert.match(prompt, /Goal: Fix the login bug/);
});

test("goal mode omits goal text when empty", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "goal", tokenMode: "full", goalText: "  " });
  assert.match(prompt, /<goal-profile>/);
  assert.doesNotMatch(prompt, /Goal:/);
});

test("plan + delivery combine in stable order (plan first)", () => {
  const prompt = buildModeSystemPrompt({ collaborationMode: "plan", tokenMode: "delivery" });
  const planIdx = prompt.indexOf("PLAN MODE");
  const deliveryIdx = prompt.indexOf("<delivery-profile>");
  assert.ok(planIdx >= 0 && deliveryIdx >= 0);
  assert.ok(planIdx < deliveryIdx);
});

// --- Economy whitelist -----------------------------------------------------

test("economy whitelist includes core file and shell tools", () => {
  for (const tool of ["bash", "edit", "read", "write", "grep", "find", "ls"]) {
    assert.ok(ECONOMY_TOOL_WHITELIST.includes(tool), `missing ${tool}`);
  }
});

test("economy whitelist excludes heavy exploratory tools", () => {
  assert.ok(!ECONOMY_TOOL_WHITELIST.includes("web_search"));
  assert.ok(!ECONOMY_TOOL_WHITELIST.includes("task"));
});
