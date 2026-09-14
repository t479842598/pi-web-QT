/**
 * Work-task execution engine.
 *
 * Drives the manual pipeline
 * `todo → queued → preparing → running ⇄ awaiting_input → review → merging → done`
 * (plus failed / canceled).
 *
 * Adapted from codeg's Rust `work_task/engine.rs` to pi-web's Node stack:
 * - Worktrees via `lib/worktree.ts addWorktree()`.
 * - Execution via an in-process AgentSession (`startRpcSession`, cwd = the
 *   task's worktree path), the same machinery the chat UI uses.
 * - Awaiting-input detection via `extension_ui_request` events that need a
 *   user response (confirm/input/select).
 * - run_seq generations: every launch claims a new run_seq; state transitions
 *   are CAS'd on it so a cancel racing a late turn is a no-op.
 * - Crash recovery: a 30s reconcile tick plus a boot-time sweep restores
 *   tasks whose worker died mid-run.
 *
 * A single process holds the engine (an exclusive lock file under the tasks
 * data dir). Other processes get "engine not running" from the commands.
 */

import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { addWorktree, listWorktrees, removeWorktree, resolveProject } from "./worktree";
import {
  appendTaskEvent,
  createTaskRow,
  deleteTaskRow,
  getProjectTasksDir,
  loadEffectiveSettings,
  loadTask,
  loadTasks,
  saveTask,
} from "./task-store";
import type { WorkTask, WorkTaskFolderSettings, WorkTaskDraft, WorkTaskStatus } from "./task-types";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";

// ─── Events ─────────────────────────────────────────────────────────────────

export type TaskChange = { type: "upsert"; id: number } | { type: "delete"; id: number };

export type TaskChangeListener = (change: TaskChange) => void;

/** The engine's change bus. The API layer bridges these to the SSE channel. */
const listeners = new Set<TaskChangeListener>();

export function onTaskChange(listener: TaskChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(change: TaskChange): void {
  for (const listener of listeners) listener(change);
}

// ─── Lock ───────────────────────────────────────────────────────────────────

const ENGINE_LOCK_FILE = "engine.lock";

/** True when the PID recorded in the lock file is still a live process. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Reclaim a stale lock: the recorded PID is dead (crashed server) or the
 *  file is unreadable garbage. */
function tryReclaimStaleLock(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    // Unreadable/absent — try removing it so we can retry the lock.
    try {
      unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }
}

function acquireEngineLock(): boolean {
  const dir = getProjectTasksDir("__engine__");
  const lockPath = join(dir, ENGINE_LOCK_FILE);
  try {
    mkdirSync(dir, { recursive: true });
    // First try to reclaim a stale lock from a dead process; then attempt an
    // exclusive create. If another live process holds it, we are not the
    // engine (commands report "engine not running").
    if (existsSync(lockPath) && !tryReclaimStaleLock(lockPath)) return false;
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, String(process.pid));
    // Keep the fd open for the process lifetime; close is never needed.
    (globalThis as Record<string, unknown>)["__taskEngineLockFd"] = fd;
    return true;
  } catch {
    return false;
  }
}

// ─── Engine state ───────────────────────────────────────────────────────────

interface MergeIntent {
  message: string | null;
  deleteWorktree: boolean;
  strategy: WorkTaskFolderSettings["mergeStrategy"];
}

interface LiveRun {
  taskId: number;
  runSeq: number;
  connectionId: string;
  /** Project root where the task row lives (NOT the worktree cwd). */
  projectRoot: string;
  session: AgentSessionWrapper;
  /** Outstanding requests that need a user response (awaiting_input). */
  pendingRequests: Set<string>;
  unsubscribe?: () => void;
  lastAssistant?: { stopReason?: string; errorMessage?: string };
  promptError?: string;
  retrying?: boolean;
  settling?: Promise<void>;
  mergeIntent?: MergeIntent;
}

interface EngineState {
  /** connectionId → live run. */
  live: Map<string, LiveRun>;
  /** taskId → live run (for lookup by task). */
  byTask: Map<number, LiveRun>;
  /** Tasks currently being launched (preparing), with ownership token. */
  launching: Map<number, number>;
  /** Deterministic merge ownership also exists when there is no agent wrapper. */
  merging?: Map<number, { projectRoot: string; runSeq: number }>;
  /** Per-project pump locks. */
  pumpLocks: Map<string, Promise<void>>;
  reconcileTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

let engine: EngineState | null = null;

/** Engine state lives on globalThis so every module instance (instrumentation
 *  boot vs route handlers, which Next.js may load as separate copies) shares
 *  the same engine. */
const ENGINE_GLOBAL_KEY = "__piTaskEngine";

function getEngineState(): EngineState | null {
  return (globalThis as Record<string, unknown>)[ENGINE_GLOBAL_KEY] as EngineState | null ?? engine;
}

function setEngineState(state: EngineState | null): void {
  engine = state;
  (globalThis as Record<string, unknown>)[ENGINE_GLOBAL_KEY] = state;
}

function getEngine(): EngineState {
  const eng = getEngineState();
  if (!eng) throw new Error("task engine not running");
  return eng;
}

/** Build the engine; fails if another process holds the lock. */
export function ensureTaskEngine(): boolean {
  if (getEngineState()) return true;
  if (!acquireEngineLock()) return false;
  const state: EngineState = {
    live: new Map(),
    byTask: new Map(),
    launching: new Map(),
    merging: new Map(),
    pumpLocks: new Map(),
    reconcileTimer: null,
    stopped: false,
  };
  setEngineState(state);
  void bootReconcile();
  state.reconcileTimer = setInterval(() => {
    // reconcile() can reject on corrupt task files (readDirSync/JSON.parse);
    // an unhandled rejection from a timer crashes the whole server process.
    void reconcile().catch((error) => {
      console.error("[tasks] periodic reconcile failed:", error instanceof Error ? error.message : error);
    });
  }, 30_000);
  return true;
}

export function isTaskEngineRunning(): boolean {
  return getEngineState() != null;
}

// ─── Task mutations (shared with commands) ──────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function persist(task: WorkTask, eventKind?: string, actor = "engine", payload?: Record<string, unknown>): void {
  saveTask(task);
  if (eventKind) appendTaskEvent(task.projectRoot, { taskId: task.id, kind: eventKind, actor, payload: payload ?? null });
  emitChange({ type: "upsert", id: task.id });
}

