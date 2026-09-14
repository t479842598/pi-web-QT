import assert from "node:assert/strict";
import test from "node:test";
import { createRpcHarness, deferred, nextTurn } from "./rpc-test-harness.mjs";

function setup(t) {
  const h = createRpcHarness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const inner = h.makeInner();
  const wrapper = h.makeWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.start();
  const prompts = [];
  inner.prompt = async (text) => { prompts.push(text); };
  return { ...h, inner, wrapper, prompts, drive: async () => { t.mock.timers.tick(0); await nextTurn(); } };
}

test("the first goal continuation includes the current goal body, not just a generic instruction", async (t) => {
  const h = setup(t);
  await h.wrapper.send({ type: "goal_start", goalText: "Implement isolated recovery tests", tokenBudget: 500 });
  await h.drive();
  assert.equal(h.prompts.length, 1);
  assert.ok(h.prompts[0].includes("Implement isolated recovery tests"));
  assert.ok(h.prompts[0].includes(h.goal.GOAL_CONTINUE_INSTRUCTION));
  assert.equal(h.wrapper.getGoalState().tokenBudget, 500);
});

test("goal edited while waiting for prompt admission uses the edited body without resetting its budget", async (t) => {
  const h = setup(t);
  const release = await h.wrapper.acquirePromptAdmission();
  await h.wrapper.send({ type: "goal_start", goalText: "obsolete objective", tokenBudget: 1000 });
  await h.drive();
  await h.wrapper.send({ type: "goal_edit", goalText: "new objective after edit" });
  release();
  await nextTurn();
  assert.equal(h.prompts.length, 1);
  assert.ok(h.prompts[0].includes("new objective after edit"));
  assert.ok(!h.prompts[0].includes("obsolete objective"));
  assert.equal(h.wrapper.getGoalState().tokenBudget, 1000);
});

test("paused goal never starts a continuation pending admission", async (t) => {
  const h = setup(t);
  const release = await h.wrapper.acquirePromptAdmission();
  await h.wrapper.send({ type: "goal_start", goalText: "wait for user" });
  await h.drive();
  await h.wrapper.send({ type: "goal_pause" });
  release();
  await nextTurn();
  assert.deepEqual(h.prompts, []);
  assert.equal(h.wrapper.getGoalState().status, "paused");
});

test("token-exhausted goal does not schedule another continuation", async (t) => {
  const h = setup(t);
  const run = deferred();
  t.after(() => run.resolve());
  h.inner.prompt = async (text) => {
    h.prompts.push(text);
    h.inner.emit({ type: "agent_start" });
    await run.promise;
    h.inner.sessionManager.getEntries = () => [{ type: "message", message: { role: "assistant", content: [], usage: { input: 100, output: 50 } } }];
    h.inner.emit({ type: "agent_settled" });
  };
  await h.wrapper.send({ type: "goal_start", goalText: "bounded objective", tokenBudget: 100 });
  await h.drive();
  run.resolve();
  await nextTurn();
  await h.drive();
  assert.equal(h.prompts.length, 1);
  assert.equal(h.wrapper.getGoalState().status, "budget_limited");
});
