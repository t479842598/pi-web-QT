import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { spawn } from "node:child_process";

const { isPidAlive } = await createJiti(import.meta.url).import("./process-alive.ts");

test("isPidAlive returns true for the current process", () => {
  assert.equal(isPidAlive(process.pid), true);
});

test("isPidAlive returns false for a pid that does not exist", () => {
  // Pick a pid far above the current one that is immensely unlikely to exist.
  assert.equal(isPidAlive(2_000_000_000 - 1), false);
});

test("isPidAlive returns false after a spawned child exits", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  assert.ok(pid && pid > 0);
  await new Promise((resolve) => child.on("exit", resolve));
  // After the child fully exits, the pid is gone (no zombie — we waited).
  assert.equal(isPidAlive(pid), false);
});