export function createTask(draft: WorkTaskDraft): WorkTask {
  const task = createTaskRow(draft.projectRoot, (id, now) => ({
    id,
    projectRoot: draft.projectRoot,
    title: draft.title,
    config: draft.config,
    status: "todo",
    failureReason: null,
    lastError: null,
    runSeq: 0,
    sortOrder: loadTasks(draft.projectRoot).length,
    worktreePath: null,
    conversationId: null,
    sessionFile: null,
    baseBranch: null,
    workBranch: null,
    verdict: null,
    resultSummary: null,
    userNote: null,
    filesChanged: null,
    additions: null,
    deletions: null,
    mergeCommit: null,
    preflight: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    finishedAt: null,
  }));
  appendTaskEvent(task.projectRoot, { taskId: task.id, kind: "created", actor: "user", payload: { title: task.title } });
  emitChange({ type: "upsert", id: task.id });
  nudgePump(task.projectRoot);
  return task;
}

export function updateTask(id: number, draft: WorkTaskDraft): WorkTask | null {
  const task = loadTask(draft.projectRoot, id);
  if (!task) return null;
  const next: WorkTask = { ...task, title: draft.title, config: draft.config };
  persist(next, "updated", "user");
  nudgePump(next.projectRoot);
  return next;
}

export function deleteTask(id: number, projectRoot: string, deleteWorktree: boolean): void {
  const task = loadTask(projectRoot, id);
  if (!task) return;
  if (task.worktreePath && task.workBranch && deleteWorktree) {
    // Best-effort cleanup: remove the worktree, then delete its branch.
    void (async () => {
      try {
        await removeWorktree(projectRoot, task.worktreePath as string, true);
      } catch {
        // Worktree may already be gone; branch cleanup still runs.
      }
      try {
        await runGitIn(projectRoot, ["branch", "-D", task.workBranch as string]);
      } catch {
        // Branch may be merged/renamed — leave it.
      }
    })();
  }
  const eng = getEngineState();
  const live = eng?.byTask.get(id);
  if (live) {
    void live.session.send({ type: "abort" }).catch(() => undefined);
    eng?.live.delete(live.connectionId);
    eng?.byTask.delete(id);
  }
  deleteTaskRow(projectRoot, id);
  emitChange({ type: "delete", id });
}

// ─── Transitions (all CAS on run_seq) ───────────────────────────────────────

function casStatus(taskId: number, runSeq: number, expected: WorkTaskStatus[], next: WorkTaskStatus, extra?: Partial<WorkTask>): WorkTask | null {
  const task = loadTaskByAnyProject(taskId);
  if (!task) return null;
  if (task.runSeq !== runSeq) return null;
  if (!expected.includes(task.status)) return null;
  const updated: WorkTask = { ...task, ...extra, status: next, updatedAt: nowIso() };
  persist(updated);
  return updated;
}

/** Look up a task across all projects. The engine tracks the project root on
 *  the live run; fall back to scanning the tasks data dir (covers transitions
 *  for tasks without a live run, e.g. reconcile sweeps). */
function loadTaskByAnyProject(taskId: number): WorkTask | null {
  for (const run of getEngineState()?.byTask.values() ?? []) {
    if (run.taskId === taskId) {
      return loadTask(run.projectRoot, taskId) ?? null;
    }
  }
  const root = getProjectTasksDir("__engine__").replace(/__engine__$/, "");
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "__engine__") continue;
    const task = loadTask(decodeProjectDir(entry.name), taskId);
    if (task) return task;
  }
  return null;
}

// ─── Launch pipeline ────────────────────────────────────────────────────────

/** Kick the per-project pump (called on create/update/settings change). */
export function nudgePump(projectRoot: string): void {
  if (!getEngineState()) return;
  void pumpProject(projectRoot);
}

/** A per-folder pump: claim queued tasks up to maxConcurrent, launch them. */
async function pumpProject(projectRoot: string): Promise<void> {
  const eng = getEngine();
  const prev = eng.pumpLocks.get(projectRoot) ?? Promise.resolve();
  const run = prev.then(() => pumpProjectInner(projectRoot));
  // Keep a chained promise so concurrent pumps serialize.
  eng.pumpLocks.set(projectRoot, run.catch(() => undefined));
  await run;
}

