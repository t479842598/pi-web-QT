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

interface LiveRun {
  taskId: number;
  runSeq: number;
  connectionId: string;
  /** Project root where the task row lives (NOT the worktree cwd). */
  projectRoot: string;
  session: AgentSessionWrapper;
  /** Outstanding requests that need a user response (awaiting_input). */
  pendingRequests: Set<string>;
}

interface EngineState {
  /** connectionId → live run. */
  live: Map<string, LiveRun>;
  /** taskId → live run (for lookup by task). */
  byTask: Map<number, LiveRun>;
  /** Tasks currently being launched (preparing), with ownership token. */
  launching: Map<number, number>;
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
    pumpLocks: new Map(),
    reconcileTimer: null,
    stopped: false,
  };
  setEngineState(state);
  void bootReconcile();
  state.reconcileTimer = setInterval(() => {
    void reconcile();
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
        await runShellIn(projectRoot, `git branch -D ${JSON.stringify(task.workBranch)}`);
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
      eng.live.delete(session.sessionId);
      eng.byTask.delete(taskId);
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
    if (t && (t.status === "preparing" || t.status === "queued")) {
      casStatus(taskId, t.runSeq, [t.status], "failed", {
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
  return header + base + (stage ? `\n\n${stage}` : "");
}

// ─── Session event handling ─────────────────────────────────────────────────

/** Wire a live run's session events to the state machine. Called once after
 *  launch; keeps running for the session's lifetime. */
function attachEventHandlers(run: LiveRun): void {
  run.session.onEvent((event) => {
    const type = event.type as string;
    void (async () => {
      const eng = getEngine();
      const current = eng.live.get(run.connectionId);
      if (!current || current.taskId !== run.taskId) return;

      const task = loadTask(run.projectRoot, run.taskId);
      if (!task || task.status !== "running" && task.status !== "awaiting_input" && task.status !== "merging") return;

      switch (type) {
        case "extension_ui_request": {
          // confirm / input / select / editor need a user response.
          const method = (event as { method?: string }).method;
          const id = (event as { id?: string }).id;
          if (method && id && ["confirm", "input", "select", "editor"].includes(method)) {
            run.pendingRequests.add(id);
            if (task.status === "running") {
              casStatus(run.taskId, run.runSeq, ["running"], "awaiting_input");
              appendTaskEvent(task.projectRoot, { taskId: run.taskId, kind: "awaiting_input", actor: "engine", payload: { method, id } });
            }
          }
          break;
        }
        case "extension_ui_response": {
          const id = (event as { id?: string }).id;
          if (id && run.pendingRequests.delete(id)) {
            if (run.pendingRequests.size === 0 && task.status === "awaiting_input") {
              casStatus(run.taskId, run.runSeq, ["awaiting_input"], "running");
            }
          }
          break;
        }
        case "agent_end": {
          // A turn finished. If the agent asked a question or there are
          // pending requests, stay; otherwise the run settled.
          if (run.pendingRequests.size > 0) break;
          if (task.status === "merging") {
            handleMergeEnd(run);
            break;
          }
          void settleToReview(run, task);
          break;
        }
        case "prompt_error": {
          const message = (event as { errorMessage?: string }).errorMessage ?? "agent error";
          casStatus(run.taskId, run.runSeq, ["running", "awaiting_input"], "failed", {
            failureReason: "agent_error",
            lastError: message,
            settledAt: nowIso(),
            finishedAt: nowIso(),
          });
          appendTaskEvent(task.projectRoot, { taskId: run.taskId, kind: "failed", actor: "engine", payload: { reason: "agent_error", message } });
          cleanupRun(run);
          break;
        }
        case "agent_start": {
          // A follow-up turn started (e.g. merge turn or return feedback).
          if (task.status === "awaiting_input" && run.pendingRequests.size === 0) {
            casStatus(run.taskId, run.runSeq, ["awaiting_input"], "running");
          }
          break;
        }
        default:
          break;
      }
    })();
  });
}

/** running → review (with preflight). */
async function settleToReview(run: LiveRun, task: WorkTask): Promise<void> {
  const eng = getEngine();
  const current = eng.live.get(run.connectionId);
  if (!current || current.taskId !== run.taskId) return;

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
  const task = loadTask(run.projectRoot, run.taskId);
  if (!task) return;
  persist(
    { ...task, preflight: { status: "running", command } },
    "preflight_start",
    "engine",
    { command },
  );
  try {
    const result = await runShellCapture(run.session.cwd, command);
    const live = loadTask(run.projectRoot, run.taskId);
    if (!live) return;
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
    const task2 = loadTask(run.projectRoot, run.taskId);
    if (!task2) return;
    persist(
      { ...task2, preflight: { status: "failed", command, outputTail: error instanceof Error ? error.message : String(error) } },
      "preflight_failed",
      "engine",
      { command },
    );
  }
}

function cleanupRun(run: LiveRun): void {
  const eng = getEngine();
  eng.live.delete(run.connectionId);
  eng.byTask.delete(run.taskId);
}

// ─── Shell helpers (init command, preflight) ────────────────────────────────

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

export async function cancelTask(id: number, projectRoot: string): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task) return;
  const eng = getEngineState();
  const run = eng?.byTask.get(id);
  if (run && eng) {
    // Abort the session; the abort lands as a no-op if the turn already ended.
    await run.session.send({ type: "abort" }).catch(() => undefined);
    casStatus(id, run.runSeq, ["running", "awaiting_input", "preparing", "queued"], "canceled", {
      settledAt: nowIso(),
      finishedAt: nowIso(),
    });
    eng.live.delete(run.connectionId);
    eng.byTask.delete(id);
  } else {
    casStatus(id, task.runSeq, ["todo", "queued", "preparing"], "canceled", {
      settledAt: nowIso(),
      finishedAt: nowIso(),
    });
  }
  appendTaskEvent(projectRoot, { taskId: id, kind: "canceled", actor: "user" });
}

export async function retryTask(id: number, projectRoot: string): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "failed") return;
  const next = { ...task, status: "queued" as WorkTaskStatus, runSeq: task.runSeq + 1, lastError: null, failureReason: null };
  persist(next, "queued", "user", { retry: true });
  nudgePump(projectRoot);
}

