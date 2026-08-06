/**
 * Work-task types for the Task Board feature (ported from codeg's model,
 * adapted to pi-web's JSONL storage and AgentSession execution model).
 *
 * Naming: "WorkTask*" mirrors codeg so cross-referencing the upstream design
 * stays easy. Wire form is camelCase (pi-web style), stored JSONL is the same
 * shape.
 */

// ─── Task status ────────────────────────────────────────────────────────────

export type WorkTaskStatus =
  | "todo"
  | "queued"
  /** Out of the queue, setting up: worktree, init command, agent spawn. */
  | "preparing"
  | "running"
  | "awaiting_input"
  | "review"
  | "merging"
  | "done"
  | "failed"
  | "canceled";

/** agent_error | setup_error | verdict_blocked | interrupted */
export type WorkTaskFailureReason =
  | "agent_error"
  | "setup_error"
  | "verdict_blocked"
  | "interrupted"
  | null;

/** The captured task definition stored in `workTask.config`. Optional
 *  agent/model fields are per-task overrides; empty = inherit the project's
 *  task settings at launch. */
export interface WorkTaskConfig {
  /** The task prompt sent to the agent on launch. */
  prompt: string;
  /** Optional per-task agent override (e.g. "claude", "codex"). */
  agentType?: string | null;
  /** Optional per-task model override. */
  modelId?: string | null;
  /** Optional per-task thinking level. */
  thinkingLevel?: string | null;
  /** Snapshot of the settings labels shown when the task was created. */
  labelSnapshot?: Record<string, string> | null;
}

export interface WorkTaskPreflight {
  status: "running" | "passed" | "failed";
  /** Display name of the project command that ran. */
  command: string;
  exitCode?: number | null;
  /** Trailing combined output — present when the light is red. */
  outputTail?: string | null;
}

export interface WorkTask {
  id: number;
  /** Absolute path of the project root this task belongs to. */
  projectRoot: string;
  title: string;
  /** Serialized task config; may be null for legacy rows. */
  config: WorkTaskConfig | null;
  status: WorkTaskStatus;
  failureReason: WorkTaskFailureReason;
  lastError: string | null;
  /** Launch generation — incremented on every start/retry; events match on
   *  (connectionId, runSeq) so a cancel racing a late turn is a no-op. */
  runSeq: number;
  /** Order within the todo column (per project). */
  sortOrder: number;
  /** Absolute path of the task's worktree, once created. */
  worktreePath: string | null;
  /** Session id of the task's AgentSession (the conversation in the worktree). */
  conversationId: string | null;
  /** Absolute path of the session's .jsonl file. */
  sessionFile: string | null;
  /** Base branch the worktree was cut from. */
  baseBranch: string | null;
  /** Work branch the task runs on. */
  workBranch: string | null;
  /** Acceptance verdict text (from the agent or user). */
  verdict: string | null;
  /** Agent-written summary shown on the card in review. */
  resultSummary: string | null;
  filesChanged: number | null;
  additions: number | null;
  deletions: number | null;
  /** Commit hash after a successful merge. */
  mergeCommit: string | null;
  /** Acceptance red/green light of the current review, if a preflight
   *  command ran. */
  preflight: WorkTaskPreflight | null;
  archivedAt: string | null;
  /** Latest agent_progress milestone — present on live rows only. */
  latestProgress?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  settledAt: string | null;
  finishedAt: string | null;
}

/** One append-only timeline entry ("how the task advanced"). */
export interface WorkTaskEvent {
  id: number;
  taskId: number;
  kind: string;
  actor: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkTaskDraft {
  projectRoot: string;
  title: string;
  config: WorkTaskConfig;
}

/** A saved task blueprint (global; the project is picked at creation time).
 *  Saving under an existing name replaces that template. */
export interface WorkTaskTemplate {
  id: number;
  name: string;
  title: string;
  config: WorkTaskConfig | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-project task defaults. */
export interface WorkTaskFolderSettings {
  defaultAgentType?: string | null;
  modeId?: string | null;
  configValues: Record<string, string>;
  /** Auto-process: engine starts tasks as soon as they are queued. */
  autoProcess: boolean;
  /** 0 = unlimited. */
  maxConcurrent: number;
  mergeStrategy: "squash" | "merge";
  deleteWorktreeDefault: boolean;
  /** Free-form preflight shell line; runs in the worktree when a task
   *  settles into review (the acceptance red/green light). */
  preflightCommand?: string | null;
  /** Shell line run inside a freshly created worktree before the agent
   *  starts (deps install, env seeding). */
  initCommand?: string | null;
  /** Extra instructions appended after the built-in prompt of a launch
   *  stage. Keys are engine stage ids (`work` | `retry` | `return` | `merge`)
   *  plus the reserved `all`. */
  stagePrompts?: Record<string, string> | null;
}

/** Changed file of a task worktree vs its recorded base. */
export interface WorkTaskChangedFile {
  file: string;
  additions: number;
  deletions: number;
}

/** Board column ids (DB statuses are exact; the UI aggregates them). */
export type BoardColumnId = "todo" | "inProgress" | "attention" | "done";

export const BOARD_COLUMN_IDS: BoardColumnId[] = [
  "todo",
  "inProgress",
  "attention",
  "done",
];

/**
 * DB status → board column. `canceled` lives in the Done column but is hidden
 * unless the "show canceled" toggle is on (filtered by `groupTasksByColumn`).
 */
export function columnForStatus(status: WorkTaskStatus): BoardColumnId {
  switch (status) {
    case "todo":
    case "queued":
      return "todo";
    case "preparing":
    case "running":
      return "inProgress";
    case "awaiting_input":
    case "review":
    case "merging":
    case "failed":
      return "attention";
    case "done":
    case "canceled":
      return "done";
  }
}

/**
 * Bucket tasks into the four columns, preserving list order (backend returns
 * board order: sort_order, id). Canceled tasks are dropped unless
 * `showCanceled`, archived ones unless `showArchived`.
 */
export function groupTasksByColumn(
  tasks: WorkTask[],
  showCanceled: boolean,
  showArchived = false,
): Record<BoardColumnId, WorkTask[]> {
  const grouped: Record<BoardColumnId, WorkTask[]> = {
    todo: [],
    inProgress: [],
    attention: [],
    done: [],
  };
  for (const task of tasks) {
    if (task.status === "canceled" && !showCanceled) continue;
    if (task.archivedAt != null && !showArchived) continue;
    grouped[columnForStatus(task.status)].push(task);
  }
  grouped.done.sort((a, b) => {
    const aCanceled = a.status === "canceled" ? 1 : 0;
    const bCanceled = b.status === "canceled" ? 1 : 0;
    if (aCanceled !== bCanceled) return aCanceled - bCanceled;
    return (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "");
  });
  return grouped;
}

/** Built-in fallback settings (project → global → built-in). */
export function defaultTaskSettings(): WorkTaskFolderSettings {
  return {
    defaultAgentType: null,
    modeId: null,
    configValues: {},
    autoProcess: true,
    maxConcurrent: 1,
    mergeStrategy: "merge",
    deleteWorktreeDefault: true,
    preflightCommand: null,
    initCommand: null,
    stagePrompts: null,
  };
}