async function pumpProjectInner(projectRoot: string): Promise<void> {
  const eng = getEngine();
  if (eng.stopped) return;
  const settings = loadEffectiveSettings(projectRoot);
  if (!settings.autoProcess) return;

  const tasks = loadTasks(projectRoot);
  let running = [...eng.byTask.values()].filter((r) => r.projectRoot === projectRoot).length;
  const limit = settings.maxConcurrent > 0 ? settings.maxConcurrent : Infinity;
  if (running >= limit) return;

  const queued = tasks
    .filter((t) => t.status === "queued")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const task of queued) {
    if (running >= limit) break;
    if (eng.launching.has(task.id)) continue;
    const ok = await launchTask(task.id, projectRoot);
    if (ok) running += 1;
  }
}

/** Launch one task: queued → preparing → running. Returns success. */
async function launchTask(taskId: number, projectRoot: string): Promise<boolean> {
  const eng = getEngine();
  const task = loadTask(projectRoot, taskId);
  if (!task || task.status !== "queued") return false;

  const counter = globalThis as unknown as Record<string, number>;
  const token = (counter.__taskLaunchToken = (counter.__taskLaunchToken ?? 0) + 1);
  eng.launching.set(taskId, token);

  // queued → preparing
  const preparing = casStatus(taskId, task.runSeq, ["queued"], "preparing", { startedAt: nowIso() });
  if (!preparing) {
    eng.launching.delete(taskId);
    return false;
  }
  appendTaskEvent(projectRoot, { taskId, kind: "preparing", actor: "engine" });

  try {
    // 1. Worktree
    const project = await resolveProject(projectRoot);
    if (!project.projectRoot) throw new Error("Not a git repository");
    const branch = `task/${taskId}-${slugify(task.title)}`;
    let worktreePath: string | null = null;
    try {
      const wt = await addWorktree(project.projectRoot, branch);
      worktreePath = wt.path;
    } catch (error) {
      // Worktree may already exist from a previous run (retry after crash).
      const existing = await tryReuseWorktree(project.projectRoot, branch);
      if (!existing) throw error;
      worktreePath = existing;
    }
    const workBranch = branch;
    const baseBranch = project.branch ?? null;

    // 2. Init command (settings.initCommand) inside the worktree
    const settings = loadEffectiveSettings(projectRoot);
    if (settings.initCommand) {
      await runShellIn(worktreePath, settings.initCommand);
    }

    // 3. Start AgentSession in the worktree
    const { session } = await startTaskSession(task, worktreePath);
    const run: LiveRun = {
      taskId,
      runSeq: task.runSeq,
      connectionId: session.sessionId,
      projectRoot,
      session,
      pendingRequests: new Set(),
    };
    const previousRun = eng.byTask.get(taskId);
    if (previousRun) cleanupRun(previousRun);
    eng.live.set(session.sessionId, run);
    eng.byTask.set(taskId, run);
    attachEventHandlers(run);

    // 4. Persist worktree + conversation ids
    const running = casStatus(taskId, task.runSeq, ["preparing"], "running", {
      worktreePath,
      workBranch,
      baseBranch,
      conversationId: session.sessionId,
      sessionFile: session.sessionFile,
      runSeq: task.runSeq,
    });
    if (!running) {
      // The task was canceled while preparing; tear the session down.
      cleanupRun(run);
      void session.shutdown().catch(() => undefined);
      return false;
    }
    appendTaskEvent(projectRoot, { taskId, kind: "started", actor: "engine", payload: { runSeq: task.runSeq, branch: workBranch } });

    // 5. Send the task prompt
    const promptText = buildLaunchPrompt(task, settings);
    await session.send({ type: "prompt", message: promptText });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const t = loadTask(projectRoot, taskId);
    const run = eng.byTask.get(taskId);
    if (run?.runSeq === task.runSeq && t?.status === "running") {
      failRun(run, message);
    } else if (t?.runSeq === task.runSeq && (t.status === "preparing" || t.status === "queued")) {
      casStatus(taskId, task.runSeq, [t.status], "failed", {
        failureReason: "setup_error",
        lastError: message,
        settledAt: nowIso(),
        finishedAt: nowIso(),
      });
      appendTaskEvent(projectRoot, { taskId, kind: "failed", actor: "engine", payload: { reason: "setup_error", message } });
    }
    return false;
  } finally {
    eng.launching.delete(taskId);
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

async function tryReuseWorktree(projectRoot: string, branch: string): Promise<string | null> {
  try {
    const worktrees = await listWorktrees(projectRoot);
    const match = worktrees.find((w) => w.branch === branch);
    return match?.path ?? null;
  } catch {
    return null;
  }
}

/** Start an AgentSession for a task (cwd = worktree). */
async function startTaskSession(
  task: WorkTask,
  worktreePath: string,
): Promise<{ session: AgentSessionWrapper }> {
  // Session id: stable per task so restarts reuse the same conversation file.
  const sessionId = `task-${task.id}`;
  // Empty toolNames would disable every tool; task sessions need the full
  // tool set like a normal session, so leave the allow-list unset.
  const { session } = await startRpcSession(sessionId, "", worktreePath, {});
  return { session };
}

function buildLaunchPrompt(task: WorkTask, settings: WorkTaskFolderSettings): string {
  const base = task.config?.prompt ?? task.title;
  const stage = settings.stagePrompts?.work ?? settings.stagePrompts?.all ?? "";
  const agent = task.config?.agentType ?? settings.defaultAgentType;
  const header =
    `You are working on task "${task.title}" in a git worktree branch.\n` +
    (agent ? `Agent: ${agent}\n` : "") +
    `Complete the work described below.\n\n` +
    `IMPORTANT RULES:\n` +
    `- Work ONLY inside this worktree directory. Do not touch other checkouts.\n` +
    `- Do NOT run "git add", "git commit", "git push" or "git merge" unless the task explicitly asks you to. Leave git alone.\n` +
    `- Do NOT modify files outside this worktree.\n` +
    `- When you are done, write a short "Result summary" paragraph describing what you changed.\n\n`;
  const note = task.userNote?.trim();
  const noteBlock = note
    ? `User note on this (re)start:\n${note}\n\n`
    : "";
  return header + noteBlock + base + (stage ? `\n\n${stage}` : "");
}

// ─── Session event handling ─────────────────────────────────────────────────

/** Identity as well as runSeq matters: task session ids are reused on retry. */
function currentRunTask(run: LiveRun): WorkTask | null {
  const eng = getEngineState();
  if (eng?.live.get(run.connectionId) !== run || eng.byTask.get(run.taskId) !== run) return null;
  const task = loadTask(run.projectRoot, run.taskId);
  return task?.runSeq === run.runSeq ? task : null;
}

function failRun(run: LiveRun, message: string): void {
  const task = currentRunTask(run);
  if (!task) return;
  if (task.status === "merging") {
    failMerge(task, message);
    run.mergeIntent = undefined;
    return;
  }
  const failed = casStatus(run.taskId, run.runSeq, ["running", "awaiting_input"], "failed", {
    failureReason: "agent_error",
    lastError: message,
    settledAt: nowIso(),
    finishedAt: nowIso(),
  });
  if (!failed) return;
  appendTaskEvent(task.projectRoot, { taskId: run.taskId, kind: "failed", actor: "engine", payload: { reason: "agent_error", message } });
  cleanupRun(run);
}

/** agent_end is provisional (retry/compaction/extensions may continue). Only a
 * wrapper-idle prompt_done/agent_settled can complete this generation. */
function settleRun(run: LiveRun): void {
  const task = currentRunTask(run);
  if (!task || !["running", "awaiting_input", "merging"].includes(task.status)) return;
  if (run.settling || run.session.isRunning()) return;
  const failure = run.promptError ?? (
    run.lastAssistant?.stopReason === "error" || run.lastAssistant?.stopReason === "aborted"
      ? run.lastAssistant.errorMessage || `Agent ended with ${run.lastAssistant.stopReason}`
      : undefined
  );
  if (failure) {
    failRun(run, failure);
    return;
  }
  if (run.pendingRequests.size || run.retrying) return;
  if (!run.lastAssistant || run.lastAssistant.stopReason !== "stop") {
    failRun(run, `Agent did not finish successfully (${run.lastAssistant?.stopReason ?? "no assistant result"})`);
    return;
  }
  run.settling = (task.status === "merging" ? handleMergeEnd(run) : settleToReview(run, task))
    .catch((error) => failRun(run, error instanceof Error ? error.message : String(error)))
    .finally(() => { run.settling = undefined; });
}

function attachEventHandlers(run: LiveRun): void {
  run.unsubscribe = run.session.onEvent((event) => {
    const task = currentRunTask(run);
    if (!task || !["running", "awaiting_input", "merging"].includes(task.status)) return;
    switch (event.type as string) {
      case "extension_ui_request": {
        const method = event.method as string | undefined;
        const id = event.id as string | undefined;
        if (method && id && ["confirm", "input", "select", "editor"].includes(method)) {
          run.pendingRequests.add(id);
          if (casStatus(run.taskId, run.runSeq, ["running"], "awaiting_input")) {
            appendTaskEvent(task.projectRoot, { taskId: run.taskId, kind: "awaiting_input", actor: "engine", payload: { method, id } });
          }
        }
        break;
      }
      case "extension_ui_response": {
        const id = event.id as string | undefined;
        if (id && run.pendingRequests.delete(id) && run.pendingRequests.size === 0) {
          casStatus(run.taskId, run.runSeq, ["awaiting_input"], "running");
        }
        break;
      }
      case "message_end": {
        const message = event.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
        if (message?.role === "assistant") run.lastAssistant = message;
        break;
      }
      case "agent_end": {
        const messages = event.messages as Array<{ role?: string; stopReason?: string; errorMessage?: string }> | undefined;
        const assistant = messages?.findLast((message) => message.role === "assistant");
        if (assistant) run.lastAssistant = assistant;
        run.retrying = event.willRetry === true;
        break;
      }
      case "auto_retry_start":
        run.retrying = true;
        break;
      case "auto_retry_end":
        run.retrying = false;
        if (event.success === false) run.promptError = String(event.finalError ?? "Agent retry failed");
        break;
      case "prompt_error":
        run.promptError = String(event.errorMessage ?? "agent error");
        settleRun(run);
        break;
      case "prompt_done":
      case "agent_settled":
        settleRun(run);
        break;
      case "agent_start":
        run.lastAssistant = undefined;
        run.promptError = undefined;
        run.retrying = false;
        if (run.pendingRequests.size === 0) casStatus(run.taskId, run.runSeq, ["awaiting_input"], "running");
        break;
    }
  });
}

/** running → review (with preflight). */
async function settleToReview(run: LiveRun, task: WorkTask): Promise<void> {
  if (!currentRunTask(run)) return;

  const updated = casStatus(run.taskId, run.runSeq, ["running", "awaiting_input"], "review", {
    settledAt: nowIso(),
  });
  if (!updated) return;
  appendTaskEvent(task.projectRoot, { taskId: run.taskId, kind: "review", actor: "engine" });

  // Preflight command (settings): runs in the worktree, red/green light.
  const settings = loadEffectiveSettings(task.projectRoot);
  if (settings.preflightCommand) {
    await runPreflight(run, settings.preflightCommand);
  }
  // Keep the live mapping so merge/return can reuse the session; the wrapper
  // idles out on its own (rpc-manager idle timeout) and is dropped from the
  // live map lazily on the next transition that needs it.
}

async function runPreflight(run: LiveRun, command: string): Promise<void> {
  const task = currentRunTask(run);
  if (!task || task.status !== "review") return;
  persist(
    { ...task, preflight: { status: "running", command } },
    "preflight_start",
    "engine",
    { command },
  );
  try {
    const result = await runShellCapture(run.session.cwd, command);
    const live = currentRunTask(run);
    if (!live || live.status !== "review") return;
    persist(
      {
        ...live,
        preflight: {
          status: result.code === 0 ? "passed" : "failed",
          command,
          exitCode: result.code,
          outputTail: result.code === 0 ? null : result.output.slice(-4000),
        },
      },
      result.code === 0 ? "preflight_passed" : "preflight_failed",
      "engine",
      { command, exitCode: result.code },
    );
  } catch (error) {
    const task2 = currentRunTask(run);
    if (!task2 || task2.status !== "review") return;
    persist(
      { ...task2, preflight: { status: "failed", command, outputTail: error instanceof Error ? error.message : String(error) } },
      "preflight_failed",
      "engine",
      { command },
    );
  }
}

function cleanupRun(run: LiveRun): void {
  run.unsubscribe?.();
  run.unsubscribe = undefined;
  const eng = getEngineState();
  if (eng?.live.get(run.connectionId) === run) eng.live.delete(run.connectionId);
  if (eng?.byTask.get(run.taskId) === run) eng.byTask.delete(run.taskId);
}

// ─── Shell helpers (init command, preflight) ────────────────────────────────

// Git invocations never go through a shell: task fields (workBranch) live in
// the on-disk store and the merge message is user-supplied — string-building
// a shell command lets `$(...)`/backticks execute even inside JSON-quoted
// double quotes. Array-arg spawn removes the entire injection class.
// Exported (prefixed) for unit tests.
export function runGitIn(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args[0] ?? ""} exited with code ${code ?? "null"}`));
    });
  });
}

export function runGitCapture(cwd: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });
    child.on("error", () => resolve({ code: 1, output }));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

function runShellIn(cwd: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`init command exited with code ${code ?? "null"}`));
    });
  });
}

function runShellCapture(cwd: string, command: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });
    child.on("error", () => resolve({ code: 1, output }));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

// ─── Commands (start / cancel / retry / requeue / return / merge / archive) ─

export async function startTask(id: number, projectRoot: string): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "todo") return;
  const next = { ...task, status: "queued" as WorkTaskStatus, runSeq: task.runSeq + 1 };
  persist(next, "queued", "user");
  nudgePump(projectRoot);
}

export async function startAllTasks(projectRoot: string | null): Promise<number> {
  const projects = projectRoot ? [projectRoot] : await allProjectRoots();
  let claimed = 0;
  for (const project of projects) {
    const tasks = loadTasks(project);
    for (const task of tasks.filter((t) => t.status === "todo")) {
      const next = { ...task, status: "queued" as WorkTaskStatus, runSeq: task.runSeq + 1 };
      persist(next, "queued", "user");
      claimed += 1;
    }
    nudgePump(project);
  }
  return claimed;
}

async function allProjectRoots(): Promise<string[]> {
  const root = getProjectTasksDir("__engine__").replace(/__engine__$/, "");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "__engine__")
    .map((e) => decodeProjectDir(e.name));
}

function decodeProjectDir(name: string): string {
  // Reverses encodeProjectDir's "segments joined by --".
  return "/" + name.split("--").map((seg) => decodeURIComponent(seg)).join("/");
}

export async function cancelTask(id: number, projectRoot: string, reason?: string | null): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task) return;
  const eng = getEngineState();
  const run = eng?.byTask.get(id);
  if (run && eng) {
    // Commit cancellation before abort emits its terminal events.
    const canceled = casStatus(id, run.runSeq, ["running", "awaiting_input", "preparing", "queued", "merging"], "canceled", {
      settledAt: nowIso(),
      finishedAt: nowIso(),
    });
    if (!canceled) return;
    cleanupRun(run);
    await run.session.send({ type: "abort" }).catch(() => undefined);
  } else {
    if (!casStatus(id, task.runSeq, ["todo", "queued", "preparing", "merging"], "canceled", {
      settledAt: nowIso(),
      finishedAt: nowIso(),
    })) return;
  }
  if (eng?.merging?.get(id)?.runSeq === task.runSeq) eng.merging.delete(id);
  appendTaskEvent(projectRoot, {
    taskId: id,
    kind: "canceled",
    actor: "user",
    payload: reason ? { reason } : null,
  });
}

export async function retryTask(id: number, projectRoot: string, note?: string | null): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "failed") return;
  const next = {
    ...task,
    status: "queued" as WorkTaskStatus,
    runSeq: task.runSeq + 1,
    lastError: null,
    failureReason: null,
    userNote: note ?? task.userNote,
  };
  persist(next, "queued", "user", { retry: true, note: note ?? null });
  nudgePump(projectRoot);
}

export async function requeueTask(id: number, projectRoot: string, note?: string | null): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "canceled") return;
  const next = {
    ...task,
    status: "todo" as WorkTaskStatus,
    lastError: null,
    failureReason: null,
    userNote: note ?? task.userNote,
  };
  persist(next, "requeued", "user", { note: note ?? null });
  nudgePump(projectRoot);
}

export async function returnTask(id: number, projectRoot: string, feedback: string): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "review") return;
  // Re-launch: review → queued (same run_seq generation bump, new worktree if
  // the old one was deleted).
  const next = { ...task, status: "queued" as WorkTaskStatus, runSeq: task.runSeq + 1, preflight: null };
  persist(next, "returned", "user", { feedback });
  appendTaskEvent(projectRoot, { taskId: id, kind: "return_feedback", actor: "user", payload: { feedback } });
  nudgePump(projectRoot);
}

export async function archiveTask(id: number, projectRoot: string, archived: boolean): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task) return;
  const next = { ...task, archivedAt: archived ? nowIso() : null };
  persist(next, archived ? "archived" : "unarchived", "user");
}

export async function reorderTasks(projectRoot: string, orderedIds: number[]): Promise<void> {
  const tasks = loadTasks(projectRoot);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const updated: WorkTask[] = [];
  orderedIds.forEach((id, index) => {
    const t = byId.get(id);
    if (t) updated.push({ ...t, sortOrder: index });
  });
  // Keep tasks not in the order list at the tail, in their relative order.
  const seen = new Set(orderedIds);
  let tail = orderedIds.length;
  for (const t of tasks) {
    if (!seen.has(t.id)) updated.push({ ...t, sortOrder: tail++ });
  }
  for (const t of updated) saveTask(t);
  if (updated.length > 0) emitChange({ type: "upsert", id: updated[0].id });
}

// ─── Merge ──────────────────────────────────────────────────────────────────

/**
 * Accept a reviewed task that changed nothing (filesChanged === 0): there is
 * no merge to dispatch and no commit to write, so the only decision left is
 * what happens to the (empty) worktree. Recheck git before trusting cached stats.
 */
export async function completeTask(id: number, projectRoot: string, deleteWorktree: boolean): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "review") return;
  if (task.filesChanged !== 0) {
    throw new Error("Task has changes to merge; use merge instead");
  }
  await withMergeLock(projectRoot, async () => {
    const git = guardedGit(() => ownsTask(task, "review"));
    const { base, source } = await mergeRefs(task, git);
    const contained = await git(projectRoot, ["merge-base", "--is-ancestor", source, base], [0, 1]);
    if (contained.code !== 0) throw new Error("Task has committed changes to merge; use merge instead");
    if (!casStatus(id, task.runSeq, ["review"], "done", { finishedAt: nowIso() })) return;
    appendTaskEvent(projectRoot, { taskId: id, kind: "completed", actor: "user", payload: { deleteWorktree } });
    const run = getEngineState()?.byTask.get(id);
    if (run?.runSeq === task.runSeq) cleanupRun(run);
    if (deleteWorktree) await cleanupMergedWorktree(task, source, base);
  });
}

export async function mergeTask(id: number, projectRoot: string, message: string | null, deleteWorktree: boolean): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "review") return;
  const eng = getEngineState();
  const previousRun = eng?.byTask.get(id);
  if (previousRun?.session.isAlive() && previousRun.session.isRunning()) {
    throw new Error("Task session is still running");
  }
  const intent: MergeIntent = { message, deleteWorktree, strategy: loadEffectiveSettings(projectRoot).mergeStrategy };
  const merging = casStatus(id, task.runSeq, ["review"], "merging", {
    runSeq: task.runSeq + 1,
    lastError: null,
    mergeCommit: null,
    finishedAt: null,
  });
  if (!merging) return;
  appendTaskEvent(projectRoot, { taskId: id, kind: "merge_requested", actor: "user", payload: { ...intent, baseBranch: task.baseBranch } });

  let run: LiveRun | undefined;
  try {
    if (previousRun && eng && previousRun.runSeq === task.runSeq && previousRun.session.isAlive()) {
      cleanupRun(previousRun);
      run = { ...previousRun, runSeq: merging.runSeq, pendingRequests: new Set(), lastAssistant: undefined, promptError: undefined, retrying: false, settling: undefined, mergeIntent: intent };
      eng.live.set(run.connectionId, run);
      eng.byTask.set(id, run);
      attachEventHandlers(run);
      // Preserve agent-assisted preparation, including selecting only task files
      // and an automatic commit message. The engine owns the deterministic base
      // merge: merging base INTO the worktree never updates the base branch.
      const mergePrompt =
        `Prepare your task changes for integration into the base branch (${task.baseBranch ?? "unknown"}).\n` +
        `Rules:\n` +
        `- Work ONLY in this worktree on branch ${task.workBranch}.\n` +
        `- Review and commit only the files changed for this task; do not commit unrelated work.\n` +
        `- Do NOT merge, switch, update, push, or delete other branches or worktrees.\n` +
        `- The engine will merge your committed task branch into the recorded base after you finish successfully.\n` +
        (message ? `Use this commit message: ${JSON.stringify(message)}\n` : "Write a concise commit message yourself.\n") +
        (deleteWorktree ? "The engine may remove the clean worktree after verified integration." : "Keep the worktree after integration.");
      await run.session.send({ type: "prompt", message: mergePrompt });
    } else {
      if (previousRun) cleanupRun(previousRun);
      await finishMerge(merging, intent);
    }
  } catch (error) {
    failMerge(merging, error instanceof Error ? error.message : String(error));
    if (run) run.mergeIntent = undefined;
  }
}

function failMerge(task: WorkTask, message: string): void {
  if (!casStatus(task.id, task.runSeq, ["merging"], "review", { lastError: `Merge failed: ${message}` })) return;
  appendTaskEvent(task.projectRoot, { taskId: task.id, kind: "merge_failed", actor: "engine", payload: { message } });
}

function ownsTask(task: WorkTask, status: WorkTaskStatus): boolean {
  const current = loadTask(task.projectRoot, task.id);
  return current?.runSeq === task.runSeq && current.status === status;
}

/** Check ownership before AND after every asynchronous git step. */
function guardedGit(check: () => boolean) {
  return async (cwd: string, args: string[], allowedCodes = [0]): Promise<{ code: number | null; output: string }> => {
    if (!check()) throw new Error("Task run was superseded");
    const result = await runGitCapture(cwd, args);
    if (!check()) throw new Error("Task run was superseded");
    if (!allowedCodes.includes(result.code ?? -1)) throw new Error(result.output.trim() || `git ${args[0]} failed (${result.code})`);
    return { ...result, output: result.output.trim() };
  };
}

type CheckedGit = ReturnType<typeof guardedGit>;

async function requireClean(git: CheckedGit, cwd: string, includeIgnored = false): Promise<void> {
  const status = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all", ...(includeIgnored ? ["--ignored"] : [])]);
  if (status.output) throw new Error(`Checkout has uncommitted or untracked changes: ${cwd}`);
}

async function mergeRefs(task: WorkTask, git: CheckedGit) {
  if (!task.worktreePath || !task.workBranch || !task.baseBranch) throw new Error("A worktree and explicit base/work branch are required");
  const baseRef = `refs/heads/${task.baseBranch}`;
  const workRef = `refs/heads/${task.workBranch}`;
  if (baseRef === workRef) throw new Error("Task branch must differ from the base branch");
  const checkedOut = await git(task.projectRoot, ["symbolic-ref", "-q", "HEAD"]);
  if (checkedOut.output !== baseRef) throw new Error(`Base checkout must be on branch ${task.baseBranch}; refusing to merge another branch`);
  const workCheckedOut = await git(task.worktreePath, ["symbolic-ref", "-q", "HEAD"]);
  if (workCheckedOut.output !== workRef) throw new Error(`Worktree must be on branch ${task.workBranch}`);
  await requireClean(git, task.projectRoot);
  await requireClean(git, task.worktreePath);
  const base = (await git(task.projectRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`])).output;
  const source = (await git(task.projectRoot, ["rev-parse", "--verify", `${workRef}^{commit}`])).output;
  return { baseRef, workRef, base, source };
}

