import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { columnForStatus, groupTasksByColumn } = await createJiti(import.meta.url).import("./task-types.ts");

function task(id, status, extra = {}) {
  return {
    id,
    projectRoot: "/repo",
    title: `t${id}`,
    config: null,
    status,
    failureReason: null,
    lastError: null,
    runSeq: 0,
    sortOrder: id,
    worktreePath: null,
    conversationId: null,
    sessionFile: null,
    baseBranch: null,
    workBranch: null,
    verdict: null,
    resultSummary: null,
    filesChanged: null,
    additions: null,
    deletions: null,
    mergeCommit: null,
    preflight: null,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    startedAt: null,
    settledAt: null,
    finishedAt: null,
    ...extra,
  };
}

test("columnForStatus maps every DB status to its board column per the spec", () => {
  assert.equal(columnForStatus("todo"), "todo");
  assert.equal(columnForStatus("queued"), "todo");
  assert.equal(columnForStatus("preparing"), "inProgress");
  assert.equal(columnForStatus("running"), "inProgress");
  assert.equal(columnForStatus("awaiting_input"), "attention");
  assert.equal(columnForStatus("review"), "attention");
  assert.equal(columnForStatus("merging"), "attention");
  assert.equal(columnForStatus("failed"), "attention");
  assert.equal(columnForStatus("done"), "done");
  assert.equal(columnForStatus("canceled"), "done");
});

test("groupTasksByColumn hides canceled tasks unless the toggle is on", () => {
  const tasks = [task(1, "todo"), task(2, "canceled")];
  const hidden = groupTasksByColumn(tasks, false);
  assert.equal(hidden.done.length, 0);
  const shown = groupTasksByColumn(tasks, true);
  assert.deepEqual(shown.done.map((t) => t.id), [2]);
});

test("keeps board order within columns and sorts done before canceled", () => {
  const tasks = [
    task(1, "queued"),
    task(2, "todo"),
    task(3, "canceled", { finishedAt: "2026-08-01T03:00:00Z" }),
    task(4, "done", { finishedAt: "2026-08-01T01:00:00Z" }),
    task(5, "done", { finishedAt: "2026-08-01T02:00:00Z" }),
  ];
  const grouped = groupTasksByColumn(tasks, true);
  assert.deepEqual(grouped.todo.map((t) => t.id), [1, 2]);
  assert.deepEqual(grouped.done.map((t) => t.id), [5, 4, 3]);
});

test("hides archived tasks unless the archive toggle is on", () => {
  const tasks = [
    task(1, "done", { archivedAt: "2026-08-01T01:00:00Z" }),
    task(2, "failed", { archivedAt: "2026-08-01T01:00:00Z" }),
    task(3, "done"),
  ];
  const hidden = groupTasksByColumn(tasks, false);
  assert.deepEqual(hidden.done.map((t) => t.id), [3]);
  assert.equal(hidden.attention.length, 0);
  const shown = groupTasksByColumn(tasks, false, true);
  assert.deepEqual(shown.done.map((t) => t.id), [1, 3]);
  assert.deepEqual(shown.attention.map((t) => t.id), [2]);
});
