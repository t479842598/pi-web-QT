import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("tracks Agent tool spawns as running subagent rows", () => {
  const startCase = source.slice(
    source.indexOf('case "tool_execution_start"'),
    source.indexOf('case "tool_execution_end"'),
  );
  // Must recognize the Agent / Task tool names from the execution event.
  assert.match(startCase, /SUBAGENT_TOOL_NAMES\.has\(name\)/);
  assert.match(startCase, /addRunningSubagent\(/);
  // The args carry description / subagent_type for the sidebar row.
  assert.match(source, /typeof args\.description === "string"/);
  assert.match(source, /typeof args\.subagent_type === "string"/);
});

test("upserts subagents:record completions into the fleet list", () => {
  const entryCase = source.slice(
    source.indexOf('case "entry_appended"'),
    source.indexOf('case "queue_update"'),
  );
  assert.match(entryCase, /customType === "subagents:record"/);
  assert.match(entryCase, /upsertSubagentRecord\(/);
  // Record fields mapped: status → completed/failed/stopped, tokens + toolUses.
  assert.match(source, /statusRaw === "stopped" \? "stopped"/);
  assert.match(source, /typeof record\.tokens === "object"/);
  assert.match(source, /typeof record\.toolUses === "number"/);
});

test("finishes a running row when the Agent tool ends without a record", () => {
  const endCase = source.slice(
    source.indexOf('case "tool_execution_end"'),
    source.indexOf('case "queue_update"'),
  );
  assert.match(endCase, /finishRunningSubagent\(id\)/);
});

test("resets the fleet list when the session changes", () => {
  assert.match(source, /applySubagents\(\(\) => \[\]\)/);
  // Reset effect keyed on session id / cwd.
  assert.match(source, /session\?\.id, newSessionCwd \?\? session\?\.cwd/);
});

test("pushes live subagent status up to the parent via onSubagentsChange", () => {
  assert.match(source, /onSubagentsChange\?\.\(subagentsRef2\.current\)/);
  assert.match(source, /onSubagentsChange\?\.\(\[\]\)/);
});
