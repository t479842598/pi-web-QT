import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-subagent-runtime-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});
const { createSubagentController } = await createJiti(import.meta.url).import("./subagent-runtime.ts");

function completedRun() {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
}

test("completion notification reopens an idle parent and uses its current session", async () => {
  const delivered = [];
  const reopened = [];
  let ready = false;
  let parent;
  const liveParent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => { ready = true; },
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async (sessionId, sessionFile) => {
      reopened.push([sessionId, sessionFile]);
      parent = liveParent;
      return liveParent;
    },
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  await controller.extensionRuntime.notifyParent(completedRun());

  assert.deepEqual(reopened, [["parent-session", "/tmp/parent.jsonl"]]);
  assert.equal(ready, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.content, "Parser found");
  assert.equal(delivered[0].message.details.sessionId, "child-session");
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("disabled built-in subagents reject stale Agent calls before starting", async () => {
  const controller = createSubagentController({
    getSession: () => { throw new Error("must not inspect a parent"); },
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => false,
  });

  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /built-in sub-agents are disabled/,
  );
});

test("resume reuses the persisted child session and keeps its session id", async () => {
  const calls = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: async (task) => { calls.push(task); },
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  const result = await execution.completion;
  assert.equal(execution.run.sessionId, "child");
  assert.equal(result.sessionId, "child");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["continue this"]);
});

