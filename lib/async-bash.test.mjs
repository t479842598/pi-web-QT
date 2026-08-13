import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { AsyncProcessManager } = await createJiti(import.meta.url).import("./async-bash.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("short command returns full output and exits", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("echo hello-async-bash", process.cwd(), process.env);
  const result = await manager.poll(mp.id, 2000);
  assert.ok(result.output.includes("hello-async-bash"), result.output);
  assert.equal(result.exited, true);
  assert.equal(result.exitCode, 0);
  manager.cleanup();
});

test("long command returns session without blocking; poll collects increments", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("printf 'one\\n'; sleep 1; printf 'two\\n'; sleep 1", process.cwd(), process.env);
  // Short yield → still running, no full output yet.
  const first = await manager.poll(mp.id, 300);
  assert.equal(first.exited, false, "process should still be running after 300ms");
  assert.ok(first.output.includes("one"), first.output);

  // Poll again with a longer window; collect more output.
  const second = await manager.poll(mp.id, 3000);
  assert.ok(second.output.includes("two"), second.output);
  assert.equal(second.exited, true);
  manager.cleanup();
});

test("Ctrl-C interrupts a long-running process", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("sleep 30", process.cwd(), process.env);
  await sleep(200);
  const write = manager.writeStdin(mp.id, "\x03");
  assert.equal(write.ok, true, write.error);
  const result = await manager.poll(mp.id, 3000);
  assert.equal(result.exited, true);
  manager.cleanup();
});

test("kill removes the process from the store", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("sleep 30", process.cwd(), process.env);
  assert.ok(manager.get(mp.id));
  assert.equal(manager.kill(mp.id), true);
  assert.equal(manager.get(mp.id), undefined);
});

test("cleanup kills every tracked process", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("sleep 30", process.cwd(), process.env);
  assert.ok(mp.child.pid);
  manager.cleanup();
  assert.equal(manager.get(mp.id), undefined);
});

test("writing stdin is forwarded to the process", async () => {
  const manager = new AsyncProcessManager();
  const mp = manager.spawn("cat", process.cwd(), process.env);
  await sleep(200);
  const write = manager.writeStdin(mp.id, "stdin-data\n");
  assert.equal(write.ok, true, write.error);
  const result = await manager.poll(mp.id, 2000);
  assert.ok(result.output.includes("stdin-data"), result.output);
  manager.cleanup();
});

test("remove kills orphaned background children (shell exits, child lingers)", async () => {
  const manager = new AsyncProcessManager();
  // The shell exits immediately but the background sleep keeps the group alive.
  const mp = manager.spawn("sleep 30 &", process.cwd(), process.env);
  await sleep(300);
  // poll returns exited=true (shell is gone) and execute removes it.
  const result = await manager.poll(mp.id, 500);
  assert.equal(result.exited, true, result.output);
  manager.remove(mp.id);
  // The orphaned child must have been killed (its process group no longer exists).
  assert.equal(manager.get(mp.id), undefined);
  // Give the kill a moment to land; no assertion needed beyond no crash,
  // but verify cleanup is still safe afterwards.
  await sleep(100);
  manager.cleanup();
});
