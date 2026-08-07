import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseRule,
  parseRules,
  ruleToString,
  decide,
  defaultPolicy,
  policyFromStrings,
  policyToStrings,
  extractSubject,
  bashRequiresHuman,
  bashIsPlainReadonly,
} = await jiti.import("./permission.ts");

// --- parseRule -------------------------------------------------------------

test("parseRule handles bare tool name", () => {
  assert.deepEqual(parseRule("Bash"), { tool: "Bash" });
  assert.deepEqual(parseRule("write_file"), { tool: "write_file" });
});

test("parseRule handles glob subject", () => {
  assert.deepEqual(parseRule("Bash(command:*)"), { tool: "Bash", subject: "command:*" });
  assert.deepEqual(parseRule("write(*.env)"), { tool: "write", subject: "*.env" });
});

test("parseRule handles legacy literal form", () => {
  assert.deepEqual(parseRule("Bash=command:rm -rf /tmp/x"), {
    tool: "Bash",
    subject: "command:rm -rf /tmp/x",
    literal: true,
  });
});

test("parseRule rejects malformed rules", () => {
  assert.equal(parseRule(""), null);
  assert.equal(parseRule("   "), null);
  assert.equal(parseRule("(glob)"), null);
});

test("parseRules drops malformed entries and preserves order", () => {
  const rules = parseRules(["Bash", "", "write(*.env)", "()"]);
  assert.equal(rules.length, 2);
  assert.equal(ruleToString(rules[0]), "Bash");
  assert.equal(ruleToString(rules[1]), "write(*.env)");
});

// --- glob matching ---------------------------------------------------------

test("glob rule matches subject", () => {
  const policy = policyFromStrings({ allow: ["write(*.env)"] });
  assert.equal(decide(policy, "write", { mode: "ask", args: { path: "/x/.env" } }), "allow");
  // Non-matching writer in ask mode still asks (rule does not cover it).
  assert.equal(decide(policy, "write", { mode: "ask", args: { path: "/x/app.ts" } }), "ask");
});

// --- bash classification ---------------------------------------------------

test("bashRequiresHuman detects nested execution", () => {
  assert.ok(bashRequiresHuman("echo $(ls)"));
  assert.ok(bashRequiresHuman("python -c 'print(1)'"));
  assert.ok(bashRequiresHuman("sh -c 'rm -rf /'"));
  assert.ok(bashRequiresHuman("ls | tee out.txt"));
  assert.ok(bashRequiresHuman("cat a; rm b"));
  assert.ok(bashRequiresHuman("sudo rm -rf /"));
});

test("bashRequiresHuman passes plain commands", () => {
  assert.ok(!bashRequiresHuman("ls -la"));
  assert.ok(!bashRequiresHuman("cat README.md"));
  assert.ok(!bashRequiresHuman("git status"));
});

test("bashIsPlainReadonly recognizes read-only prefixes", () => {
  assert.ok(bashIsPlainReadonly("ls -la"));
  assert.ok(bashIsPlainReadonly("cat package.json"));
  assert.ok(bashIsPlainReadonly("git diff HEAD"));
  assert.ok(!bashIsPlainReadonly("rm -rf dist"));
  assert.ok(!bashIsPlainReadonly("npm install"));
  assert.ok(!bashIsPlainReadonly("ls; rm x"));
});

// --- decide: priority & modes ---------------------------------------------

test("deny wins in every mode including yolo", () => {
  const policy = policyFromStrings({ deny: ["Bash(command:rm *)"] });
  assert.equal(decide(policy, "bash", { mode: "yolo", args: { command: "rm -rf /tmp/x" } }), "deny");
  assert.equal(decide(policy, "bash", { mode: "auto", args: { command: "rm -rf /tmp/x" } }), "deny");
  assert.equal(decide(policy, "bash", { mode: "ask", args: { command: "rm -rf /tmp/x" } }), "deny");
});

test("read-only tools always allow (mode ask included)", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "read", { mode: "ask", args: { path: "/x/a.ts" } }), "allow");
  assert.equal(decide(policy, "grep", { mode: "ask", args: { pattern: "foo" } }), "allow");
  assert.equal(decide(policy, "ls", { mode: "ask", args: {} }), "allow");
});

test("ask mode asks for writers without rules", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "write", { mode: "ask", args: { path: "/x/a.ts" } }), "ask");
  assert.equal(decide(policy, "edit", { mode: "ask", args: { path: "/x/a.ts" } }), "ask");
});

test("auto mode allows writers without rules", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "write", { mode: "auto", args: { path: "/x/a.ts" } }), "allow");
});

test("ask rule beats auto mode", () => {
  const policy = policyFromStrings({ ask: ["bash(command:git push *)"] });
  assert.equal(decide(policy, "bash", { mode: "auto", args: { command: "git push origin main" } }), "ask");
});

test("allow rule beats ask mode", () => {
  const policy = policyFromStrings({ allow: ["bash(command:git status)"] });
  assert.equal(decide(policy, "bash", { mode: "ask", args: { command: "git status" } }), "allow");
});

test("plain read-only bash allows even in ask mode", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "bash", { mode: "ask", args: { command: "ls -la" } }), "allow");
  assert.equal(decide(policy, "bash", { mode: "ask", args: { command: "cat README.md" } }), "allow");
});

test("write bash asks in ask mode", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "bash", { mode: "ask", args: { command: "npm install lodash" } }), "ask");
  assert.equal(decide(policy, "bash", { mode: "auto", args: { command: "npm install lodash" } }), "allow");
});

test("nested bash asks even in auto, allows in yolo", () => {
  const policy = defaultPolicy();
  assert.equal(decide(policy, "bash", { mode: "auto", args: { command: "echo $(whoami)" } }), "ask");
  assert.equal(decide(policy, "bash", { mode: "yolo", args: { command: "echo $(whoami)" } }), "allow");
});

test("exact allow rule permits nested bash", () => {
  const policy = policyFromStrings({ allow: ["Bash(command:echo $(whoami))"] });
  assert.equal(decide(policy, "bash", { mode: "auto", args: { command: "echo $(whoami)" } }), "allow");
});

test("file subject extraction from args", () => {
  assert.equal(extractSubject("write", { path: "/a/b.ts" }), "/a/b.ts");
  assert.equal(extractSubject("edit", { file_path: "/a/b.ts" }), "/a/b.ts");
  assert.equal(extractSubject("bash", { command: "ls -la" }), "command:ls -la");
});

test("policyToStrings round-trips", () => {
  const policy = policyFromStrings({ allow: ["Bash(command:git status)"], ask: ["write"], deny: ["Bash(command:rm *)"] });
  const strings = policyToStrings(policy);
  assert.deepEqual(strings, {
    allow: ["Bash(command:git status)"],
    ask: ["write"],
    deny: ["Bash(command:rm *)"],
  });
});
