import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  GoalEngine,
  loadGoalState,
  saveGoalState,
  goalSidecarPath,
  DEFAULT_GOAL_TURNS_LIMIT,
  DEFAULT_GOAL_NO_PROGRESS_LIMIT,
} = await createJiti(import.meta.url).import("./goal-engine.ts");

function tempSessionFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-goal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "session.jsonl");
}

test("initial state is idle", () => {
  const engine = new GoalEngine();
  const s = engine.getState();
  assert.equal(s.status, "idle");
  assert.equal(s.goalText, null);
  assert.equal(s.tokensUsed, 0);
  assert.equal(s.turnsLimit, DEFAULT_GOAL_TURNS_LIMIT);
  assert.equal(s.noProgressLimit, DEFAULT_GOAL_NO_PROGRESS_LIMIT);
});

test("start creates running goal and resets counters", () => {
  const engine = new GoalEngine();
  engine.start("  build the game  ", 100_000);
  const s = engine.getState();
  assert.equal(s.status, "running");
  assert.equal(s.goalText, "build the game");
  assert.equal(s.tokenBudget, 100_000);
  assert.equal(s.turnsUsed, 0);
  assert.equal(s.tokensUsed, 0);
  assert.ok(s.startedAt);
});

test("persistence round-trips through the sidecar", (t) => {
  const file = tempSessionFile(t);
  const engine = new GoalEngine(file);
  engine.start("fix login bug", 5000);
  engine.settleTurn("some work done", 1200, 3);
  saveGoalState(file, engine.getState());

  const loaded = loadGoalState(file);
  assert.equal(loaded.status, "running");
  assert.equal(loaded.goalText, "fix login bug");
  assert.equal(loaded.turnsUsed, 1);
  assert.equal(loaded.tokensUsed, 1200);
  assert.equal(loaded.tokenBudget, 5000);
});

test("corrupt or missing sidecar loads as idle", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-goal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = path.join(root, "none.jsonl");
  assert.equal(loadGoalState(missing).status, "idle");

  const corrupt = path.join(root, "corrupt.jsonl");
  fs.writeFileSync(goalSidecarPath(corrupt), "{not json");
  assert.equal(loadGoalState(corrupt).status, "idle");
});

test("complete marker stops the loop with complete", () => {
  const engine = new GoalEngine();
  engine.start("ship it");
  const { verdict, state } = engine.settleTurn("Done. [goal: complete]", 100, 2);
  assert.equal(verdict.action, "complete");
  assert.equal(state.status, "complete");
});

test("blocked marker pauses with blocked", () => {
  const engine = new GoalEngine();
  engine.start("ship it");
  const { verdict, state } = engine.settleTurn("I am blocked: missing API key", 100, 1);
  assert.equal(verdict.action, "blocked");
  assert.equal(state.status, "blocked");
});

test("no-progress stalls flip to blocked after the limit", () => {
  const engine = new GoalEngine();
  engine.start("do work");
  // No tool calls across turns → consecutive no-progress turns.
  for (let i = 0; i < DEFAULT_GOAL_NO_PROGRESS_LIMIT - 1; i++) {
    const { verdict } = engine.settleTurn("thinking out loud", 100, 0);
    assert.equal(verdict.action, "continue");
  }
  const { verdict, state } = engine.settleTurn("still thinking", 100, 0);
  assert.equal(verdict.action, "blocked");
  assert.equal(state.status, "blocked");
});

test("token budget exhaustion flips to budget_limited", () => {
  const engine = new GoalEngine();
  engine.start("big task", 500);
  const { verdict, state } = engine.settleTurn("working", 600, 2);
  assert.equal(verdict.action, "budget_limited");
  assert.equal(state.status, "budget_limited");
});

test("turn budget exhaustion flips to paused (resumable)", () => {
  const engine = new GoalEngine();
  engine.start("long task");
  for (let i = 0; i < DEFAULT_GOAL_TURNS_LIMIT - 1; i++) {
    const { verdict } = engine.settleTurn(`progress ${i}`, 10, 1);
    assert.equal(verdict.action, "continue");
  }
  const { verdict, state } = engine.settleTurn("last turn", 10, 1);
  assert.equal(verdict.action, "pause");
  assert.equal(state.status, "paused");
  // Resume returns to running and continues.
  engine.resume();
  assert.equal(engine.getState().status, "running");
});

test("pause/resume/stop/edit transitions", () => {
  const engine = new GoalEngine();
  engine.start("original");
  engine.pause();
  assert.equal(engine.getState().status, "paused");
  engine.resume();
  assert.equal(engine.getState().status, "running");
  engine.edit("edited goal");
  assert.equal(engine.getState().goalText, "edited goal");
  assert.equal(engine.getState().status, "running");
  engine.stop();
  assert.equal(engine.getState().status, "idle");
  assert.equal(engine.getState().goalText, null);
});

test("edit re-activates terminal states", () => {
  const engine = new GoalEngine();
  engine.start("old", 100);
  engine.settleTurn("[goal: complete]", 50, 1);
  assert.equal(engine.getState().status, "complete");
  engine.edit("new goal");
  assert.equal(engine.getState().status, "running");
  assert.equal(engine.getState().goalText, "new goal");
});

test("continuation arm/disarm guards", () => {
  const engine = new GoalEngine();
  engine.armContinuation();
  assert.ok(engine.isContinuationArmed());
  engine.disarmContinuation();
  assert.equal(engine.isContinuationArmed(), false);
  // onAgentStart also disarms.
  engine.armContinuation();
  engine.onAgentStart();
  assert.equal(engine.isContinuationArmed(), false);
});

test("start preserves an existing budget when none is specified", () => {
  const engine = new GoalEngine();
  engine.start("first", 50_000);
  engine.start("restated goal"); // no budget arg
  assert.equal(engine.getState().tokenBudget, 50_000);
});

test("complete marker accounts final turn tokens and wall time", () => {
  const engine = new GoalEngine();
  engine.start("ship it", 1000);
  engine.onAgentStart();
  const { verdict, state } = engine.settleTurn("Finished. [goal: complete]", 400, 2);
  assert.equal(verdict.action, "complete");
  assert.equal(state.status, "complete");
  assert.equal(state.tokensUsed, 400);
  assert.equal(state.turnsUsed, 1);
});

test("blocked marker accounts final turn tokens", () => {
  const engine = new GoalEngine();
  engine.start("ship it");
  engine.onAgentStart();
  const { verdict, state } = engine.settleTurn("blocked: missing creds", 250, 0);
  assert.equal(verdict.action, "blocked");
  assert.equal(state.status, "blocked");
  assert.equal(state.tokensUsed, 250);
});