// Serialize base mutations across task sessions, including separate hot-reload
// module instances. Other checkouts/processes are still checked at each step.
async function withMergeLock(projectRoot: string, operation: () => Promise<void>): Promise<void> {
  const global = globalThis as typeof globalThis & { __piTaskMergeLocks?: Map<string, Promise<void>> };
  const locks = global.__piTaskMergeLocks ??= new Map();
  const previous = locks.get(projectRoot) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  locks.set(projectRoot, pending);
  try { await pending; } finally { if (locks.get(projectRoot) === pending) locks.delete(projectRoot); }
}

async function finishMerge(task: WorkTask, intent: MergeIntent, run?: LiveRun): Promise<void> {
  const eng = getEngineState();
  const owners = eng ? (eng.merging ??= new Map()) : undefined;
  const token = { projectRoot: task.projectRoot, runSeq: task.runSeq };
  if (!ownsTask(task, "merging")) return;
  owners?.set(task.id, token);
  try {
    await withMergeLock(task.projectRoot, () => integrateMerge(task, intent, run, () => !owners || owners.get(task.id) === token));
  } finally {
    if (owners?.get(task.id) === token) owners.delete(task.id);
  }
}

async function integrateMerge(task: WorkTask, intent: MergeIntent, run: LiveRun | undefined, ownsMerge: () => boolean): Promise<void> {
    const git = guardedGit(() => ownsMerge() && ownsTask(task, "merging") && (!run || !!currentRunTask(run)));
    const { baseRef, workRef, base, source } = await mergeRefs(task, git);
    const contained = await git(task.projectRoot, ["merge-base", "--is-ancestor", source, base], [0, 1]);
    let expectedTree: string | undefined;
    if (contained.code !== 0) {
      const commitMessage = intent.message || `Merge task ${task.id}: ${task.title}`;
      if (intent.strategy === "squash") {
        await git(task.projectRoot, ["merge", "--squash", "--no-commit", source]);
        expectedTree = (await git(task.projectRoot, ["write-tree"])).output;
        const changed = await git(task.projectRoot, ["diff", "--cached", "--quiet"], [0, 1]);
        if (changed.code === 1) await git(task.projectRoot, ["commit", "-m", commitMessage]);
      } else {
        await git(task.projectRoot, ["merge", "--no-ff", "--no-edit", "-m", commitMessage, source]);
      }
    }
    const commit = (await git(task.projectRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`])).output;
    if ((await git(task.projectRoot, ["symbolic-ref", "-q", "HEAD"])).output !== baseRef) throw new Error("Base branch changed during merge");
    if ((await git(task.projectRoot, ["rev-parse", "--verify", `${workRef}^{commit}`])).output !== source) throw new Error("Task branch changed during merge; keeping the worktree");
    await git(task.projectRoot, ["merge-base", "--is-ancestor", base, commit]);
    if (expectedTree) {
      const tree = (await git(task.projectRoot, ["rev-parse", `${commit}^{tree}`])).output;
      if (tree !== expectedTree) throw new Error("Base commit does not contain the verified squash result");
    } else {
      await git(task.projectRoot, ["merge-base", "--is-ancestor", source, commit]);
    }
    await requireClean(git, task.projectRoot);
    await requireClean(git, task.worktreePath!);
    if (!casStatus(task.id, task.runSeq, ["merging"], "done", { mergeCommit: commit, lastError: null, finishedAt: nowIso() })) return;
    appendTaskEvent(task.projectRoot, { taskId: task.id, kind: "merged", actor: "engine", payload: { commit, baseBranch: task.baseBranch } });
    if (run) cleanupRun(run);
    if (intent.deleteWorktree) await cleanupMergedWorktree(task, source, commit);
}

/** Delete only after verified integration, without --force/-D. The expected
 * source SHA makes branch deletion a CAS, including for squash merges. */
async function cleanupMergedWorktree(task: WorkTask, source: string, commit: string): Promise<void> {
  const git = guardedGit(() => ownsTask(task, "done"));
  try {
    const workRef = `refs/heads/${task.workBranch}`;
    if ((await git(task.projectRoot, ["rev-parse", "--verify", workRef])).output !== source) throw new Error("Task branch changed after merge");
    await git(task.projectRoot, ["merge-base", "--is-ancestor", commit, `refs/heads/${task.baseBranch}`]);
    await requireClean(git, task.worktreePath!, true);
    if (!ownsTask(task, "done")) return;
    await removeWorktree(task.projectRoot, task.worktreePath!);
    if (!ownsTask(task, "done")) return;
    const worktrees = await listWorktrees(task.projectRoot);
    if (worktrees.some((worktree) => worktree.branch === task.workBranch)) throw new Error("Task branch is still checked out; keeping it");
    await git(task.projectRoot, ["update-ref", "-d", workRef, source]);
  } catch (error) {
    const current = loadTask(task.projectRoot, task.id);
    if (!current || current.runSeq !== task.runSeq || current.status !== "done") return;
    const message = error instanceof Error ? error.message : String(error);
    persist({ ...current, lastError: `Merged, but cleanup failed: ${message}` }, "cleanup_failed", "engine", { message });
  }
}

async function handleMergeEnd(run: LiveRun): Promise<void> {
  const task = currentRunTask(run);
  if (!task || task.status !== "merging" || !run.mergeIntent) return;
  await finishMerge(task, run.mergeIntent, run);
}

// ─── Reconcile / crash recovery ─────────────────────────────────────────────

async function bootReconcile(): Promise<void> {
  try {
    await reconcile();
  } catch {
    // Best effort at boot.
  }
}

async function reconcile(): Promise<void> {
  const eng = getEngine();
  if (!eng) return;
  // Sweep every project's tasks: tasks stuck in preparing/running without a
  // live run are failed (interrupted); queued tasks get pumped.
  const root = getProjectTasksDir("__engine__").replace(/__engine__$/, "");
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "__engine__") continue;
    const projectRoot = decodeProjectDir(entry.name);
    for (const task of loadTasks(projectRoot)) {
      const live = eng.byTask.get(task.id);
      const merge = eng.merging?.get(task.id);
      const owned = live?.runSeq === task.runSeq || (task.status === "merging" && merge?.runSeq === task.runSeq && merge.projectRoot === task.projectRoot);
      if (!owned && (task.status === "running" || task.status === "awaiting_input" || task.status === "merging")) {
        // Worker died (server restart). Mark interrupted.
        casStatus(task.id, task.runSeq, [task.status], "failed", {
          failureReason: "interrupted",
          lastError: "Engine restarted; the run was interrupted.",
          settledAt: nowIso(),
          finishedAt: nowIso(),
        });
        appendTaskEvent(projectRoot, { taskId: task.id, kind: "interrupted", actor: "engine" });
      } else if (!live && task.status === "preparing") {
        // Stuck preparing (crashed mid-launch): back to todo.
        casStatus(task.id, task.runSeq, ["preparing"], "todo", { startedAt: null });
        appendTaskEvent(projectRoot, { taskId: task.id, kind: "recovered", actor: "engine" });
      }
    }
    nudgePump(projectRoot);
  }
}
