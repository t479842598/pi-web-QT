import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { encodeCwd, resolveTranscriptPath, readSubagentTranscript, lineFromEntry } = await createJiti(import.meta.url).import("./subagent-transcript.ts");

test("encodeCwd mirrors pi-subagents encoding", () => {
  assert.equal(encodeCwd("/home/user/project"), "home-user-project");
  assert.equal(encodeCwd("/Volumes/1T 原装/项目研发/pi-web-QT"), "Volumes-1T 原装-项目研发-pi-web-QT");
  assert.equal(encodeCwd("/"), "");
});

test("lineFromEntry parses user/assistant/toolResult entries", () => {
  const user = lineFromEntry({ type: "user", message: { role: "user", content: "hello" } });
  assert.equal(user.role, "user");
  assert.equal(user.text, "hello");

  const assistant = lineFromEntry({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me search" },
        { type: "toolCall", name: "Grep" },
      ],
    },
  });
  assert.equal(assistant.role, "assistant");
  assert.match(assistant.text, /Let me search/);
  assert.match(assistant.text, /\[Tool: Grep\]/);

  const toolResult = lineFromEntry({
    type: "toolResult",
    message: { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "matched" }] },
  });
  assert.equal(toolResult.role, "toolResult");
  assert.match(toolResult.text, /matched/);
});

test("readSubagentTranscript reads a real .output file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  const path = join(dir, "agent.output");
  writeFileSync(path, [
    JSON.stringify({ type: "user", message: { role: "user", content: "find auth" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "toolCall", name: "Grep" }] } }),
    JSON.stringify({ type: "toolResult", message: { role: "toolResult", content: [{ type: "text", text: "auth.ts:1" }] } }),
    "garbage-line",
    "",
  ].join("\n"), "utf8");

  const lines = readSubagentTranscript(path);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].role, "user");
  assert.equal(lines[1].role, "assistant");
  assert.equal(lines[2].role, "toolResult");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveTranscriptPath probes session dirs and falls back to explicit paths", () => {
  // Build a fake root in a KNOWN temp dir and pass it explicitly so the
  // test does not depend on os.tmpdir() behavior inside the jiti-compiled module.
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  const encoded = encodeCwd("/repo");
  const dir = join(root, encoded, "sess1", "tasks");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "agent-abc.output");
  writeFileSync(out, JSON.stringify({ type: "user", message: { content: "x" } }) + "\n", "utf8");

  const explicit = resolveTranscriptPath("/repo", "agent-abc", "sess1", root);
  assert.equal(explicit, out);
  const probe = resolveTranscriptPath("/repo", "agent-abc", undefined, root);
  assert.equal(probe, out);
  rmSync(root, { recursive: true, force: true });
});

test("readSubagentTranscript returns the newest lines when the file exceeds the limit (tail read)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagent-tail-"));
  try {
    const file = join(dir, "t.output");
    const total = 500;
    const lines = [];
    for (let i = 0; i < total; i++) {
      lines.push(JSON.stringify({ type: "user", message: { role: "user", content: `msg ${i}` } }));
    }
    writeFileSync(file, lines.join("\n") + "\n");
    const parsed = readSubagentTranscript(file, 100);
    assert.equal(parsed.length, 100, "limit caps the count");
    assert.equal(parsed[0].text, "msg 400", "starts at the newest window (tail), not the head");
    assert.equal(parsed[99].text, "msg 499", "newest line is the last parsed line");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSubagentTranscript returns everything when under the limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagent-small-"));
  try {
    const file = join(dir, "t.output");
    writeFileSync(file, [
      JSON.stringify({ type: "user", message: { role: "user", content: "a" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "b" }] } }),
      JSON.stringify({ type: "toolResult", message: { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "c" }] } }),
    ].join("\n") + "\n");
    const parsed = readSubagentTranscript(file);
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed.map((l) => l.text), ["a", "b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSubagentTranscript skips malformed tail lines and still returns the newest valid ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagent-mixed-"));
  try {
    const file = join(dir, "t.output");
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push(JSON.stringify({ type: "user", message: { role: "user", content: `ok ${i}` } }));
    lines.push("{\"partial write"); // malformed tail line (streaming race)
    writeFileSync(file, lines.join("\n") + "\n");
    const parsed = readSubagentTranscript(file, 10);
    assert.equal(parsed.length, 10);
    assert.equal(parsed[9].text, "ok 19", "newest valid line reached despite trailing garbage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
