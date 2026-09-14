import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRpcHarness, deferred, nextTurn } from "./rpc-test-harness.mjs";

function setup(t) {
  const h = createRpcHarness(t);
  const file = h.makeSession();
  const inner = h.makeInner(SessionManager.open(file, h.root));
  const wrapper = h.makeWrapper(inner);
  wrapper.start();
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const saved = () => h.queue.loadQueue(inner.sessionFile);
  const resume = async () => {
    await wrapper.send({ type: "stage_recovery", entries: [
      { kind: "steer", text: "A" },
      { kind: "followUp", text: "B", images: [{ type: "image", data: "ZmFrZQ==", mimeType: "image/png" }] },
    ] });
    const recovery = (await wrapper.send({ type: "export_queue" })).recovery;
    await wrapper.send({ type: "resolve_recovery", keep: recovery.map((entry) => entry.id), continueRun: true });
    await nextTurn();
  };
  const commitUser = (text) => {
    const message = { role: "user", content: text, timestamp: Date.now() };
    inner.emit({ type: "message_start", message });
    inner.emit({ type: "message_end", message });
    inner.sessionManager.appendMessage(message);
  };
  return { ...h, inner, wrapper, events, saved, resume, commitUser };
}

test("recovery bootstrap keeps every unaccepted entry durable when SDK preflight fails", async (t) => {
  const h = setup(t);
  const calls = [];
  h.inner.prompt = async (text, options) => {
    calls.push(text);
    options?.preflightResult?.(false);
    throw new Error("preflight authentication failed");
  };
  await h.resume();
  assert.deepEqual(calls, ["A"]);
  assert.deepEqual(h.saved().map((entry) => entry.text), ["A", "B"]);
  assert.deepEqual((await h.wrapper.send({ type: "get_state" })).pendingRecovery.map((entry) => entry.text), ["A", "B"]);
  assert.equal(h.saved()[1].images[0].data, "ZmFrZQ==");
  assert.equal(h.wrapper.isRunning(), false);
  assert.equal(h.events.filter((event) => event.type === "prompt_error").length, 1);
});

test("A durable transcript commit checkpoints only A; a crash restores B without automatically replaying it", async (t) => {
  const h = setup(t);
  const first = deferred();
  h.cleanups.push(() => first.resolve());
  h.inner.prompt = async (text, options) => {
    assert.equal(text, "A");
    options?.preflightResult?.(true);
    h.commitUser("A");
    h.inner.isStreaming = true;
    await first.promise;
  };
  await h.resume();
  assert.deepEqual(h.saved().map((entry) => entry.text), ["B"]);
  assert.ok(SessionManager.open(h.inner.sessionFile, h.root).getEntries().some((entry) => entry.type === "message" && entry.message.content === "A"));

  // Simulate process loss by constructing a fresh wrapper over the durable file,
  // without asking the original wrapper to serialize anything during teardown.
  const reopenedInner = h.makeInner();
  reopenedInner.sessionFile = h.inner.sessionFile;
  let replayed = false;
  reopenedInner.prompt = async () => { replayed = true; };
  const reopened = h.makeWrapper(reopenedInner);
  t.after(() => reopened.destroy());
  reopened.start();
  reopened.loadQueueRecovery();
  await nextTurn();
  assert.equal(replayed, false);
  assert.deepEqual((await reopened.send({ type: "get_state" })).pendingRecovery.map((entry) => entry.text), ["B"]);
});

test("B preflight failure after A completed preserves B and does not replay A", async (t) => {
  const h = setup(t);
  h.inner.prompt = async (text, options) => {
    options?.preflightResult?.(text === "A");
    if (text === "B") throw new Error("B rejected before acceptance");
    h.commitUser(text);
  };
  await h.resume();
  assert.deepEqual(h.saved().map((entry) => entry.text), ["B"]);
  assert.deepEqual((await h.wrapper.send({ type: "get_state" })).pendingRecovery.map((entry) => entry.text), ["B"]);
});

