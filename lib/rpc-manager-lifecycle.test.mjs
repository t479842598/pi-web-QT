import assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import { createRpcHarness, deferred, nextTurn } from "./rpc-test-harness.mjs";

const deleteRequest = (id) => [new Request(`http://test/api/sessions/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) }];

test("continuous get_state/get_goal_state polling cannot postpone the Stop cleanup deadline", async (t) => {
  const h = createRpcHarness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const inner = h.makeInner();
  inner.isStreaming = true;
  const stop = deferred();
  inner.abort = () => stop.promise;
  const wrapper = h.makeWrapper(inner);
  t.after(() => { stop.resolve(); wrapper.destroy(); });
  wrapper.start();
  const stopping = wrapper.send({ type: "abort" });
  await nextTurn();
  for (let minute = 0; minute < 10; minute++) {
    t.mock.timers.tick(59_000);
    await wrapper.send({ type: "get_state" });
    await wrapper.send({ type: "get_goal_state" });
    t.mock.timers.tick(1000);
    await nextTurn();
  }
  assert.equal(wrapper.isAlive(), false);
  stop.resolve();
  await stopping;
});

for (const stage of ["services", "create", "preferences"]) {
  test(`DELETE fences startup paused at ${stage} and rejects admission without resurrecting files`, async (t) => {
    const h = createRpcHarness(t);
    const id = `delete-${stage}`;
    const file = h.makeSession(id);
    h.queue.saveQueue(file, [h.queue.createQueueEntry("steer", "pending")]);
    const goalEngine = new h.goal.GoalEngine();
    goalEngine.start("do not resume a deleted goal");
    h.goal.saveGoalState(file, goalEngine.getState());
    const gate = deferred();
    let lateInner;
    if (stage === "services") h.createServices = async () => { await gate.promise; return h.services; };
    if (stage === "create") h.createSession = async (options) => {
      await gate.promise;
      // Model/thinking restoration inside the SDK can append before it returns.
      options.sessionManager.appendThinkingLevelChange("off");
      lateInner = h.makeInner(options.sessionManager);
      return { session: lateInner };
    };
    if (stage === "preferences") h.persistPreferences = async () => { await gate.promise; return { modelDefaultChanged: false }; };
    const startResult = h.rpc.startRpcSession(id, file, undefined).then((value) => ({ value }), (error) => ({ error }));
    await nextTurn();
    const { DELETE } = h.loadRoute();
    const deleting = DELETE(...deleteRequest(id));
    await nextTurn();
    const lateStart = h.rpc.startRpcSession(id, file, undefined).then((value) => ({ value }), (error) => ({ error }));
    gate.resolve();
    const response = await deleting;
    assert.equal(response.status, 200);
    const results = await Promise.all([startResult, lateStart]);
    assert.ok(results.every((result) => result.error), "both old and newly admitted startup attempts must fail");
    await nextTurn();
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(h.queue.queueSidecarPath(file)), false);
    assert.equal(fs.existsSync(h.goal.goalSidecarPath(file)), false);
    assert.equal(h.rpc.getRpcSession(id), undefined);
    assert.equal(globalThis.__piStartLocks.has(id), false);
    if (lateInner) assert.ok(h.calls.disposed.includes(lateInner));
    if (stage === "services") assert.equal(h.calls.create.length, 0, "abandoned service initialization cannot enter SDK create");
  });
}

test("DELETE rejects live-wrapper commands and late SDK writes after shutdown cannot recreate state", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("live-delete");
  const { session } = await h.rpc.startRpcSession("live-delete", file, undefined);
  const gate = deferred();
  session.inner.extensionRunner.emit = () => gate.promise;
  const deleting = h.loadRoute().DELETE(...deleteRequest("live-delete"));
  await nextTurn();
  await assert.rejects(session.send({ type: "stage_recovery", entries: [{ kind: "steer", text: "late" }] }), /deleted|changed|shutting down/);
  gate.resolve();
  assert.equal((await deleting).status, 200);
  session.inner.sessionManager.appendThinkingLevelChange("off");
  session.persistSessionFileIfMissing();
  assert.equal(fs.existsSync(file), false);
  assert.equal(h.queue.loadQueue(file).length, 0);
});

test("a prompt already in preflight cannot begin a run after its session is deleted", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("pending-prompt-delete");
  const { session } = await h.rpc.startRpcSession("pending-prompt-delete", file, undefined);
  const preflight = deferred();
  let dispatched = false;
  session.inner.prompt = async (_text, options) => {
    await preflight.promise;
    options.preflightResult(true);
    dispatched = true;
  };
  const rejected = assert.rejects(session.send({ type: "prompt", message: "pending" }), /shutting down|deleted/);
  await nextTurn();
  assert.equal((await h.loadRoute().DELETE(...deleteRequest("pending-prompt-delete"))).status, 200);
  preflight.resolve();
  await rejected;
  assert.equal(dispatched, false);
  assert.equal(fs.existsSync(file), false);
});

test("an explicit missing session path is not reinterpreted by the SDK as a fresh session", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("missing");
  fs.unlinkSync(file);
  await assert.rejects(h.rpc.startRpcSession("missing", file, undefined), /not found|deleted|missing/i);
  assert.equal(fs.existsSync(file), false);
  assert.equal(h.calls.services.length, 0);
});

test("hard timeout cleanup cannot remove the replacement startup lock after the old services settle", async (t) => {
  const h = createRpcHarness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const file = h.makeSession("timeout-lock");
  const first = deferred(), second = deferred();
  h.createServices = async () => {
    await (h.calls.services.length === 1 ? first.promise : second.promise);
    return h.services;
  };
  const firstResult = h.rpc.startRpcSession("timeout-lock", file, undefined).then((value) => ({ value }), (error) => ({ error }));
  await nextTurn();
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.ok((await firstResult).error);
  const replacing = h.rpc.startRpcSession("timeout-lock", file, undefined);
  const replacementLock = globalThis.__piStartLocks.get("timeout-lock");
  assert.ok(replacementLock);
  first.resolve();
  await nextTurn();
  assert.equal(globalThis.__piStartLocks.get("timeout-lock"), replacementLock);
  assert.equal(h.calls.create.length, 0);
  second.resolve();
  const { session } = await replacing;
  await session.shutdown();
});

test("timed-out SDK create disposes late inner and does not persist startup preferences", async (t) => {
  const h = createRpcHarness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const file = h.makeSession("timeout-create");
  const gate = deferred();
  let lateInner;
  h.createSession = async (options) => {
    await gate.promise;
    lateInner = h.makeInner(options.sessionManager);
    return { session: lateInner };
  };
  const result = h.rpc.startRpcSession("timeout-create", file, undefined).then((value) => ({ value }), (error) => ({ error }));
  await nextTurn();
  t.mock.timers.tick(40_000);
  await nextTurn();
  assert.ok((await result).error);
  gate.resolve();
  await nextTurn();
  assert.ok(h.calls.disposed.includes(lateInner));
  assert.equal(h.calls.preferences, 0);
  assert.equal(h.calls.cleanup, 1);
  assert.equal(h.rpc.getRpcSession("timeout-create"), undefined);
});

test("parent DELETE also fences in-flight subagents and reparents ordinary forks after startup cancellation", async (t) => {
  const h = createRpcHarness(t);
  const grandparent = h.makeSession("grandparent");
  const parent = h.makeSession("parent", { parentSession: grandparent });
  const child = h.makeSession("subagent");
  h.sessions.find((entry) => entry.id === "subagent").relation = { kind: "subagent", parentSessionId: "parent" };
  const fork = h.makeSession("fork", { parentSession: parent, parentSessionId: "parent" });
  const gate = deferred();
  h.createServices = async () => { await gate.promise; return h.services; };
  const starting = ["parent", "subagent", "fork"].map((id) => h.rpc.startRpcSession(id, h.paths.get(id), undefined).then((value) => ({ value }), (error) => ({ error })));
  await nextTurn();
  const deleting = h.loadRoute().DELETE(...deleteRequest("parent"));
  await nextTurn();
  gate.resolve();
  assert.equal((await deleting).status, 200);
  const results = await Promise.all(starting);
  assert.ok(results.every((result) => result.error));
  assert.equal(fs.existsSync(parent), false);
  assert.equal(fs.existsSync(child), false);
  assert.equal(JSON.parse(fs.readFileSync(fork, "utf8").split("\n")[0]).parentSession, grandparent);
  // The reparent barrier is temporary, unlike a deletion tombstone.
  const reopened = await h.rpc.startRpcSession("fork", fork, undefined);
  await reopened.session.shutdown();
});

test("ordinary shutdown preserves late accepted message persistence", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("ordinary-shutdown");
  const { session } = await h.rpc.startRpcSession("ordinary-shutdown", file, undefined);
  await session.shutdown();
  session.inner.sessionManager.appendMessage({ role: "user", content: "accepted before shutdown", timestamp: Date.now() });
  assert.ok(fs.readFileSync(file, "utf8").includes("accepted before shutdown"));
});

test("reparent waits for a child's accepted message_end callback before replacing its header", async (t) => {
  const h = createRpcHarness(t);
  const grandparent = h.makeSession("drain-grandparent");
  const parent = h.makeSession("drain-parent", { parentSession: grandparent });
  const fork = h.makeSession("drain-fork", { parentSession: parent, parentSessionId: "drain-parent" });
  const { session } = await h.rpc.startRpcSession("drain-fork", fork, undefined);
  const write = deferred();
  let aborted = false;
  session.inner.isStreaming = true;
  const messageEnd = write.promise.then(() => {
    session.inner.sessionManager.appendMessage({ role: "user", content: "accepted tail", timestamp: Date.now() });
    session.inner.isStreaming = false;
  });
  session.inner.abort = async () => { aborted = true; await messageEnd; };
  let deleted = false;
  const deleting = h.loadRoute().DELETE(...deleteRequest("drain-parent")).then((response) => { deleted = true; return response; });
  await nextTurn();
  assert.equal(aborted, true);
  assert.equal(deleted, false);
  write.resolve();
  assert.equal((await deleting).status, 200);
  const content = fs.readFileSync(fork, "utf8");
  assert.ok(content.includes("accepted tail"));
  assert.equal(JSON.parse(content.split("\n")[0]).parentSession, grandparent);
});

test("a blocked deletion does not serialize unrelated session startup", async (t) => {
  const h = createRpcHarness(t);
  const file = h.makeSession("deleting");
  const otherFile = h.makeSession("unrelated");
  const gate = deferred();
  h.createServices = async () => { if (h.calls.services.length === 1) await gate.promise; return h.services; };
  const pending = h.rpc.startRpcSession("deleting", file, undefined).catch(() => undefined);
  await nextTurn();
  const deleting = h.loadRoute().DELETE(...deleteRequest("deleting"));
  await nextTurn();
  const other = await h.rpc.startRpcSession("unrelated", otherFile, undefined);
  assert.equal(other.realSessionId, "unrelated");
  await other.session.shutdown();
  gate.resolve();
  await pending;
  assert.equal((await deleting).status, 200);
});
