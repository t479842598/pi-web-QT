import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const { hasActiveSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
const decoder = new TextDecoder();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function readWithin(reader, timeoutMs = 1_000) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out reading SSE chunk")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeData(chunk) {
  const text = decoder.decode(chunk.value);
  assert.match(text, /^data: /);
  return JSON.parse(text.slice("data: ".length));
}

test("opens the transport before a slow session is ready and snapshots after subscribing", async () => {
  const startup = deferred();
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  const transport = await readWithin(reader);
  assert.equal(decoder.decode(transport.value), ":\n\n");

  const snapshot = { role: "assistant", content: [{ type: "text", text: "Hello" }] };
  let listener;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  startup.resolve({
    isStreaming: true,
    streamingMessage: snapshot,
    onEvent(nextListener) {
      subscribeCount += 1;
      listener = nextListener;
      nextListener({
        type: "message_update",
        message: snapshot,
        assistantMessageEvent: { type: "text_delta", delta: "ignored" },
      });
      nextListener({ type: "agent_start" });
      return () => { unsubscribeCount += 1; };
    },
  });

  const connected = decodeData(await readWithin(reader));
  const messageStart = decodeData(await readWithin(reader));
  const replayedEvent = decodeData(await readWithin(reader));
  assert.equal(subscribeCount, 1);
  assert.deepEqual(connected, {
    type: "connected",
    sessionId: "session-id",
    isStreaming: true,
  });
  assert.deepEqual(messageStart, { type: "agent_start" });
  assert.deepEqual(replayedEvent, { type: "message_start", message: snapshot });
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), true);

  listener({
    type: "message_update",
    message: { ...snapshot },
    assistantMessageEvent: {
      type: "text_delta",
      delta: "!",
      partial: { ...snapshot },
    },
  });
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "!" },
  });

  abortController.abort();
  assert.equal(unsubscribeCount, 1);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
  assert.equal((await readWithin(reader)).done, true);
});

test("reports a startup failure in-band after opening the transport", async () => {
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    Promise.reject(new Error("broken config")),
  );
  const reader = stream.getReader();

  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "startup_error",
    errorMessage: "Failed to start agent: broken config",
  });
  assert.equal((await readWithin(reader)).done, true);
});

test("does not subscribe when the client cancels during startup", async () => {
  const startup = deferred();
  let subscribeCount = 0;
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  await readWithin(reader);
  await reader.cancel();
  startup.resolve({
    isStreaming: false,
    streamingMessage: undefined,
    onEvent() {
      subscribeCount += 1;
      return () => {};
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(subscribeCount, 0);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
});

test("session_shutdown from a live wrapper closes the SSE stream", async () => {
  const abortController = new AbortController();
  let listener;
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    Promise.resolve({
      isStreaming: false,
      streamingMessage: undefined,
      isAlive: () => true,
      onEvent(nextListener) {
        listener = nextListener;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader);
  decodeData(await readWithin(reader));
  listener({ type: "session_shutdown" });
  assert.equal((await readWithin(reader)).done, true);
});

test("does not subscribe when the wrapper died before the snapshot", async () => {
  let subscribeCount = 0;
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    Promise.resolve({
      isStreaming: false,
      streamingMessage: undefined,
      isAlive: () => false,
      onEvent() {
        subscribeCount += 1;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader);
  assert.equal((await readWithin(reader)).done, true);
  assert.equal(subscribeCount, 0);
});

test("closes an already-aborted request and handles a later startup rejection", async () => {
  const abortController = new AbortController();
  abortController.abort();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    Promise.reject(new Error("startup failed after disconnect")),
  );

  assert.equal((await readWithin(stream.getReader())).done, true);
  await new Promise((resolve) => setImmediate(resolve));
});

// ── Per-client backpressure ──────────────────────────────────────────────────

const BIG_PAYLOAD = "x".repeat(120_000);

async function connectedStream(sessionId) {
  const abortController = new AbortController();
  let listener;
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    sessionId,
    Promise.resolve({
      isStreaming: false,
      streamingMessage: undefined,
      isAlive: () => true,
      onEvent(nextListener) {
        listener = nextListener;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader); // the ":\\n\\n" transport preamble
  decodeData(await readWithin(reader)); // "connected"
  return { reader, listener, abortController };
}

async function withBacklogLimit(bytes, run) {
  const previous = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(bytes);
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = previous;
  }
}

function messageUpdate(assistantMessageEvent) {
  return { type: "message_update", message: { role: "assistant", content: [] }, assistantMessageEvent };
}

test("terminates the stream when an unread, non-rebuildable backlog exceeds the limit", async () => {
  await withBacklogLimit(64 * 1024, async () => {
    const { reader, listener } = await connectedStream("backlog-session");

    // Stop reading: message snapshots cannot be rebuilt client-side, so they
    // must hit the hard limit instead of being dropped.
    const message = { role: "assistant", content: [{ type: "text", text: BIG_PAYLOAD }] };
    for (let index = 0; index < 8; index += 1) listener({ type: "message_start", message });

    await assert.rejects(async () => {
      for (;;) {
        const next = await readWithin(reader);
        if (next.done) return;
      }
    }, /client backlog exceeded/);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "backlog-session" }), false);
  });
});

test("drops rebuildable deltas while the client is behind instead of disconnecting it", async () => {
  await withBacklogLimit(8 * 1024 * 1024, async () => {
    const { reader, listener, abortController } = await connectedStream("behind-session");

    const emitted = 40;
    for (let index = 0; index < emitted; index += 1) {
      listener(messageUpdate({ type: "text_delta", contentIndex: 0, delta: BIG_PAYLOAD }));
    }
    listener({ type: "agent_end" });

    // Whatever was queued before the water mark is still delivered, minus the dropped deltas.
    let delivered = 0;
    let sawSentinel = false;
    while (!sawSentinel) {
      const next = await readWithin(reader);
      assert.equal(next.done, false);
      if (decodeData(next).type === "agent_end") sawSentinel = true;
      else delivered += 1;
    }
    assert.ok(delivered > 0 && delivered < emitted, `expected drops, delivered ${delivered} of ${emitted}`);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "behind-session" }), true);

    // …and the stream stays usable once the client catches up.
    listener(messageUpdate({ type: "text_delta", contentIndex: 0, delta: "!" }));
    const afterCatchUp = await readWithin(reader);
    assert.equal(afterCatchUp.done, false);
    assert.equal(decodeData(afterCatchUp).type, "message_update");
    abortController.abort();
  });
});

test("keeps the start and end of a streamed block while dropping its deltas", async () => {
  await withBacklogLimit(8 * 1024 * 1024, async () => {
    const { reader, listener, abortController } = await connectedStream("block-session");

    listener(messageUpdate({ type: "text_start", contentIndex: 0 }));
    for (let index = 0; index < 40; index += 1) {
      listener(messageUpdate({ type: "text_delta", contentIndex: 0, delta: BIG_PAYLOAD }));
    }
    listener(messageUpdate({ type: "text_end", contentIndex: 0, content: "final text" }));
    listener({ type: "agent_end" });

    const kinds = [];
    for (;;) {
      const event = decodeData(await readWithin(reader));
      if (event.type === "agent_end") break;
      kinds.push(event.assistantMessageEvent.type);
    }
    assert.equal(kinds[0], "text_start");
    assert.equal(kinds.at(-1), "text_end");
    assert.ok(kinds.length < 42, `expected dropped deltas, got ${kinds.length} events`);
    abortController.abort();
  });
});