test("preflight and message_start leave A durable until delayed message_end persistence commits", async (t) => {
  const h = setup(t);
  const writing = deferred(), running = deferred();
  h.cleanups.push(() => { writing.resolve(); running.resolve(); });
  h.inner.prompt = async (_text, options) => {
    options.preflightResult(true);
    const message = { role: "user", content: "expanded A", timestamp: Date.now() };
    h.inner.emit({ type: "message_start", message });
    await writing.promise; // SDK message_end extension handler has not returned.
    h.inner.emit({ type: "message_end", message });
    h.inner.sessionManager.appendMessage(message);
    await running.promise;
  };
  await h.resume();
  assert.deepEqual(h.saved().map((entry) => entry.text), ["A", "B"]);
  assert.equal(SessionManager.open(h.inner.sessionFile, h.root).getEntries().length, 0);
  const reopened = h.makeWrapper(h.makeInner(SessionManager.open(h.inner.sessionFile, h.root)));
  reopened.loadQueueRecovery();
  assert.deepEqual((await reopened.send({ type: "get_state" })).pendingRecovery.map((entry) => entry.text), ["A", "B"]);
  writing.resolve();
  await nextTurn();
  assert.deepEqual(h.saved().map((entry) => entry.text), ["B"]);
  assert.ok(SessionManager.open(h.inner.sessionFile, h.root).getEntries().some((entry) => entry.type === "message" && entry.message.content === "expanded A"));
});

test("Stop after A is accepted prevents B from starting and retains B for explicit recovery", async (t) => {
  const h = setup(t);
  const running = deferred();
  h.cleanups.push(() => running.resolve());
  const calls = [];
  h.inner.prompt = async (text, options) => {
    calls.push(text);
    options?.preflightResult?.(true);
    if (text === "A") {
      h.commitUser(text);
      h.inner.isStreaming = true;
      await running.promise;
      h.inner.isStreaming = false;
    }
  };
  h.inner.abort = async () => { h.inner.isStreaming = false; running.resolve(); };
  await h.resume();
  await h.wrapper.send({ type: "abort" });
  await nextTurn();
  assert.deepEqual(calls, ["A"]);
  assert.deepEqual(h.saved().map((entry) => entry.text), ["B"]);
  assert.equal(h.wrapper.isRunning(), false);
});

test("Stop during preflight retains both entries even if SDK validation finishes later", async (t) => {
  const h = setup(t);
  const preflight = deferred();
  t.after(() => preflight.resolve());
  const dispatched = [];
  h.inner.prompt = async (text, options) => {
    await preflight.promise;
    options.preflightResult(true);
    dispatched.push(text);
  };
  await h.resume();
  await h.wrapper.send({ type: "abort" });
  preflight.resolve();
  await nextTurn();
  assert.deepEqual(dispatched, []);
  assert.deepEqual(h.saved().map((entry) => entry.text), ["A", "B"]);
});

test("recovery checkpoints do not overwrite concurrent user follow-up messages or images", async (t) => {
  const h = setup(t);
  const preflight = deferred(), running = deferred();
  h.cleanups.push(() => { preflight.resolve(); running.resolve(); });
  h.inner.prompt = async (_text, options) => {
    await preflight.promise;
    options?.preflightResult?.(true);
    h.commitUser("A");
    h.inner.isStreaming = true;
    await running.promise;
  };
  await h.resume();
  const images = [{ type: "image", data: "dXNlcg==", mimeType: "image/png" }];
  await h.wrapper.send({ type: "follow_up", message: "parallel C", images });
  assert.deepEqual(h.saved().map((entry) => entry.text), ["A", "B", "parallel C"]);
  preflight.resolve();
  await nextTurn();
  assert.deepEqual(h.saved().map((entry) => entry.text), ["B", "parallel C"]);
  assert.deepEqual(h.saved().find((entry) => entry.text === "parallel C").images, images);
  assert.deepEqual(h.inner.getFollowUpMessages(), ["parallel C"]);
});
