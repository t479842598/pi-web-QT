import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  cancelSessionTitle,
  getSessionTitleCoordinatorSnapshot,
  resetSessionTitleCoordinatorForTests,
  scheduleSessionTitle,
} = await jiti.import("./session-title-coordinator.ts");

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test.beforeEach(() => resetSessionTitleCoordinatorForTests());

test("deduplicates concurrent title requests for the same session", async () => {
  const gate = deferred();
  let calls = 0;
  const run = () => scheduleSessionTitle("same", async () => { calls += 1; await gate.promise; return "done"; });
  const promises = Array.from({ length: 20 }, run);
  assert.equal(calls, 1);
  assert.equal(getSessionTitleCoordinatorSnapshot().active, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all(promises), Array(20).fill("done"));
  assert.deepEqual(getSessionTitleCoordinatorSnapshot(), { active: 0, queued: 0, sessionIds: [] });
});

test("caps global title concurrency at two and rejects an overflowing queue", async () => {
  const gates = Array.from({ length: 22 }, deferred);
  let active = 0;
  let peak = 0;
  const tasks = gates.map((gate, index) => scheduleSessionTitle(`s${index}`, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
    return index;
  }));
  assert.equal(getSessionTitleCoordinatorSnapshot().active, 2);
  assert.equal(getSessionTitleCoordinatorSnapshot().queued, 20);
  assert.throws(
    () => scheduleSessionTitle("overflow", async () => 1),
    (error) => error?.code === "title_queue_full",
  );
  for (const gate of gates) gate.resolve();
  await Promise.all(tasks);
  assert.equal(peak, 2);
});

test("cancels queued and running title tasks without poisoning later requests", async () => {
  const running = deferred();
  const first = scheduleSessionTitle("running", async (signal) => {
    await Promise.race([
      running.promise,
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    ]);
    return "first";
  });
  const blocker = scheduleSessionTitle("blocker", async () => { await running.promise; return "blocker"; });
  const queued = scheduleSessionTitle("queued", async () => "queued");
  assert.equal(cancelSessionTitle("queued"), true);
  await assert.rejects(queued, (error) => error?.code === "title_generation_cancelled");
  assert.equal(cancelSessionTitle("running"), true);
  await assert.rejects(first, /aborted/);
  running.resolve();
  await blocker;
  assert.equal(await scheduleSessionTitle("running", async () => "retry"), "retry");
});
