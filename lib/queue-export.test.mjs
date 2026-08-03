import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseQueueImport, queueToJson, queueToMarkdown } = await jiti.import("./queue-export.ts");

const entry = {
  id: "entry-1",
  kind: "steer",
  text: "Keep the test deterministic",
  images: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
  queuedAt: 0,
};

test("queue JSON export round-trips queue kind, text, and image metadata", () => {
  const json = queueToJson([entry], { sessionId: "session-1", source: "recovery", exportedAt: "2026-08-03T00:00:00.000Z" });
  assert.deepEqual(parseQueueImport(json), [{
    kind: "steer",
    text: "Keep the test deterministic",
    images: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
  }]);
  assert.match(queueToMarkdown([entry], { source: "recovery", exportedAt: "2026-08-03T00:00:00.000Z" }), /Queued messages export/);
});

test("queue import rejects malformed and invalid entries", () => {
  assert.deepEqual(parseQueueImport("not json"), []);
  assert.deepEqual(parseQueueImport(JSON.stringify([{ kind: "invalid", text: "no" }, { kind: "followUp", text: "ok" }])), [
    { kind: "followUp", text: "ok" },
  ]);
});
