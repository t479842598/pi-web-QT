import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { computeSessionDetails } = await jiti.import("./session-details.ts");
const { computeSessionStats } = await jiti.import("./session-stats.ts");
const { computeSessionTotalActiveMs } = await jiti.import("./session-timing.ts");

const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { total: 0.5 } };
const entries = [
  { type: "message", id: "u", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "go" } },
  { type: "message", id: "a", parentId: "u", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", content: [{ type: "toolCall", toolCallId: "c", toolName: "bash", input: {} }], usage } },
  { type: "message", id: "r", parentId: "a", timestamp: "2026-01-01T00:00:03Z", message: { role: "toolResult", toolCallId: "c", toolName: "bash", content: [], usage } },
];

test("combined details scan matches the established stats and timing helpers", () => {
  const combined = computeSessionDetails(entries);
  assert.deepEqual(combined.stats, computeSessionStats(entries));
  assert.equal(combined.totalActiveMs, computeSessionTotalActiveMs(entries));
});
