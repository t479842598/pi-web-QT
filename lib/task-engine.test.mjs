import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import childProcess from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("./task-store.ts");
const worktrees = await jiti.import("./worktree.ts");
let createSession = () => { throw new Error("Unexpected task session creation"); };
let beforeRemove;
const pendingGit = new Set();
const removals = [];
const engine = await createJiti(import.meta.url, {
  moduleCache: false,
  virtualModules: {
    "./rpc-manager": { startRpcSession: (...args) => createSession(...args) },
    "./worktree": {
      ...worktrees,
      removeWorktree: async (...args) => {
        removals.push(args);
        await beforeRemove?.(...args);
        return worktrees.removeWorktree(...args);
      },
    },
    child_process: {
      ...childProcess,
      spawn: (...args) => {
        const child = childProcess.spawn(...args);
        pendingGit.add(child);
        child.once("close", () => pendingGit.delete(child));
        return child;
      },
    },
  },
}).import("./task-engine.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir(t, beforeCleanup) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-task-engine-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    await beforeCleanup?.();
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

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, message = "condition") {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${message}`);
}

async function drainGit() {
  for (let pass = 0; pass < 3; pass += 1) {
    await nextTurn();
    const merges = [...(globalThis.__piTaskMergeLocks?.values() ?? [])];
    if (merges.length) await Promise.allSettled(merges);
    if (pendingGit.size) {
      await Promise.all([...pendingGit].map((child) => new Promise((resolve) => child.once("close", resolve))));
      pass = 0;
    }
  }
}

function assistant(stopReason = "stop", errorMessage) {
  return { role: "assistant", content: [{ type: "text", text: "Task result" }], stopReason, errorMessage };
}

function fakeTaskSession(cwd, id) {
  const listeners = new Set();
  const messages = [];
  let running = false;
  return {
    cwd,
    sessionId: id,
    sessionFile: "",
    prompts: [],
    inner: { agent: { state: { messages } }, sessionManager: { buildSessionContext: () => ({ messages }) } },
    isAlive: () => true,
    isRunning: () => running,
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    get listenerCount() { return listeners.size; },
    emit(event) {
      if (event.type === "agent_start") running = true;
      if (event.type === "prompt_done") running = false;
      if (event.type === "message_end") messages.push(event.message);
      for (const listener of [...listeners]) listener(event);
    },
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        this.emit({ type: "agent_start" });
      } else if (command.type === "abort") {
        this.emit({ type: "message_end", message: assistant("aborted") });
        this.emit({ type: "agent_end", messages: [assistant("aborted")] });
        this.emit({ type: "prompt_done" });
      }
    },
    async shutdown() { running = false; },
    async finish(stopReason = "stop") {
      const message = assistant(stopReason, stopReason === "error" ? "provider failed" : undefined);
      this.emit({ type: "message_end", message });
      this.emit({ type: "agent_end", messages: [message], willRetry: false });
      this.emit({ type: "agent_settled" });
      this.emit({ type: "prompt_done" });
      await nextTurn();
    },
  };
}

async function taskFixture(t, { committed = true, review = true, realEngine = false } = {}) {
  isolateAgentDir(t, async () => {
    const state = globalThis.__piTaskEngine;
    if (state) {
      state.stopped = true;
      await Promise.all(state.pumpLocks.values());
    }
    await drainGit();
  });
  const root = mkdtempSync(join(tmpdir(), "pi-task-lifecycle-"));
  const projectRoot = join(root, "repo");
  mkdirSync(projectRoot);
  await engine.runGitIn(projectRoot, ["init", "-q", "-b", "main"]);
  await engine.runGitIn(projectRoot, ["config", "user.email", "test@example.com"]);
  await engine.runGitIn(projectRoot, ["config", "user.name", "Task Test"]);
  await engine.runGitIn(projectRoot, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(projectRoot, "base.txt"), "base\n");
  await engine.runGitIn(projectRoot, ["add", "."]);
  await engine.runGitIn(projectRoot, ["commit", "-qm", "initial"]);
  if (realEngine) {
    t.mock.timers.enable({ apis: ["setInterval"] });
    assert.equal(engine.ensureTaskEngine(), true);
  }
  const state = realEngine ? globalThis.__piTaskEngine : { live: new Map(), byTask: new Map(), launching: new Map(), pumpLocks: new Map(), stopped: false, reconcileTimer: null };
  globalThis.__piTaskEngine = state;
  removals.length = 0;
  beforeRemove = undefined;
  let session;
  createSession = async (id, _file, cwd) => ({ session: session = fakeTaskSession(cwd, id) });
  t.after(async () => {
    state.stopped = true;
    await Promise.all(state.pumpLocks.values());
    await drainGit();
    delete globalThis.__piTaskEngine;
    beforeRemove = undefined;
    createSession = () => { throw new Error("Unexpected task session creation"); };
    rmSync(root, { recursive: true, force: true });
  });
  const task = engine.createTask({ projectRoot, title: "lifecycle regression", config: { prompt: "Make one change" } });
  await engine.startTask(task.id, projectRoot);
  await waitFor(() => session?.prompts.length === 1, "task prompt");
  await Promise.all(state.pumpLocks.values());
  const load = () => store.loadTask(projectRoot, task.id);
  const events = () => store.loadTaskEvents(projectRoot, task.id);
  const worktreePath = load().worktreePath;
  writeFileSync(join(worktreePath, "feature.txt"), "task output\n");
  if (committed) {
    await engine.runGitIn(worktreePath, ["add", "feature.txt"]);
    await engine.runGitIn(worktreePath, ["commit", "-qm", "task output"]);
  }
  if (review) {
    await session.finish();
    await waitFor(() => load().status === "review", "review");
  }
  return { task, projectRoot, worktreePath, session, state, load, events };
}

test("agent_end is provisional through retries, compaction and wrapper settlement", async (t) => {
  const f = await taskFixture(t, { review: false });
  f.session.emit({ type: "message_end", message: assistant("error", "retryable") });
  f.session.emit({ type: "agent_end", messages: [assistant("error")], willRetry: true });
  f.session.emit({ type: "auto_retry_start" });
  await nextTurn();
  assert.equal(f.load().status, "running");
  f.session.emit({ type: "auto_retry_end", success: true });
  f.session.emit({ type: "agent_start" });
  f.session.emit({ type: "message_end", message: assistant() });
  f.session.emit({ type: "agent_end", messages: [assistant()], willRetry: false });
  f.session.emit({ type: "compaction_start" });
  f.session.emit({ type: "compaction_end" });
  f.session.emit({ type: "agent_settled" });
  await nextTurn();
  assert.equal(f.load().status, "running", "SDK settled is earlier than wrapper idle");
  f.session.emit({ type: "prompt_done" });
  await waitFor(() => f.load().status === "review");
  assert.equal(f.events().filter((event) => event.kind === "review").length, 1);
});

for (const stopReason of ["error", "aborted"]) {
  test(`normal ${stopReason} termination never enters review`, async (t) => {
    const f = await taskFixture(t, { review: false });
    await f.session.finish(stopReason);
    assert.equal(f.load().status, "failed");
    assert.equal(f.events().some((event) => event.kind === "review"), false);
    assert.equal(existsSync(join(f.worktreePath, "feature.txt")), true);
  });
}

test("cancel wins against abort's synchronous terminal events", async (t) => {
  const f = await taskFixture(t, { review: false });
  await engine.cancelTask(f.task.id, f.projectRoot);
  await drainGit();
  assert.equal(f.load().status, "canceled");
  assert.equal(f.events().some((event) => event.kind === "review"), false);
  assert.equal(f.session.listenerCount, 0);
});

for (const deleteWorktree of [false, true]) {
  test(`agent-assisted merge settles exactly once and deleteWorktree=${deleteWorktree}`, async (t) => {
    const f = await taskFixture(t);
    await engine.mergeTask(f.task.id, f.projectRoot, null, deleteWorktree);
    assert.equal(f.session.prompts.length, 2, "live merge must still use the agent to prepare the changes");
    f.session.emit({ type: "agent_end", messages: [assistant()] });
    await drainGit();
    assert.equal(f.load().status, "merging");
    assert.equal(existsSync(f.worktreePath), true);
    await f.session.finish();
    f.session.emit({ type: "prompt_done" });
    await waitFor(() => f.load().status !== "merging", "merge outcome");
    await drainGit();
    assert.equal(f.load().status, "done");
    assert.equal(readFileSync(join(f.projectRoot, "feature.txt"), "utf8"), "task output\n");
    const base = await engine.runGitCapture(f.projectRoot, ["rev-parse", "refs/heads/main"]);
    assert.ok(base.output.trim().startsWith(f.load().mergeCommit));
    assert.equal(f.events().filter((event) => event.kind === "merged").length, 1);
    assert.equal(existsSync(f.worktreePath), !deleteWorktree);
    const branch = await engine.runGitCapture(f.projectRoot, ["rev-parse", "--verify", `refs/heads/${f.load().workBranch}`]);
    assert.equal(branch.code === 0, !deleteWorktree);
    assert.ok(removals.every((args) => args[2] !== true), "cleanup must never use force");
    assert.equal(f.session.listenerCount, 0);
  });
}

for (const failure of ["error", "aborted", "prompt_error"]) {
  test(`merge ${failure} returns to review without deleting task output`, async (t) => {
    const f = await taskFixture(t, { committed: false });
    const base = await engine.runGitCapture(f.projectRoot, ["rev-parse", "refs/heads/main"]);
    await engine.mergeTask(f.task.id, f.projectRoot, null, true);
    if (failure === "prompt_error") {
      f.session.emit({ type: "prompt_error", errorMessage: "merge prompt rejected" });
      f.session.emit({ type: "prompt_done" });
    } else await f.session.finish(failure);
    await drainGit();
    assert.equal(f.load().status, "review");
    assert.match(f.load().lastError, /merge failed/i);
    assert.equal(f.load().mergeCommit, null);
    assert.equal(readFileSync(join(f.worktreePath, "feature.txt"), "utf8"), "task output\n");
    assert.equal((await engine.runGitCapture(f.projectRoot, ["rev-parse", "refs/heads/main"])).output, base.output);
    assert.equal(removals.length, 0);
  });
}

test("merge retry's agent_end does not clean up before final success", async (t) => {
  const f = await taskFixture(t);
  await engine.mergeTask(f.task.id, f.projectRoot, null, false);
  f.session.emit({ type: "message_end", message: assistant("error", "retryable") });
  f.session.emit({ type: "agent_end", messages: [assistant("error")], willRetry: true });
  f.session.emit({ type: "auto_retry_start" });
  await drainGit();
  assert.equal(f.load().status, "merging");
  assert.equal(existsSync(f.worktreePath), true);
  f.session.emit({ type: "auto_retry_end", success: true });
  f.session.emit({ type: "agent_start" });
  await f.session.finish();
  await waitFor(() => f.load().status !== "merging");
  await drainGit();
  assert.equal(f.load().status, "done");
  assert.equal(f.events().filter((event) => event.kind === "merged").length, 1);
});

test("a clean worktree HEAD is not proof of integration into the recorded base", async (t) => {
  const f = await taskFixture(t);
  await engine.runGitIn(f.projectRoot, ["checkout", "-qb", "unrelated"]);
  const mainBefore = await engine.runGitCapture(f.projectRoot, ["rev-parse", "refs/heads/main"]);
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  await drainGit();
  assert.equal(f.load().status, "review");
  assert.equal(f.load().mergeCommit, null);
  assert.match(f.load().lastError, /base|branch/i);
  assert.equal(existsSync(f.worktreePath), true);
  assert.equal((await engine.runGitCapture(f.projectRoot, ["rev-parse", "refs/heads/main"])).output, mainBefore.output);
});

test("successful agent text with uncommitted changes cannot complete the merge", async (t) => {
  const f = await taskFixture(t, { committed: false });
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  await drainGit();
  assert.equal(f.load().status, "review");
  assert.match(f.load().lastError, /uncommitted|dirty/i);
  assert.equal(existsSync(join(f.worktreePath, "feature.txt")), true);
  assert.equal(removals.length, 0);
});

test("old listener cannot settle or remove a newer run sharing the same session id", async (t) => {
  const f = await taskFixture(t);
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  const oldRun = f.state.byTask.get(f.task.id);
  const newRun = { ...oldRun, runSeq: oldRun.runSeq + 1 };
  f.state.live.set(newRun.connectionId, newRun);
  f.state.byTask.set(newRun.taskId, newRun);
  store.saveTask({ ...f.load(), runSeq: newRun.runSeq });
  await f.session.finish();
  f.session.emit({ type: "prompt_error", errorMessage: "old run failed" });
  await drainGit();
  assert.equal(f.load().status, "merging");
  assert.equal(f.load().runSeq, newRun.runSeq);
  assert.equal(f.state.byTask.get(newRun.taskId), newRun);
  assert.equal(existsSync(f.worktreePath), true);
  assert.equal(f.events().some((event) => event.kind === "merged"), false);
});

test("new dirty files appearing at cleanup are retained and the cleanup error is visible", async (t) => {
  const f = await taskFixture(t);
  beforeRemove = async () => writeFileSync(join(f.worktreePath, "late.txt"), "keep me\n");
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  await waitFor(() => f.load().status !== "merging");
  await drainGit();
  await waitFor(() => f.events().some((event) => event.kind === "cleanup_failed"), "cleanup warning");
  assert.equal(f.load().status, "done");
  assert.equal(readFileSync(join(f.worktreePath, "late.txt"), "utf8"), "keep me\n");
  assert.ok(f.load().lastError);
  assert.equal((await engine.runGitCapture(f.projectRoot, ["rev-parse", "--verify", `refs/heads/${f.load().workBranch}`])).code, 0);
});

for (const strategy of ["merge", "squash"]) {
  test(`no-live-session ${strategy} uses the recorded base and respects settings`, async (t) => {
    const f = await taskFixture(t);
    const source = (await engine.runGitCapture(f.worktreePath, ["rev-parse", "HEAD"])).output.trim();
    f.state.live.clear();
    f.state.byTask.clear();
    store.saveSettingsRow(f.projectRoot, { ...store.loadEffectiveSettings(f.projectRoot), mergeStrategy: strategy });
    await engine.mergeTask(f.task.id, f.projectRoot, "approved change", true);
    assert.equal(f.load().status, "done", f.load().lastError);
    assert.equal(readFileSync(join(f.projectRoot, "feature.txt"), "utf8"), "task output\n");
    const contained = await engine.runGitCapture(f.projectRoot, ["merge-base", "--is-ancestor", source, "refs/heads/main"]);
    assert.equal(contained.code, strategy === "merge" ? 0 : 1);
    assert.equal((await engine.runGitCapture(f.projectRoot, ["log", "-1", "--format=%s", "main"])).output.trim(), "approved change");
    assert.equal(existsSync(f.worktreePath), false);
    assert.equal(f.events().filter((event) => event.kind === "merged").length, 1);
  });
}

test("merge conflict preserves both branches and worktree for manual resolution", async (t) => {
  const f = await taskFixture(t);
  writeFileSync(join(f.projectRoot, "base.txt"), "main change\n");
  await engine.runGitIn(f.projectRoot, ["commit", "-qam", "main change"]);
  const baseBefore = (await engine.runGitCapture(f.projectRoot, ["rev-parse", "main"])).output;
  writeFileSync(join(f.worktreePath, "base.txt"), "task change\n");
  await engine.runGitIn(f.worktreePath, ["commit", "-qam", "task change"]);
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  await drainGit();
  assert.equal(f.load().status, "review");
  assert.match(f.load().lastError, /conflict/i);
  assert.equal((await engine.runGitCapture(f.projectRoot, ["rev-parse", "main"])).output, baseBefore);
  assert.equal(readFileSync(join(f.worktreePath, "base.txt"), "utf8"), "task change\n");
  assert.equal(existsSync(f.worktreePath), true);
  assert.equal(removals.length, 0);
});

test("cancellation while the base merge is queued prevents git mutations", async (t) => {
  const f = await taskFixture(t);
  let release;
  globalThis.__piTaskMergeLocks = new Map([[f.projectRoot, new Promise((resolve) => { release = resolve; })]]);
  t.after(() => { release(); delete globalThis.__piTaskMergeLocks; });
  const baseBefore = (await engine.runGitCapture(f.projectRoot, ["rev-parse", "main"])).output;
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  await engine.cancelTask(f.task.id, f.projectRoot);
  release();
  await drainGit();
  assert.equal(f.load().status, "canceled");
  assert.equal((await engine.runGitCapture(f.projectRoot, ["rev-parse", "main"])).output, baseBefore);
  assert.equal(existsSync(f.worktreePath), true);
  assert.equal(f.events().some((event) => event.kind === "merged"), false);
});

test("a superseded generation waiting on the merge lock cannot touch the base", async (t) => {
  const f = await taskFixture(t);
  let release;
  globalThis.__piTaskMergeLocks = new Map([[f.projectRoot, new Promise((resolve) => { release = resolve; })]]);
  t.after(() => { release(); delete globalThis.__piTaskMergeLocks; });
  await engine.mergeTask(f.task.id, f.projectRoot, null, true);
  await f.session.finish();
  const oldRun = f.state.byTask.get(f.task.id);
  const newRun = { ...oldRun, runSeq: oldRun.runSeq + 1 };
  f.state.byTask.set(f.task.id, newRun);
  f.state.live.set(newRun.connectionId, newRun);
  store.saveTask({ ...f.load(), runSeq: newRun.runSeq });
  release();
  await drainGit();
  assert.equal(f.load().status, "merging");
  assert.equal(f.state.byTask.get(f.task.id), newRun);
  assert.equal(existsSync(join(f.projectRoot, "feature.txt")), false);
  assert.equal(existsSync(f.worktreePath), true);
  assert.equal(removals.length, 0);
});

test("no-change completion rejects a stale filesChanged count instead of deleting dirty work", async (t) => {
  const f = await taskFixture(t, { committed: false });
  store.saveTask({ ...f.load(), filesChanged: 0 });
  await assert.rejects(engine.completeTask(f.task.id, f.projectRoot, true), /uncommitted|untracked|changes/i);
  assert.equal(f.load().status, "review");
  assert.equal(readFileSync(join(f.worktreePath, "feature.txt"), "utf8"), "task output\n");
});

for (const action of ["reconcile", "cancel"]) {
  test(`no-live merge waiting for the lock is owned during ${action}`, async (t) => {
    const f = await taskFixture(t, { realEngine: action === "reconcile" });
    f.state.live.clear();
    f.state.byTask.clear();
    let release;
    globalThis.__piTaskMergeLocks = new Map([[f.projectRoot, new Promise((resolve) => { release = resolve; })]]);
    const merging = engine.mergeTask(f.task.id, f.projectRoot, null, true);
    try {
      await nextTurn();
      assert.equal(f.load().status, "merging");
      if (action === "reconcile") {
        t.mock.timers.tick(30_000);
        await nextTurn();
        assert.equal(f.load().status, "merging", "a live deterministic merge is not a crashed agent");
      } else {
        await engine.cancelTask(f.task.id, f.projectRoot);
        assert.equal(f.load().status, "canceled");
      }
    } finally {
      release();
      await merging;
      await drainGit();
      delete globalThis.__piTaskMergeLocks;
    }
    assert.equal(f.load().status, action === "cancel" ? "canceled" : "done", f.load().lastError);
    if (action === "cancel") {
      assert.equal(existsSync(join(f.projectRoot, "feature.txt")), false);
      assert.equal(existsSync(f.worktreePath), true);
      assert.equal(removals.length, 0);
    }
  });
}
