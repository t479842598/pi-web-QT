import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";

/**
 * Server-side goal engine for pi-web-QT.
 *
 * Modeled on pi-codex's goal extension (lyhue1991/pi-codex) and the existing
 * frontend goal loop: the goal runtime lives in the AgentSessionWrapper so it
 * survives page refreshes (persisted to a sidecar file) and keeps auto-running
 * via agent_settled even when the user leaves the chat ("wish-style
 * development").
 *
 * Design rules:
 * - The engine is a pure state machine + persistence. Driving (follow_up
 *   sends) is done by AgentSessionWrapper, which calls back into here.
 * - State is persisted to `<session>.jsonl.goal.json` with atomic tmp+rename
 *   writes (same pattern as queue-store).
 * - Terminal states: complete / budget_limited. Paused / blocked are
 *   resumable. idle means no goal.
 */

export type GoalStatus = "idle" | "running" | "paused" | "blocked" | "budget_limited" | "complete";

export interface GoalRuntimeState {
  status: GoalStatus;
  goalText: string | null;
  turnsUsed: number;
  turnsLimit: number;
  noProgressTurns: number;
  noProgressLimit: number;
  tokensUsed: number;
  /** Optional token budget; null = unbounded. */
  tokenBudget: number | null;
  /** Accumulated wall-clock seconds across goal turns. */
  timeUsedSeconds: number;
  /** Unix-ms timestamp when the goal run started. */
  startedAt?: number;
  /** Unix-ms timestamp of the last state change. */
  updatedAt?: number;
}

/** Default turn quota for a goal run (mirrors Reasonix budgetClassSimple). */
export const DEFAULT_GOAL_TURNS_LIMIT = 10;
/** Pause after this many consecutive turns with no host-verifiable progress. */
export const DEFAULT_GOAL_NO_PROGRESS_LIMIT = 4;

/** Injected via followUp after every goal turn that is not done/blocked. */
export const GOAL_CONTINUE_INSTRUCTION =
  `Continue pursuing the active goal. Do the next useful work, then report your disposition:\n` +
  `- "continue" with the next concrete step;\n` +
  `- "complete" only when fully done and verified;\n` +
  `- "blocked" when only the user can unblock you.`;

/** Assistant message markers that end or pause the goal loop. */
export const GOAL_COMPLETE_MARKERS = ["goal complete", "[goal: complete]", "goal is complete"];
export const GOAL_BLOCKED_MARKERS = ["goal blocked", "[goal: blocked]", "blocked:"];

interface GoalFile {
  version: 1;
  state: GoalRuntimeState;
}

export function goalSidecarPath(sessionFile: string): string {
  return `${sessionFile}.goal.json`;
}

/** Load persisted goal state; returns idle state when absent or corrupt. */
export function loadGoalState(sessionFile: string): GoalRuntimeState {
  const path = goalSidecarPath(sessionFile);
  if (!existsSync(path)) return initialState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GoalFile>;
    if (!parsed || parsed.version !== 1 || !parsed.state || typeof parsed.state !== "object") {
      return initialState();
    }
    const s = parsed.state;
    return {
      status: sanitizeStatus(s.status),
      goalText: typeof s.goalText === "string" ? s.goalText : null,
      turnsUsed: Number.isFinite(s.turnsUsed) ? s.turnsUsed : 0,
      turnsLimit: Number.isFinite(s.turnsLimit) ? s.turnsLimit : DEFAULT_GOAL_TURNS_LIMIT,
      noProgressTurns: Number.isFinite(s.noProgressTurns) ? s.noProgressTurns : 0,
      noProgressLimit: Number.isFinite(s.noProgressLimit)
        ? s.noProgressLimit
        : DEFAULT_GOAL_NO_PROGRESS_LIMIT,
      tokensUsed: Number.isFinite(s.tokensUsed) ? s.tokensUsed : 0,
      tokenBudget: s.tokenBudget === null || Number.isFinite(s.tokenBudget) ? s.tokenBudget ?? null : null,
      timeUsedSeconds: Number.isFinite(s.timeUsedSeconds) ? s.timeUsedSeconds : 0,
      startedAt: Number.isFinite(s.startedAt) ? s.startedAt : undefined,
      updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : undefined,
    };
  } catch {
    // Corrupt sidecar — treat as idle rather than blocking the session.
    return initialState();
  }
}

