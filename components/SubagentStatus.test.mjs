import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rowSource = await readFile(new URL("./SubagentRunRow.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");

test("a queued subagent renders as queued, not as completed", () => {
  // Without an explicit case, `queued` falls through to the default branch and
  // a child waiting for a slot shows a green "completed" check.
  assert.match(rowSource, /case "queued":\s*\n\s*return "agentSwitcher\.status\.queued"/, "row maps queued to its own label");
  assert.match(rowSource, /if \(status === "queued"\) return "var\(--text-dim\)"/, "row gives queued a non-success color");
  assert.match(panelSource, /if \(status === "queued"\) return "var\(--text-dim\)"/, "panel gives queued a non-success color");
  assert.match(panelSource, /if \(status === "queued"\) \{/, "panel draws a dedicated queued icon");
});
