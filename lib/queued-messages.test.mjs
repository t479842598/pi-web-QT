import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sameQueuedMessages } = await jiti.import("../hooks/useAgentSession.ts");

test("sameQueuedMessages: identical contents are equal", () => {
  assert.equal(sameQueuedMessages({ steering: ["a", "b"], followUp: ["c"] }, { steering: ["a", "b"], followUp: ["c"] }), true);
});

test("sameQueuedMessages: empty queues are equal", () => {
  assert.equal(sameQueuedMessages({ steering: [], followUp: [] }, { steering: [], followUp: [] }), true);
});

test("sameQueuedMessages: different members or lengths are unequal", () => {
  assert.equal(sameQueuedMessages({ steering: ["a"], followUp: [] }, { steering: ["b"], followUp: [] }), false);
  assert.equal(sameQueuedMessages({ steering: ["a"], followUp: [] }, { steering: ["a", "b"], followUp: [] }), false);
  assert.equal(sameQueuedMessages({ steering: [], followUp: [] }, { steering: [], followUp: ["x"] }), false);
  assert.equal(sameQueuedMessages({ steering: ["a"], followUp: [] }, { steering: [], followUp: ["a"] }), false);
});
