import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const taskTypes = await jiti.import("./task-types.ts");
const { defaultTaskSettings } = taskTypes;
const {
  appendTaskEvent,
  createTaskRow,
  deleteSettingsRow,
  deleteTaskRow,
  deleteTemplateRow,
  encodeProjectDir,
  getEventsFile,
  getProjectTasksDir,
  getTasksFile,
  listTemplates,
  loadEffectiveSettings,
  loadGlobalSettings,
  loadSettingsRow,
  loadTask,
  loadTaskEvents,
  loadTasks,
  saveSettingsRow,
  saveTask,
  saveTemplate,
} = await jiti.import("./task-store.ts");

const ORIGINAL_ENV = process.env.PI_CODING_AGENT_DIR;

function isolateAgentDir(t) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-task-store-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    rmSync(agentDir, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = ORIGINAL_ENV;
  });
  return agentDir;
}

function makeTask(id, overrides = {}) {
  return {
    id,
    projectRoot: "/repo",
    title: `Task ${id}`,
    config: { prompt: "do the thing" },
    status: "todo",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    settledAt: null,
    finishedAt: null,
    ...overrides,
  };
}

test("encodeProjectDir sanitizes absolute paths", () => {
  assert.equal(encodeProjectDir("/repo"), "repo");
  assert.equal(encodeProjectDir("/Volumes/data/my project"), "Volumes--data--my%20project");
  assert.ok(!encodeProjectDir("/a/b/c").includes("/"));
});

test("create + save + load task round-trips through JSONL", (t) => {
  isolateAgentDir(t);
  const task = createTaskRow("/repo", (id, now) => makeTask(id, { createdAt: now }));
  assert.equal(task.id, 1);
  assert.equal(task.status, "todo");

  const loaded = loadTasks("/repo");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 1);
  assert.equal(loaded[0].title, "Task 1");

  // update
  const updated = { ...task, status: "running", workBranch: "task/1-x" };
  saveTask(updated);
  assert.equal(loadTask("/repo", 1)?.status, "running");
  assert.equal(loadTasks("/repo").length, 1);

  // delete
  deleteTaskRow("/repo", 1);
  assert.equal(loadTasks("/repo").length, 0);
});

test("ids are unique across projects", (t) => {
  isolateAgentDir(t);
  const a = createTaskRow("/repo-a", (id, now) => makeTask(id, { createdAt: now }));
  const b = createTaskRow("/repo-b", (id, now) => makeTask(id, { createdAt: now }));
  const c = createTaskRow("/repo-c", (id, now) => makeTask(id, { createdAt: now }));
  assert.notEqual(a.id, b.id);
  assert.notEqual(b.id, c.id);
  assert.equal(loadTasks("/repo-a")[0].id, a.id);
  assert.equal(loadTasks("/repo-b")[0].id, b.id);
  // c's id continues from the max id seen on disk (restart-safe), never reuses.
  assert.ok(c.id > b.id && b.id > a.id);
});

test("events append and load per task", (t) => {
  isolateAgentDir(t);
  const task = createTaskRow("/repo", (id, now) => makeTask(id, { createdAt: now }));
  appendTaskEvent("/repo", { taskId: task.id, kind: "created", actor: "user", payload: null });
  appendTaskEvent("/repo", { taskId: task.id, kind: "started", actor: "engine", payload: { runSeq: 1 } });
  appendTaskEvent("/repo", { taskId: 999, kind: "other", actor: "engine", payload: null });

  const events = loadTaskEvents("/repo", task.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "created");
  assert.equal(events[1].payload?.runSeq, 1);
  assert.ok(existsSync(getEventsFile("/repo")));
});

test("settings: project row, global fallback and effective merge", (t) => {
  isolateAgentDir(t);
  // No settings yet → effective is defaults
  const defaults = loadEffectiveSettings("/repo");
  assert.equal(defaults.maxConcurrent, 1);
  assert.equal(defaults.mergeStrategy, "merge");
  assert.equal(defaults.autoProcess, true);

  // Global settings
  saveSettingsRow("_global", { ...defaultTaskSettings(), maxConcurrent: 3 });
  assert.equal(loadGlobalSettings().maxConcurrent, 3);
  assert.equal(loadEffectiveSettings("/repo").maxConcurrent, 3);

  // Project override wins
  saveSettingsRow("/repo", { ...defaultTaskSettings(), maxConcurrent: 5, mergeStrategy: "squash" });
  assert.equal(loadSettingsRow("/repo")?.maxConcurrent, 5);
  const eff = loadEffectiveSettings("/repo");
  assert.equal(eff.maxConcurrent, 5);
  assert.equal(eff.mergeStrategy, "squash");
  // untouched fields fall back to global
  assert.equal(eff.autoProcess, true);

  // Delete project row → back to global
  deleteSettingsRow("/repo");
  assert.equal(loadSettingsRow("/repo"), null);
  assert.equal(loadEffectiveSettings("/repo").maxConcurrent, 3);
});

test("templates list/save/delete", (t) => {
  isolateAgentDir(t);
  saveTemplate({ id: 1, name: "fix-bug", title: "Fix the bug", config: { prompt: "fix it" }, createdAt: "x", updatedAt: "x" });
  saveTemplate({ id: 2, name: "review", title: "Review", config: { prompt: "review" }, createdAt: "x", updatedAt: "x" });
  assert.equal(listTemplates().length, 2);

  // upsert by id
  saveTemplate({ id: 1, name: "fix-bug", title: "Fixed", config: { prompt: "fix it now" }, createdAt: "x", updatedAt: "x" });
  const templates = listTemplates();
  assert.equal(templates.length, 2);
  assert.equal(templates.find((t) => t.id === 1)?.title, "Fixed");

  deleteTemplateRow(1);
  assert.equal(listTemplates().length, 1);
});

test("corrupt lines are skipped, valid rows survive", (t) => {
  isolateAgentDir(t);
  const file = getTasksFile("/repo");
  const dir = getProjectTasksDir("/repo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, '{"id":1,"title":"ok"}\nNOT JSON\n{"id":2,"title":"also ok"}\n', "utf8");
  const tasks = loadTasks("/repo");
  assert.equal(tasks.length, 2);
});