export async function requeueTask(id: number, projectRoot: string): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "canceled") return;
  const next = { ...task, status: "todo" as WorkTaskStatus, lastError: null, failureReason: null };
  persist(next, "requeued", "user");
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

export async function mergeTask(id: number, projectRoot: string, message: string | null, deleteWorktree: boolean): Promise<void> {
  const task = loadTask(projectRoot, id);
  if (!task || task.status !== "review") return;

  const eng = getEngineState();
  const run = eng?.byTask.get(id);
  const next = { ...task, status: "merging" as WorkTaskStatus };
  persist(next, "merging", "user", { message, deleteWorktree });
  appendTaskEvent(projectRoot, { taskId: id, kind: "merge_requested", actor: "user", payload: { message, deleteWorktree } });

  try {
    if (run) {
      // Agent-driven merge: send a follow-up prompt in the same session.
      const mergePrompt =
        `Merge your changes into the base branch (${task.baseBranch ?? "the current base"}).\n` +
        `Rules:\n` +
        `- Work ONLY in this worktree; run git merge/commit from this worktree directory.\n` +
        `- Do NOT commit unrelated changes that exist in other checkouts — commit only the files your task changed.\n` +
        `- Do NOT touch or push other branches.\n` +
        (message ? `Use this commit message: "${message}"\n` : "Write a concise commit message yourself.\n") +
        (deleteWorktree ? "After merging, the worktree may be cleaned up." : "Keep the worktree after merging.");
      await run.session.send({ type: "prompt", message: mergePrompt });
      // The merge turn's agent_end lands → done (see handleMergeEnd).
    } else {
      // No live session: do a plain git merge (squash) via shell.
      await gitMergeShell(projectRoot, task, message, deleteWorktree);
    }
  } catch (error) {
    const message2 = error instanceof Error ? error.message : String(error);
    const live = loadTask(projectRoot, id);
    if (live && live.status === "merging") {
      casStatus(id, live.runSeq, ["merging"], "review", {
        lastError: `Merge failed: ${message2}`,
      });
      appendTaskEvent(projectRoot, { taskId: id, kind: "merge_failed", actor: "engine", payload: { message: message2 } });
    }
  }
}

async function gitMergeShell(projectRoot: string, task: WorkTask, message: string | null, deleteWorktree: boolean): Promise<void> {
  if (!task.worktreePath || !task.workBranch) throw new Error("No worktree to merge");
  // Safety: never run a shell merge against a dirty main checkout — the
  // merge could sweep unrelated uncommitted changes into the commit.
  const status = await runShellCapture(projectRoot, "git status --porcelain");
  if (status.output.trim().length > 0) {
    throw new Error(
      "Main checkout has uncommitted changes; the agent-driven merge cannot run. Commit or stash them first.",
    );
  }
  const squash = message != null;
  // Worktree branch → base branch (main repo)
  await runShellIn(projectRoot, `git merge --${squash ? "squash" : "no-ff"} ${task.workBranch}`);
  if (squash) {
    const msg = message || `Merge task ${task.id}: ${task.title}`;
    await runShellIn(projectRoot, `git commit -m ${JSON.stringify(msg)}`);
  }
  const commit = await runShellCapture(projectRoot, "git rev-parse --short HEAD");
  casStatus(task.id, task.runSeq, ["merging"], "done", {
    mergeCommit: commit.output.trim(),
    finishedAt: nowIso(),
  });
  appendTaskEvent(projectRoot, { taskId: task.id, kind: "merged", actor: "engine", payload: { commit: commit.output.trim() } });
  if (deleteWorktree && task.worktreePath) {
    await removeWorktree(projectRoot, task.worktreePath, true).catch(() => undefined);
  }
  if (deleteWorktree && task.workBranch) {
    await runShellIn(projectRoot, `git branch -D ${JSON.stringify(task.workBranch)}`).catch(() => undefined);
  }
}

/** Handle agent_end during a merge turn → done. */
function handleMergeEnd(run: LiveRun): void {
  const task = loadTask(run.projectRoot, run.taskId);
  if (!task || task.status !== "merging") return;
  const commit = runShellCapture(run.session.cwd, "git rev-parse --short HEAD").then((r) => r.output.trim()).catch(() => null);
  void commit.then(async (hash) => {
    const live = loadTask(run.projectRoot, run.taskId);
    if (!live) return;
    casStatus(live.id, live.runSeq, ["merging"], "done", {
      mergeCommit: hash,
      finishedAt: nowIso(),
    });
    appendTaskEvent(live.projectRoot, { taskId: live.id, kind: "merged", actor: "engine", payload: { commit: hash } });
    // Engine-side cleanup: drop the worktree + branch after an agent-driven
    // merge so a finished task never leaves the repo cluttered.
    try {
      if (live.worktreePath) {
        await removeWorktree(run.projectRoot, live.worktreePath, true).catch(() => undefined);
      }
      if (live.workBranch) {
        await runShellIn(run.projectRoot, `git branch -D ${JSON.stringify(live.workBranch)}`).catch(() => undefined);
      }
    } catch {
      // Best-effort cleanup; a leftover worktree is visible in git worktree list.
    }
  });
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
      if (!live && (task.status === "running" || task.status === "awaiting_input" || task.status === "merging")) {
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