test("resume rejects a child owned by another parent", async () => {
  const controller = createSubagentController({
    getSession: (id) => id === "parent" ? { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} } : undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  await assert.rejects(controller.extensionRuntime.resume({
    parentContext: { sessionManager: { getSessionId: () => "parent" } },
    parentToolCallId: "call",
    sessionId: "missing",
    task: "continue",
    description: "Continue",
  }), /Subagent not found/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function runtimeFixture(t, options = {}) {
  delete globalThis.__piSubagentRuns;
  delete globalThis.__piSubagentQueue;
  const counts = { services: 0, sessions: 0, registrations: 0, prompts: 0, modelRuns: 0, aborts: 0, disposed: 0, worktrees: 0, cleanup: 0, reopened: 0, notifications: 0, writesAfterShutdown: 0 };
  const updates = [];
  const signal = new AbortController();
  const reached = deferred();
  const released = deferred();
  const promptDone = deferred();
  const entries = [];
  const persisted = [];
  let shutdown = false;
  const turnListeners = new Set();
  const manager = {
    getSessionId: () => "child",
    getSessionFile: () => join(agentDir, "child.jsonl"),
    getEntries: () => entries,
    appendCustomEntry: (customType, data) => {
      const entry = { type: "custom", customType, data };
      entries.push(entry);
      if (!shutdown) persisted.push(entry);
      else counts.writesAfterShutdown += 1;
    },
    appendSessionInfo: () => {},
  };
  const parent = {
    sessionFile: join(agentDir, "parent.jsonl"), cwd: agentDir,
    isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {},
    inner: { sessionManager: { getSessionId: () => "parent", buildSessionContext: () => ({ messages: [] }) }, modelRuntime: {}, agent: { state: {} } },
  };
  const inner = {
    sessionId: "child", sessionFile: manager.getSessionFile(), sessionManager: manager, agent: { state: {} },
    subscribe: (listener) => { turnListeners.add(listener); return () => turnListeners.delete(listener); },
    async prompt(_task, promptOptions) {
      counts.prompts += 1;
      if (options.delay === "preflight") await gate("preflight");
      promptOptions?.preflightResult?.(true);
      counts.modelRuns += 1;
      if (options.promptError) throw new Error("model failed independently");
      if (options.holdPrompt) await promptDone.promise;
    },
    getLastAssistantText: () => "child result",
    abort: async () => { counts.aborts += 1; promptDone.resolve(); },
    steer: async () => {},
    dispose: () => { counts.disposed += 1; },
  };
  const child = {
    inner, sessionFile: inner.sessionFile, cwd: agentDir,
    isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {},
    shutdown: async () => { shutdown = true; inner.dispose(); },
  };
  const profile = {
    name: "explore", displayName: "Explore", tools: ["read"], systemPrompt: "Test agent",
    loadSkills: false, loadExtensions: false, runInBackground: options.backgroundDefault ?? false,
    promptMode: "append", inheritContext: false, maxTurns: 2,
  };
  async function gate(stage) {
    if (options.delay !== stage) return;
    reached.resolve();
    await released.promise;
    if (options.setupError) throw new Error(`failed ${stage}`);
  }
  let childAvailable = !options.resume;
  if (options.resume) {
    entries.push({ type: "custom", customType: "pi-web:subagent", data: {
      version: 1, parentSessionId: "parent", parentSessionPath: parent.sessionFile,
      parentToolCallId: "old-call", profile: "explore", description: "old task", task: "old",
      runInBackground: profile.runInBackground, createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } }, { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z",
    } });
  }
  const actualSubagents = await createJiti(import.meta.url).import("./subagents.ts");
  const { createSubagentController: create } = await createJiti(import.meta.url, {
    moduleCache: false,
    virtualModules: {
      "@earendil-works/pi-coding-agent": {
        getAgentDir: () => agentDir,
        initTheme: () => {},
        defineTool: (tool) => tool,
        SettingsManager: { create: () => ({ getDefaultTools: () => ["read"] }) },
        SessionManager: { create: () => manager, open: () => manager },
        createAgentSessionServices: async () => {
          counts.services += 1;
          await gate("services");
          return { resourceLoader: { getExtensions: () => ({ extensions: [] }) } };
        },
        createAgentSessionFromServices: async () => {
          counts.sessions += 1;
          await gate("session");
          return { session: inner };
        },
      },
      "./subagents": { ...actualSubagents, resolveSubagentProfile: () => profile },
      "./worktree": {
        addWorktree: async () => {
          counts.worktrees += 1;
          await gate("worktree");
          return { path: join(agentDir, "worktree"), branch: "child-branch" };
        },
        removeWorktree: async () => {
          counts.cleanup += 1;
          if (options.cleanupError) throw new Error("dirty worktree");
        },
      },
      "./subagent-settings": {
        isBuiltInSubagentsEnabled: () => true,
        readSubagentSettings: () => ({ maxConcurrent: 1 }),
      },
    },
  }).import("./subagent-runtime.ts");
  const controller = create({
    getSession: (id) => id === "parent" ? parent : childAvailable ? child : undefined,
    registerSession: () => { counts.registrations += 1; childAvailable = true; },
    reopenSession: async () => {
      counts.reopened += 1;
      await gate("reopen");
      childAvailable = true;
      return child;
    },
    resolveSessionPath: async () => { await gate("resolve"); return manager.getSessionFile(); },
    invalidateSessionList: () => {},
    notifyRunningChange: () => { counts.notifications += 1; },
    isBuiltInSubagentsEnabled: () => true,
  });
  const request = {
    parentContext: parent.inner, parentToolCallId: "call", profile: "explore", sessionId: "child",
    task: "work", description: "Test", signal: signal.signal,
    ...(options.isolation ? { isolation: "worktree" } : {}),
    ...(options.runInBackground !== undefined ? { runInBackground: options.runInBackground } : {}),
    onUpdate: (run) => { updates.push(run); options.onUpdate?.(run, signal); },
  };
  const resultEntries = () => entries.filter((entry) => entry.customType === "pi-web:subagent-result").slice(options.resume ? 1 : 0);
  const launch = () => controller.extensionRuntime[options.resume ? "resume" : "start"](request);
  t.after(async () => {
    released.resolve();
    promptDone.resolve();
    await nextTurn();
    delete globalThis.__piSubagentRuns;
    delete globalThis.__piSubagentQueue;
  });
  return { controller, launch, request, counts, signal, updates, reached, released, promptDone, resultEntries, turnListeners,
    persistedResults: () => persisted.filter((entry) => entry.customType === "pi-web:subagent-result"),
  };
}

async function canceledSetup(pending) {
  let execution;
  try { execution = await pending; } catch (error) {
    assert.equal(error.name, "AbortError");
    return;
  }
  assert.equal((await execution.completion).status, "aborted");
}

for (const resume of [false, true]) {
  test(`${resume ? "resume" : "start"} rejects a pre-aborted foreground request before setup`, async (t) => {
    const f = await runtimeFixture(t, { resume, isolation: true });
    f.signal.abort();
    await canceledSetup(f.launch());
    assert.equal(f.counts.services + f.counts.sessions + f.counts.worktrees + f.counts.reopened + f.counts.prompts, 0);
    assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
  });
}

for (const stage of ["worktree", "services", "session"]) {
  test(`foreground cancellation during ${stage} prevents downstream work and releases resources`, async (t) => {
    const f = await runtimeFixture(t, { delay: stage, isolation: true });
    const pending = f.launch();
    await f.reached.promise;
    f.signal.abort();
    f.released.resolve();
    await canceledSetup(pending);
    assert.equal(f.counts.prompts, 0);
    assert.equal(f.counts.cleanup, 1);
    if (stage === "worktree") assert.equal(f.counts.services, 0);
    if (stage === "services") assert.equal(f.counts.sessions, 0);
    if (stage === "session") assert.equal(f.counts.disposed, 1);
    assert.equal(f.counts.registrations, 0);
    assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
    assert.equal(f.turnListeners.size, 0);
    assert.equal(globalThis.__piSubagentRuns?.size ?? 0, 0);
  });
}

for (const stage of ["resolve", "reopen"]) {
  test(`resume cancellation during ${stage} never prompts the reopened session`, async (t) => {
    const f = await runtimeFixture(t, { resume: true, delay: stage });
    const pending = f.launch();
    await f.reached.promise;
    f.signal.abort();
    f.released.resolve();
    await canceledSetup(pending);
    assert.equal(f.counts.prompts, 0);
    assert.equal(f.counts.reopened, stage === "resolve" ? 0 : 1);
    if (stage === "reopen") assert.equal(f.counts.disposed, 1);
    assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
  });
}

for (const resume of [false, true]) {
  test(`${resume ? "resume" : "start"} observes cancellation inside the initial queued update`, async (t) => {
    const f = await runtimeFixture(t, {
      resume, isolation: !resume,
      onUpdate: (run, signal) => { if (run.status === "queued") signal.abort(); },
    });
    const execution = await f.launch();
    assert.equal((await execution.completion).status, "aborted");
    assert.equal(f.counts.prompts, 0);
    assert.equal(f.resultEntries().length, 1);
    assert.equal(f.updates.filter((run) => run.status === "aborted").length, 1);
    assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
    assert.equal(f.turnListeners.size, 0);
  });
}

for (const resume of [false, true]) {
  test(`${resume ? "resume" : "start"} queued cancellation completes once and detaches all listeners`, async (t) => {
    const f = await runtimeFixture(t, { resume, isolation: !resume, cleanupError: !resume });
    const { SubagentQueue } = await createJiti(import.meta.url).import("./subagent-queue.ts");
    const blocker = deferred();
    globalThis.__piSubagentQueue = new SubagentQueue();
    const first = globalThis.__piSubagentQueue.enqueue("parent", 1, () => blocker.promise, () => {});
    t.after(() => blocker.resolve());
    const execution = await f.launch();
    assert.equal(execution.run.status, "queued");
    f.signal.abort();
    const result = await execution.completion;
    assert.equal(result.status, "aborted");
    assert.equal(f.counts.prompts, 0);
    assert.equal(f.resultEntries().length, 1);
    assert.equal(f.updates.filter((run) => run.status === "aborted").length, 1);
    if (!resume) assert.match(result.worktreeCleanupError, /dirty worktree/);
    assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
    assert.equal(f.turnListeners.size, 0);
    assert.equal(globalThis.__piSubagentRuns.size, 0);
    blocker.resolve();
    await first.promise;
    await nextTurn();
    assert.equal(f.counts.prompts, 0);
  });
}

for (const resume of [false, true]) {
  for (const promptError of [false, true]) {
    test(`${resume ? "resume" : "start"} background setup ignores foreground abort (promptError=${promptError})`, async (t) => {
      const stage = resume ? "reopen" : "services";
      const f = await runtimeFixture(t, { resume, delay: stage, runInBackground: true, promptError });
      const pending = f.launch();
      await f.reached.promise;
      f.signal.abort();
      f.released.resolve();
      const result = await (await pending).completion;
      assert.equal(result.status, promptError ? "failed" : "completed");
      if (promptError) assert.match(result.error, /model failed/);
      assert.equal(f.counts.prompts, 1);
      assert.equal(f.counts.aborts, 0);
      assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
    });
  }
}

test("setup error after cancellation removes the abort listener and reports AbortError", async (t) => {
  const f = await runtimeFixture(t, { delay: "services", isolation: true, setupError: true });
  const pending = f.launch();
  await f.reached.promise;
  f.signal.abort();
  f.released.resolve();
  await canceledSetup(pending);
  assert.equal(f.counts.cleanup, 1);
  assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
});

for (const resume of [false, true]) {
  for (const runInBackground of [false, true]) {
    test(`${resume ? "resume" : "start"} delayed preflight observes cancellation (background=${runInBackground})`, async (t) => {
      const f = await runtimeFixture(t, { resume, delay: "preflight", runInBackground });
      const execution = await f.launch();
      await f.reached.promise;
      f.signal.abort();
      f.released.resolve();
      const result = await execution.completion;
      assert.equal(result.status, runInBackground ? "completed" : "aborted");
      assert.equal(f.counts.modelRuns, runInBackground ? 1 : 0, "abort before SDK activeRun exists must not call the model later");
      assert.equal(f.counts.aborts, runInBackground ? 0 : 1);
      assert.equal(f.persistedResults().length, 1);
      assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
    });
  }
}

for (const cleanupError of [false, true]) {
  test(`result is persisted before shutdown revokes writes (cleanupError=${cleanupError})`, async (t) => {
    const f = await runtimeFixture(t, { isolation: true, cleanupError });
    const result = await (await f.launch()).completion;
    assert.equal(result.status, "completed");
    assert.equal(f.persistedResults().length, 1);
    assert.equal(f.persistedResults()[0].data.status, "completed");
    assert.equal(f.persistedResults()[0].data.worktreeCleanupError, result.worktreeCleanupError);
    if (cleanupError) assert.match(result.worktreeCleanupError, /dirty worktree/);
    assert.equal(f.counts.writesAfterShutdown, 0);
    assert.equal(f.counts.disposed, 1);
  });
}
