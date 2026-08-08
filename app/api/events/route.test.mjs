import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("global events SSE subscribes to the session bus and heartbeats", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

  assert.match(source, /subscribeSessionBus\(/);
  assert.match(source, /const heartbeat = setInterval\(/);
  assert.match(source, /30_000/);
  assert.match(source, /req\.signal\.addEventListener\("abort", cleanup/);
  assert.match(source, /"Content-Type": "text\/event-stream"/);
});

test("global events SSE forwards bus events with sessionId intact", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

  const streamSource = source.slice(
    source.indexOf("start(controller)"),
    source.indexOf("return new Response(stream"),
  );
  assert.match(streamSource, /const unsubscribe = subscribeSessionBus\(/);
  assert.match(streamSource, /encode\(event\)/);
});
