import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const engine = await jiti.import("./task-engine.ts");

function withTempGitRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-task-git-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("runGitCapture captures stdout without a shell", async (t) => {
  const dir = withTempGitRepo(t);
  await engine.runGitIn(dir, ["init", "-q"]);
  await engine.runGitIn(dir, ["config", "user.email", "t@t"]);
  await engine.runGitIn(dir, ["config", "user.name", "t"]);
  const result = await engine.runGitCapture(dir, ["rev-parse", "--is-inside-work-tree"]);
  assert.equal(result.code, 0);
  assert.equal(result.output.trim(), "true");
});

test("runGitCapture reports non-zero exit codes without throwing", async (t) => {
  const dir = withTempGitRepo(t);
  const result = await engine.runGitCapture(dir, ["status", "--porcelain"]);
  assert.notEqual(result.code, 0);
  assert.ok(result.output.length > 0);
});

test("runGitIn rejects on git failure", async (t) => {
  const dir = withTempGitRepo(t);
  await assert.rejects(() => engine.runGitIn(dir, ["definitely-not-a-git-command"]));
});

test("array-arg spawn is immune to $(...) command substitution in arguments", async (t) => {
  const dir = withTempGitRepo(t);
  await engine.runGitIn(dir, ["init", "-q"]);
  await engine.runGitIn(dir, ["config", "user.email", "t@t"]);
  await engine.runGitIn(dir, ["config", "user.name", "t"]);
  const marker = join(dir, "PWNED");
  const evil = `$(touch ${marker})`;
  // The old code built `git commit -m ${JSON.stringify(msg)}` through a shell,
  // which executes $(...) even inside double quotes. Array args must not.
  await engine.runGitIn(dir, ["add", "."]);
  await engine.runGitIn(dir, ["commit", "-q", "--allow-empty", "-m", evil]);
  assert.equal(existsSync(marker), false, "command substitution must not execute");
  const log = await engine.runGitCapture(dir, ["log", "-1", "--format=%B"]);
  assert.equal(log.output.trim(), evil, "message stored verbatim");
});
