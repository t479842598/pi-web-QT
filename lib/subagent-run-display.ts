/**
 * Duration shown on a subagent run row.
 *
 * Three sources disagree, and the row must pick the right one:
 *
 * - `completedAt - createdAt` from the subagent's own session metadata is the
 *   authoritative wall-clock duration.
 * - The parent `Agent` tool call's duration (`toolDuration`) is only right for
 *   a foreground run — a background run returns as soon as the subagent is
 *   dispatched, so that number is far too small.
 * - While the run is live there is no `completedAt` yet, so the row ticks from
 *   `createdAt` to now instead.
 */

export interface SubagentDurationInput {
  /** ISO timestamps from the run's own session metadata. */
  startedAt?: string | null;
  completedAt?: string | null;
  /** Seconds between the parent Agent call's start and its result, if any. */
  toolDuration?: number | null;
  running: boolean;
  /** Current epoch ms — injected so the caller owns the clock. */
  nowMs: number;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole seconds between two epoch-ms values, or null when the range is invalid. */
function secondsBetween(from: number, to: number): number | null {
  if (to < from) return null;
  return Math.round((to - from) / 1000);
}

/**
 * `null` means "no defensible duration" — the caller should hide the value
 * rather than print a misleading one.
 */
export function resolveSubagentDuration(input: SubagentDurationInput): number | null {
  const started = parseMs(input.startedAt);
  const completed = parseMs(input.completedAt);

  if (input.running) {
    // A live run has no completion time yet; tick from its start.
    if (started !== null && input.nowMs >= started) return Math.max(0, Math.round((input.nowMs - started) / 1000));
    return input.toolDuration ?? null;
  }

  if (started !== null && completed !== null) {
    const elapsed = secondsBetween(started, completed);
    if (elapsed !== null) return elapsed;
  }

  return input.toolDuration ?? null;
}