function sanitizeStatus(status: unknown): GoalStatus {
  const known: GoalStatus[] = ["idle", "running", "paused", "blocked", "budget_limited", "complete"];
  return known.includes(status as GoalStatus) ? (status as GoalStatus) : "idle";
}

function initialState(): GoalRuntimeState {
  return {
    status: "idle",
    goalText: null,
    turnsUsed: 0,
    turnsLimit: DEFAULT_GOAL_TURNS_LIMIT,
    noProgressTurns: 0,
    noProgressLimit: DEFAULT_GOAL_NO_PROGRESS_LIMIT,
    tokensUsed: 0,
    tokenBudget: null,
    timeUsedSeconds: 0,
  };
}

/** Atomically persist goal state next to the session file. */
export function saveGoalState(sessionFile: string, state: GoalRuntimeState): void {
  const path = goalSidecarPath(sessionFile);
  const tmp = `${path}.tmp`;
  try {
    const payload: GoalFile = { version: 1, state };
    writeFileSync(tmp, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try {
      // Best-effort cleanup of the temp file on failure.
      rmSync(tmp, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

// ---------------------------------------------------------------------------
// Goal engine
// ---------------------------------------------------------------------------

export type GoalTurnVerdict =
  | { action: "continue" }
  | { action: "complete" }
  | { action: "blocked" }
  | { action: "pause" }
  | { action: "budget_limited" };

export class GoalEngine {
  private state: GoalRuntimeState;
  /** Guards against double continuation while a continuation is being armed. */
  private continuationArmed = false;
  /** Wall-clock anchor for the current running turn (ms). */
  private turnStartMs = 0;
  private onChanged: ((state: GoalRuntimeState) => void) | null = null;

  constructor(sessionFile?: string) {
    this.state = sessionFile ? loadGoalState(sessionFile) : initialState();
  }

  /** Replace internal state from a persisted snapshot (rehydration). */
  hydrate(state: GoalRuntimeState): void {
    this.state = { ...state };
  }

  getState(): GoalRuntimeState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.status === "running";
  }

  hasActiveGoal(): boolean {
    return this.state.status !== "idle";
  }

  isContinuable(): boolean {
    return this.state.status === "running";
  }

  isContinuationArmed(): boolean {
    return this.continuationArmed;
  }

  armContinuation(): void {
    this.continuationArmed = true;
  }

  disarmContinuation(): void {
    this.continuationArmed = false;
  }

  /** Called when the agent actually starts a turn (agent_start / turn_start). */
  onAgentStart(): void {
    this.continuationArmed = false;
    this.turnStartMs = Date.now();
  }

  setOnChanged(cb: ((state: GoalRuntimeState) => void) | null): void {
    this.onChanged = cb;
  }

  private commit(next: GoalRuntimeState): void {
    next.updatedAt = Date.now();
    this.state = next;
    this.onChanged?.(this.getState());
  }

  start(goalText: string, tokenBudget: number | null = null): GoalRuntimeState {
    const now = Date.now();
    // Preserve an existing budget when the caller does not specify one, so
    // repeated goal_start without a budget does not silently drop it.
    const budget = tokenBudget ?? this.state.tokenBudget ?? null;
    const next: GoalRuntimeState = {
      status: "running",
      goalText: goalText.trim(),
      turnsUsed: 0,
      turnsLimit: this.state.turnsLimit,
      noProgressTurns: 0,
      noProgressLimit: this.state.noProgressLimit,
      tokensUsed: 0,
      tokenBudget: budget,
      timeUsedSeconds: 0,
      startedAt: now,
      updatedAt: now,
    };
    this.commit(next);
    return this.getState();
  }

  pause(): GoalRuntimeState {
    if (this.state.status !== "running") return this.getState();
    this.commit({ ...this.state, status: "paused" });
    return this.getState();
  }

  resume(): GoalRuntimeState {
    if (this.state.status !== "paused" && this.state.status !== "blocked") return this.getState();
    this.commit({ ...this.state, status: "running" });
    return this.getState();
  }

  stop(): GoalRuntimeState {
    if (this.state.status === "idle") return this.getState();
    const next = initialState();
    next.turnsLimit = this.state.turnsLimit;
    next.noProgressLimit = this.state.noProgressLimit;
    this.commit(next);
    this.continuationArmed = false;
    return this.getState();
  }

  edit(goalText: string): GoalRuntimeState {
    if (this.state.status === "idle") return this.getState();
    const status = this.state.status === "complete" || this.state.status === "budget_limited"
      ? "running"
      : this.state.status;
    this.commit({ ...this.state, goalText: goalText.trim(), status });
    return this.getState();
  }

  /**
   * Settle the current turn: increment turn count, account wall time and token
   * usage, detect no-progress stalls and budget exhaustion, then decide the
   * next action. `lastAssistantText` and `toolCallsThisTurn` come from the
   * caller (wrapper) since the engine is decoupled from message storage.
   */
  settleTurn(
    lastAssistantText: string,
    tokenDelta: number,
    toolCallsThisTurn: number,
  ): { verdict: GoalTurnVerdict; state: GoalRuntimeState } {
    if (this.state.status !== "running") {
      return { verdict: { action: "continue" }, state: this.getState() };
    }

    const lower = (lastAssistantText ?? "").toLowerCase();
    // Account usage/wall time before the terminal branches so the final turn's
    // consumption is recorded, then apply the marker verdicts.
    const wallSec = this.turnStartMs > 0 ? Math.max(0, Math.round((Date.now() - this.turnStartMs) / 1000)) : 0;
    const tokensUsed = this.state.tokensUsed + Math.max(0, tokenDelta);
    const timeUsedSeconds = this.state.timeUsedSeconds + wallSec;
    const turnsUsed = this.state.turnsUsed + 1;

    if (GOAL_COMPLETE_MARKERS.some((m) => lower.includes(m))) {
      const next = {
        ...this.state,
        turnsUsed,
        tokensUsed,
        timeUsedSeconds,
      };
      this.commit({ ...next, status: "complete" });
      return { verdict: { action: "complete" }, state: this.getState() };
    }
    if (GOAL_BLOCKED_MARKERS.some((m) => lower.includes(m))) {
      const next = {
        ...this.state,
        turnsUsed,
        tokensUsed,
        timeUsedSeconds,
      };
      this.commit({ ...next, status: "blocked" });
      return { verdict: { action: "blocked" }, state: this.getState() };
    }

    const noProgressTurns = toolCallsThisTurn === 0 ? this.state.noProgressTurns + 1 : 0;

    // Token budget exhausted → terminal.
    if (this.state.tokenBudget !== null && tokensUsed >= this.state.tokenBudget) {
      this.commit({
        ...this.state,
        turnsUsed,
        tokensUsed,
        timeUsedSeconds,
        noProgressTurns,
        status: "budget_limited",
      });
      return { verdict: { action: "budget_limited" }, state: this.getState() };
    }
    // No-progress stall → blocked (resumable).
    if (noProgressTurns >= this.state.noProgressLimit) {
      this.commit({
        ...this.state,
        turnsUsed,
        tokensUsed,
        timeUsedSeconds,
        noProgressTurns,
        status: "blocked",
      });
      return { verdict: { action: "blocked" }, state: this.getState() };
    }
    // Turn budget exhausted → paused (resumable).
    if (turnsUsed >= this.state.turnsLimit) {
      this.commit({
        ...this.state,
        turnsUsed,
        tokensUsed,
        timeUsedSeconds,
        noProgressTurns,
        status: "paused",
      });
      return { verdict: { action: "pause" }, state: this.getState() };
    }

    this.commit({ ...this.state, turnsUsed, tokensUsed, timeUsedSeconds, noProgressTurns });
    return { verdict: { action: "continue" }, state: this.getState() };
  }
}
