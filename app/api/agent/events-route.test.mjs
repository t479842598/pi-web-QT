import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");

test("agent SSE omits unconsumed events and projects only client fields", () => {
  assert.match(source, /OMITTED_EVENT_TYPES = new Set\(\["turn_start", "turn_end", "tool_execution_update"\]\)/);
  assert.match(source, /delete clientEvent\.assistantMessageEvent/);
  assert.match(source, /event\.type === "agent_end"/);
  assert.match(source, /event\.willRetry !== undefined/);
  assert.match(source, /event\.messages !== undefined/);
  assert.match(source, /const clientEvent = toClientEvent\(event\)/);
});

test("agent SSE reuses one TextEncoder per stream", () => {
  assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
  assert.match(source, /controller\.enqueue\(encoder\.encode\(text\)\)/);
});

test("agent SSE heartbeats with an observable JSON frame", () => {
  // A JSON frame (not an SSE comment `:...`) lets the web client's
  // zombie-connection detector distinguish a healthy idle stream from a
  // half-open connection whose transport still reports OPEN.
  assert.match(source, /JSON\.stringify\(\{ type: "heartbeat" \}\)/);
  assert.match(source, /30_000/);
});

test("agent SSE emits an initial state snapshot for reconnect convergence", async () => {
  const source = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
  assert.match(source, /type: "state_sync"/);
  assert.match(source, /session\.send\(\{ type: "get_state" \}\)/);
});

test("agent SSE opt out of proxy buffering and transforms", () => {
  assert.match(source, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(source, /"X-Accel-Buffering": "no"/);
});
