import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("./task-store.ts");
const engine = await jiti.import("./task-engine.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir(t) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-task-engine-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    rmSync(agentDir, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
  });
  return agentDir;
}

function draft(title = "Fix bug") {
  return {
    projectRoot: "/repo",
    title,
    config: { prompt: `Please fix the bug: ${title}` },
  };
}

test("createTask creates a todo task with an event", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft("Test task"));
  assert.equal(task.status, "todo");
  assert.equal(task.runSeq, 0);
  assert.equal(task.projectRoot, "/repo");

  const events = store.loadTaskEvents("/repo", task.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "created");
});

test("startTask moves todo → queued and bumps runSeq", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  await engine.startTask(task.id, "/repo");
  const after = store.loadTask("/repo", task.id);
  assert.equal(after.status, "queued");
  assert.equal(after.runSeq, 1);
});

test("startTask is a no-op for non-todo statuses", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  // fake it into running
  store.saveTask({ ...task, status: "running", runSeq: 5 });
  await engine.startTask(task.id, "/repo");
  const after = store.loadTask("/repo", task.id);
  assert.equal(after.status, "running");
  assert.equal(after.runSeq, 5);
});

test("cancelTask: queued task → canceled", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  await engine.startTask(task.id, "/repo");
  await engine.cancelTask(task.id, "/repo");
  const after = store.loadTask("/repo", task.id);
  assert.equal(after.status, "canceled");
  assert.ok(after.finishedAt);
});

test("retryTask: failed → queued with runSeq bump", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  store.saveTask({ ...task, status: "failed", failureReason: "agent_error", lastError: "boom", runSeq: 3 });
  await engine.retryTask(task.id, "/repo");
  const after = store.loadTask("/repo", task.id);
  assert.equal(after.status, "queued");
  assert.equal(after.runSeq, 4);
  assert.equal(after.lastError, null);
});

test("requeueTask: canceled → todo", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  store.saveTask({ ...task, status: "canceled", runSeq: 2 });
  await engine.requeueTask(task.id, "/repo");
  const after = store.loadTask("/repo", task.id);
  assert.equal(after.status, "todo");
});

test("archiveTask toggles archivedAt", async (t) => {
  isolateAgentDir(t);
  const task = engine.createTask(draft());
  await engine.archiveTask(task.id, "/repo", true);
  assert.ok(store.loadTask("/repo", task.id).archivedAt);
  await engine.archiveTask(task.id, "/repo", false);
  assert.equal(store.loadTask("/repo", task.id).archivedAt, null);
});

test("reorderTasks persists sort order, keeps unlisted at tail", async (t) => {
  isolateAgentDir(t);
  const a = engine.createTask(draft("A"));
  const b = engine.createTask(draft("B"));
  const c = engine.createTask(draft("C"));
  await engine.reorderTasks("/repo", [c.id, a.id]);
  const tasks = store.loadTasks("/repo");
  const order = tasks.map((x) => x.id);
  assert.deepEqual(order, [c.id, a.id, b.id]);
  assert.equal(tasks[0].sortOrder, 0);
  assert.equal(tasks[1].sortOrder, 1);
  assert.equal(tasks[2].sortOrder, 2);
});

test("startAllTasks claims every todo of the project", async (t) => {
  isolateAgentDir(t);
  const a = engine.createTask(draft("A"));
  const b = engine.createTask(draft("B"));
  const c = engine.createTask(draft("C"));
  // c is already running — not claimable
  store.saveTask({ ...store.loadTask("/repo", c.id), status: "running" });
  const claimed = await engine.startAllTasks("/repo");
  assert.equal(claimed, 2);
  assert.equal(store.loadTask("/repo", a.id).status, "queued");
  assert.equal(store.loadTask("/repo", b.id).status, "queued");
  assert.equal(store.loadTask("/repo", c.id).status, "running");
});

test("change bus emits upsert/delete", async (t) => {
  isolateAgentDir(t);
  const seen = [];
  const off = engine.onTaskChange((change) => seen.push(change));
  const task = engine.createTask(draft());
  await engine.archiveTask(task.id, "/repo", true);
  await engine.deleteTask(task.id, "/repo", false);
  off();
  assert.ok(seen.some((c) => c.type === "upsert"));
  assert.ok(seen.some((c) => c.type === "delete"));
});
