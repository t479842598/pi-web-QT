import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, Theme } from "@earendil-works/pi-coding-agent";
import type { StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { resolve } from "path";
import { validateAgentImages } from "./image-attachments";
import { createQueueEntry, loadQueue, removeQueue, saveQueue, type PendingRecoveryItem, type QueueEntry, type QueueEntryInput, type QueueImage, type QueueKind } from "./queue-store";
import { invalidateModelsCache } from "./models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "./model-scope";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { persistExplicitStartupPreferences } from "./startup-preferences";
import { readModeSettings } from "./modes-config";
import { decide, policyFromStrings, type Policy } from "./permission";
import { READ_ONLY_TOOL_NAMES } from "./modes";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "./custom-ui-terminal";
import { recordErrorLog } from "./error-log";
import { GoalEngine, GOAL_CONTINUE_INSTRUCTION, loadGoalState, saveGoalState, type GoalRuntimeState } from "./goal-engine";
import { AsyncProcessManager } from "./async-bash";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type RunningSnapshot = {
  id: string;
  running: boolean;
  isStreaming: boolean;
  isPromptRunning: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  phase: "waiting_model" | "running_command" | null;
};

type RunningListener = (snapshots: RunningSnapshot[]) => void;

/** Goal state pushed to clients via SSE after every goal state change. */
export type GoalStateChangedEvent = {
  type: "goal_state_changed";
  goalState: GoalRuntimeState;
};

/**
 * Count tool calls across all assistant messages in the session entries.
 * Used by the goal engine's no-progress detection (a turn with zero tool
 * calls counts as stalled).
 */
function countToolCallsInEntries(entries: unknown[]): number {
  let count = 0;
  for (const entry of entries) {
    const msg = (entry as { type?: string; message?: { role?: string; content?: unknown } })?.message;
    if (!msg || msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "toolCall") count += 1;
    }
  }
  return count;
}

/**
 * Sum input/output/cache token usage across every assistant message in the
 * session entries. Pi records per-message usage (each assistant message holds
 * its own turn's consumption), so the running total is the correct baseline
 * for computing per-turn deltas.
 */
function sumAssistantUsage(entries: unknown[]): number {
  let total = 0;
  for (const entry of entries) {
    const msg = (entry as { type?: string; message?: { role?: string; usage?: unknown } })?.message;
    if (!msg || msg.role !== "assistant") continue;
    const usage = msg.usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
    if (!usage) continue;
    total += (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  }
  return total;
}


/** A session event broadcast to every connected client (cross-client sync). */
export type SessionBusEvent = {
  type: string;
  sessionId: string;
  payload?: unknown;
};

type SessionBusListener = (event: SessionBusEvent) => void;

/**
 * Events worth broadcasting to other clients. Streaming `message_update`
 * carries the full accumulated message; the bus coalesces it separately.
 */
const SESSION_BUS_EVENT_TYPES = new Set([
  "agent_start",
  "message_start",
  "message_update",
  "message_end",
  "agent_end",
  "entry_appended",
  "session_info_changed",
  "queue_update",
  "prompt_done",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

/** Coalescing window for streaming message_update on the bus (mirrors SSE). */
const SESSION_BUS_COALESCE_MS = 80;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

/** A tool-approval request waiting on the user. */
type PendingApproval = {
  resolve: (verdict: { approve: boolean; reason?: string }) => void;
  timer: NodeJS.Timeout;
  toolName: string;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

/**
 * Compact tool-call args for the approval UI: keep short scalar fields, drop
 * large payloads (file contents, base64, long text). The full args stay on the
 * server; only a safe preview crosses the SSE boundary.
 */
function summarizeApprovalArgs(args: unknown): unknown {
  if (args === null || typeof args !== "object") return args;
  const input = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "content" || key === "data" || key === "newString" || key === "oldString") continue;
    if (typeof value === "string") {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    // Nested objects are summarized as a marker to avoid deep serialization.
    out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
  }
  return out;
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

/** Grace period after the last event listener detaches before an idle session
 *  is shut down. Covers the common local case of a closed tab: the per-session
 *  SSE unsubscribes on disconnect, so an unwatched idle wrapper is reclaimed
 *  instead of lingering until the (long) idle timeout. Reconnecting within the
 *  window cancels the disposal. */
const DISPOSE_GRACE_MS = 60_000;

/** Safety net for the session registry: when more than this many wrappers are
 *  alive, idle AND unwatched wrappers are evicted oldest-first. Sessions being
 *  streamed (an SSE client subscribed) or actively running are never evicted. */
const MAX_REGISTERED_SESSIONS = 12;

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private promptPhase: "waiting_model" | "running_command" | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Number of live event listeners (per-session SSE + task engine). */
  private subscriberCount = 0;
  /** Pending disposal armed when the last listener detached while idle. */
  private disposeGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic-ish activity marker used to evict oldest unwatched wrappers. */
  private lastActivityAt = Date.now();
  private queueMirror: QueueEntry[] = [];
  private queueRecovery: QueueEntry[] = [];
  private pendingQueueHints: Record<QueueKind, QueueImage[][]> = { steer: [], followUp: [] };
  private queueMutationTail: Promise<void> = Promise.resolve();
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;
  private approvalPolicy: Policy = policyFromStrings(readModeSettings().permissionRules);
  private approvalMode: "ask" | "auto" | "yolo" = readModeSettings().toolApprovalMode;
  private pendingApprovals = new Map<string, PendingApproval>();
  private approvalSeq = 0;
  private approvalHookInstalled = false;
  /** Server-side goal engine (wish-style development). Persisted to a sidecar. */
  private readonly goalEngine = new GoalEngine();
  /** Tokens already accounted for by the goal engine (to compute per-turn delta). */
  private goalTokensAccounted = 0;
  /** Tool-call count already accounted for (to compute per-turn no-progress). */
  private goalToolCallsAccounted = 0;
  /** Set while a goal continuation follow_up is in flight to avoid double-drive. */
  private goalContinuationInFlight = false;

  constructor(public readonly inner: AgentSessionLike, public readonly cwd: string) {
    // Existing conversations keep their own approval mode/policy (per-session
    // override in settings.json `modesPerSession`); brand-new sessions fall
    // back to the global defaults.
    const perSession = readModeSettings(inner.sessionId);
    this.approvalMode = perSession.toolApprovalMode;
    this.approvalPolicy = policyFromStrings(perSession.permissionRules);
    if (inner.sessionFile) {
      const restored = loadGoalState(inner.sessionFile);
      if (restored.status !== "idle") {
        this.goalEngine.hydrate(restored);
      }
    }
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  /** True once shutdown has been initiated (destroy may still be pending). */
  isShuttingDown(): boolean {
    return this.shutdownPromise !== null;
  }

  /** Resolves when the in-progress shutdown completes (null otherwise). */
  whenShutdown(): Promise<void> | null {
    return this.shutdownPromise;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  runtimeSnapshot(): RunningSnapshot {
    const isStreaming = this.inner.isStreaming;
    const isPromptRunning = this.promptRunning;
    const isCompacting = this.inner.isCompacting;
    const isBashRunning = this.inner.isBashRunning;
    return {
      id: this.sessionId,
      running: this.isRunning(),
      isStreaming,
      isPromptRunning,
      isCompacting,
      isBashRunning,
      phase: isBashRunning ? "running_command" : this.promptPhase ?? ((isStreaming || isPromptRunning || isCompacting) ? "waiting_model" : null),
    };
  }

  start(): void {
    this.installApprovalHook();
    this.goalEngine.setOnChanged((state) => {
      if (this.sessionFile) saveGoalState(this.sessionFile, state);
      this.emit({ type: "goal_state_changed", goalState: state } as AgentEvent);
      broadcastSessionBusEvent("goal_state_changed", this.sessionId, {
        type: "goal_state_changed",
        goalState: state,
      });
    });
    // Wrapper (re)created with a persisted running goal: kick the loop once so
    // an idle agent resumes after a page refresh / wrapper rebuild instead of
    // stalling forever (agent_settled only fires after a run).
    if (this.goalEngine.isRunning()) {
      this.scheduleGoalKick();
    }
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end" || event.type === "message_end" || event.type === "entry_appended" || event.type === "session_info_changed") {
        invalidateSessionListCache();
      }
      if (event.type === "agent_end" || event.type === "agent_settled" || event.type === "auto_compaction_end" || event.type === "compaction_end") {
        this.resetIdleTimer();
      }
      if (event.type === "agent_start") {
        this.goalEngine.onAgentStart();
      }
      if (event.type === "agent_settled") {
        this.handleGoalSettled();
      }
      if (event.type === "queue_update") {
        this.reconcileQueue(event.steering as string[] | undefined, event.followUp as string[] | undefined);
      }
      if (SESSION_BUS_EVENT_TYPES.has(event.type)) {
        broadcastSessionBusEvent(event.type, this.sessionId, event);
      }
      this.emit(event);
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  loadQueueRecovery(): void {
    if (!this.sessionFile) return;
    const steering = this.inner.getSteeringMessages();
    const followUp = this.inner.getFollowUpMessages();
    if (steering.length || followUp.length) {
      this.queueRecovery = [];
      this.reconcileQueue([...steering], [...followUp]);
      return;
    }
    this.queueRecovery = loadQueue(this.sessionFile);
  }

  // ---------------------------------------------------------------------------
  // Goal mode (wish-style development) — server-side drive
  // ---------------------------------------------------------------------------

  getGoalState(): GoalRuntimeState {
    return this.goalEngine.getState();
  }

  /**
   * Called when the agent settles idle. Settles the current goal turn, then
   * auto-continues when the goal is still running and within budget.
   */
  private handleGoalSettled(): void {
    if (!this.goalEngine.isRunning()) {
      this.goalEngine.disarmContinuation();
      return;
    }

    // Settle the turn that just finished.
    const lastText = this.inner.getLastAssistantText() ?? "";
    let tokenDelta = 0;
    let toolCallsThisTurn = 0;
    try {
      const entries = this.inner.sessionManager.getEntries();
      const total = sumAssistantUsage(entries);
      tokenDelta = Math.max(0, total - this.goalTokensAccounted);
      this.goalTokensAccounted = total;
      // Per-turn tool calls = delta since the last settlement (zero-call turns
      // count as stalled; a single historical tool call must not mask it).
      const totalCalls = countToolCallsInEntries(entries);
      toolCallsThisTurn = Math.max(0, totalCalls - this.goalToolCallsAccounted);
      this.goalToolCallsAccounted = totalCalls;
    } catch {
      // Settlement must never crash the wrapper event loop.
    }

    const { verdict } = this.goalEngine.settleTurn(lastText, tokenDelta, toolCallsThisTurn);
    if (verdict.action !== "continue") {
      this.goalEngine.disarmContinuation();
      return;
    }

    this.scheduleGoalKick();
  }

  /**
   * Drive one goal continuation when the agent is idle. Guards against double
   * drives and queues a kick when the agent is mid-run (settled again later).
   */
  private scheduleGoalKick(): void {
    if (!this.goalEngine.isRunning()) return;
    if (this.goalContinuationInFlight) return;
    if (this.goalEngine.isContinuationArmed()) {
      this.goalEngine.disarmContinuation();
      this.driveGoalContinuation();
      return;
    }
    if (this.inner.isStreaming || this.promptRunning || this.inner.pendingMessageCount > 0) return;
    this.driveGoalContinuation();
  }

  /** Fire one follow_up continuation for the active goal. */
  private driveGoalContinuation(): void {
    if (!this.goalEngine.isRunning() || this.goalContinuationInFlight) return;
    this.goalContinuationInFlight = true;
    void this.inner.followUp(GOAL_CONTINUE_INSTRUCTION)
      .catch(() => {})
      .finally(() => {
        this.goalContinuationInFlight = false;
      });
  }

  private handleGoalStartCommand(goalText: string, tokenBudget: number | null): GoalRuntimeState {
    const state = this.goalEngine.start(goalText, tokenBudget);
    this.goalTokensAccounted = 0;
    this.goalToolCallsAccounted = 0;
    return state;
  }

  private handleGoalStopCommand(): GoalRuntimeState {
    this.goalEngine.stop();
    this.goalTokensAccounted = 0;
    return this.goalEngine.getState();
  }

  // ---------------------------------------------------------------------------
  // Tool approval — wraps agent.beforeToolCall (installed by AgentSession for
  // extension tool_call forwarding). We keep the SDK handler as the tail of the
  // chain: run the policy gate first, then delegate to the original handler so
  // extensions still see every tool call.
  // ---------------------------------------------------------------------------

  /** Update the approval mode at runtime (ask | auto | yolo). */
  setApprovalMode(mode: "ask" | "auto" | "yolo"): void {
    this.approvalMode = mode;
  }

  /** Update the permission policy at runtime (deny > ask > allow rules). */
  setApprovalPolicy(policy: Policy): void {
    this.approvalPolicy = policy;
  }

  private installApprovalHook(): void {
    if (this.approvalHookInstalled || !this.inner.agent?.beforeToolCall) return;
    this.approvalHookInstalled = true;
    const original = this.inner.agent.beforeToolCall;
    this.inner.agent.beforeToolCall = async (context) => {
      const toolName = context.toolCall?.name ?? "";
      const args = context.args;
      const decision = decide(this.approvalPolicy, toolName, {
        mode: this.approvalMode,
        readOnly: READ_ONLY_TOOL_NAMES.has(toolName.toLowerCase()),
        args,
      });
      if (decision === "deny") {
        return { block: true, reason: `Denied by policy rule: ${toolName} is not permitted.` };
      }
      if (decision === "ask") {
        const approved = await this.askForApproval(toolName, args);
        if (!approved.approve) {
          return { block: true, reason: approved.reason || `Rejected by user: ${toolName}` };
        }
      }
      return original ? original(context) : undefined;
    };
  }

  private askForApproval(toolName: string, args: unknown): Promise<{ approve: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const id = `approval-${++this.approvalSeq}`;
      // Timeout: auto-deny after 120s so a stale request cannot hang the loop.
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(id);
        this.emit({
          type: "tool_approval_resolved",
          id,
          approve: false,
          reason: `Approval request timed out after 120s: ${toolName}`,
        });
        resolve({ approve: false, reason: `Approval request timed out after 120s: ${toolName}` });
      }, 120_000);
      this.pendingApprovals.set(id, { resolve, timer, toolName });
      this.emit({
        type: "tool_approval_request",
        id,
        toolName,
        args: summarizeApprovalArgs(args),
      });
    });
  }

  private resolveApproval(id: string, approve: boolean, reason?: string): boolean {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    this.pendingApprovals.delete(id);
    clearTimeout(pending.timer);
    pending.resolve({ approve, reason });
    return true;
  }

  private rejectAllApprovals(reason: string): void {
    for (const [id, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(id);
      clearTimeout(pending.timer);
      pending.resolve({ approve: false, reason });
    }
  }

  getPendingApprovals(): Array<{ id: string; toolName: string }> {
    return Array.from(this.pendingApprovals.entries()).map(([id, p]) => ({ id, toolName: p.toolName }));
  }

  private pendingRecoveryView(): PendingRecoveryItem[] {
    return this.queueRecovery.map(({ id, kind, text, images, queuedAt }) => ({ id, kind, text, hasImages: Boolean(images?.length), queuedAt }));
  }

  private persistQueue(): void {
    if (!this.sessionFile) return;
    const entries = [...this.queueRecovery, ...this.queueMirror];
    if (entries.length) saveQueue(this.sessionFile, entries); else removeQueue(this.sessionFile);
  }

  private hintQueueImages(kind: QueueKind, images: QueueImage[] | undefined): void {
    this.pendingQueueHints[kind].push(images?.length ? images : []);
  }

  private reconcileQueue(steering?: string[], followUp?: string[]): void {
    const rebuild = (kind: QueueKind, texts: string[] | undefined): QueueEntry[] => {
      if (!texts) return this.queueMirror.filter((entry) => entry.kind === kind);
      const used = new Set<QueueEntry>();
      return texts.map((text) => {
        const match = this.queueMirror.find(
          (entry) => entry.kind === kind && entry.text === text && !used.has(entry),
        );
        if (match) {
          used.add(match);
          return match;
        }
        const entry = createQueueEntry(kind, text, this.pendingQueueHints[kind].shift());
        used.add(entry);
        return entry;
      });
    };
    this.queueMirror = [...rebuild("steer", steering), ...rebuild("followUp", followUp)];
    this.persistQueue();
  }

  private async requeueEntry(entry: QueueEntry): Promise<void> {
    const imageError = validateAgentImages(entry.images);
    if (imageError) throw new Error(imageError);
    this.hintQueueImages(entry.kind, entry.images);
    if (entry.kind === "steer") await this.inner.steer(entry.text, entry.images);
    else await this.inner.followUp(entry.text, entry.images);
  }

  private ensureMirrored(entry: QueueEntry): void {
    const existing = this.queueMirror.find((candidate) => candidate.kind === entry.kind && candidate.text === entry.text);
    if (existing) return;
    this.queueMirror.push({ ...entry });
    this.pendingQueueHints[entry.kind].pop();
  }

  /** pi exposes only clear-all queue APIs. Rebuild both queues in one wrapper
   * command so per-item UI edits preserve ordering and image attachments. */
  private async replaceLiveQueue(steeringEntries: QueueEntry[], followUpEntries: QueueEntry[]) {
    this.inner.clearQueue();
    this.pendingQueueHints = { steer: [], followUp: [] };
    for (const entry of steeringEntries) await this.requeueEntry(entry);
    for (const entry of followUpEntries) await this.requeueEntry(entry);
    // The agent may consume an entry while the live queue is being rebuilt.
    // Reconcile from pi's actual queue instead of restoring the old snapshot.
    const queues = {
      steering: [...this.inner.getSteeringMessages()],
      followUp: [...this.inner.getFollowUpMessages()],
    };
    this.reconcileQueue(queues.steering, queues.followUp);
    return queues;
  }

  private async withQueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queueMutationTail;
    let release!: () => void;
    this.queueMutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async mutateLiveQueue<T>(kind: QueueKind, mutate: (entries: QueueEntry[]) => T) {
    return this.withQueueMutation(async () => {
      const steering = this.queueMirror.filter((entry) => entry.kind === "steer");
      const followUp = this.queueMirror.filter((entry) => entry.kind === "followUp");
      const value = mutate(kind === "steer" ? steering : followUp);
      const queues = await this.replaceLiveQueue(steering, followUp);
      return { value, queues };
    });
  }

  private validateQueueEntries(entries: QueueEntryInput[]): void {
    for (const entry of entries) {
      if ((entry.kind !== "steer" && entry.kind !== "followUp") || typeof entry.text !== "string") continue;
      const imageError = validateAgentImages(entry.images);
      if (imageError) throw new Error(imageError);
    }
  }

  private runAgentContinue(): void {
    if (this.inner.isStreaming || this.inner.isBashRunning || this.promptRunning) return;
    const entries = [...this.queueMirror];
    if (entries.length === 0) return;
    this.queueMirror = [];
    this.persistQueue();
    this.promptRunning = true;
    this.promptPhase = "waiting_model";
    void this.bootstrapQueuedRun(entries);
  }

  private async bootstrapQueuedRun(entries: QueueEntry[]): Promise<void> {
    this.inner.clearQueue();
    this.pendingQueueHints = { steer: [], followUp: [] };
    for (const entry of entries) {
      try {
        await this.inner.prompt(entry.text, entry.images?.length ? { images: entry.images } : undefined);
      } catch (error) {
        this.promptRunning = false;
        this.promptPhase = null;
        this.resetIdleTimer();
        invalidateSessionListCache();
        this.emit({ type: "prompt_error", errorMessage: error instanceof Error ? error.message : String(error) });
        this.emit({ type: "prompt_done" });
        return;
      }
    }
    this.promptRunning = false;
    this.promptPhase = null;
    this.resetIdleTimer();
    this.emit({ type: "prompt_done" });
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in pi-web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  /** 等待扩展绑定的最大时长：某些扩展的 session_start 处理可能很慢
   *  （网络/LLM 调用），超时后放行而不是让 prompt 永久挂起。 */
  private static readonly EXTENSION_BIND_TIMEOUT_MS = 15_000;

  private async waitForExtensionsBound(): Promise<void> {
    const promise = this.extensionBindingPromise;
    if (promise) {
      try {
        const timeout = new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Extension binding timed out; continuing without waiting")),
            AgentSessionWrapper.EXTENSION_BIND_TIMEOUT_MS,
          );
          promise.finally(() => clearTimeout(timer));
        });
        await Promise.race([promise, timeout]);
      } catch {
        // 绑定失败/超时（如 MCP server 未启动或未连接）不阻塞发送：放行让消息照常发出。
        // 若这里 throw，`await Promise.race` 会在 promise 已 reject 时立即抛错，
        // 导致 send() 失败且此后每次发送都失败——违背「绑定失败放行」的设计意图。
      }
    }
    if (this.extensionBindingError) {
      // 绑定失败不阻塞发送：记录但放行，避免一次扩展错误让整个会话无法发消息
      console.warn("[pi-web] extension binding failed, continuing:", this.extensionBindingError);
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) {
      // Isolate listeners from each other: a throwing listener (e.g. an SSE
      // route writing to a closed controller) must not starve the remaining
      // listeners of this event — nor propagate back into the SDK dispatch
      // path, where it can skip message persistence for the same event.
      try {
        l(event);
      } catch (error) {
        console.error(
          `[pi-web] session ${this.sessionId} event listener threw:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error("[pi-web] failed to shut down idle session:", error instanceof Error ? error.message : error);
      });
    }, 30 * 60 * 1000);
  }

  /** Any activity (send, new listener) cancels a pending idle disposal. */
  private touch(): void {
    this.lastActivityAt = Date.now();
    this.cancelPendingDispose();
  }

  /** True while at least one event listener is attached (SSE / task engine). */
  hasSubscribers(): boolean {
    return this.subscriberCount > 0;
  }

  get activityTimestamp(): number {
    return this.lastActivityAt;
  }

  private cancelPendingDispose(): void {
    if (this.disposeGraceTimer) {
      clearTimeout(this.disposeGraceTimer);
      this.disposeGraceTimer = null;
    }
  }

  /** After the last listener detaches: if the session is idle and unwatched,
   *  shut it down after a short grace so a reconnect cancels the disposal. */
  private scheduleDisposeIfIdle(): void {
    this.cancelPendingDispose();
    if (this.subscriberCount > 0 || this.isRunning() || !this._alive) return;
    this.disposeGraceTimer = setTimeout(() => {
      this.disposeGraceTimer = null;
      if (this.subscriberCount > 0 || this.isRunning() || !this._alive) return;
      void this.shutdown().catch((error) => {
        console.error("[pi-web] failed to shut down unwatched session:", error instanceof Error ? error.message : error);
      });
    }, DISPOSE_GRACE_MS);
  }

  /** Ensure the session file exists on disk even before the first assistant
   *  message. The SDK delays its first flush until an assistant message
   *  exists, which means a freshly created session is invisible to
   *  SessionManager.listAll() (and therefore to /api/sessions and the
   *  sidebar) for the whole first turn. Writing the header + current entries
   *  immediately makes the session appear in the sidebar as soon as it is
   *  created; subsequent entries append normally (flushed=true).
   *
   *  Idempotent: if the file already exists (opened session, or this method
   *  was already called) it is left untouched. Safe for bash-only sessions
   *  too (no assistant message ever arrives there). */
  persistSessionFileIfMissing(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    try {
      writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      // The SDK's own first flush can create the file between our existsSync
      // check and this write — keep its version instead of failing the whole
      // session start on a harmless race.
      if ((error as NodeJS.ErrnoException).code === "EEXIST" || existsSync(sessionFile)) {
        (manager as unknown as { flushed: boolean }).flushed = true;
        cacheSessionPath(this.inner.sessionId, sessionFile);
        return;
      }
      throw error;
    }

    // Mark this SDK manager as flushed after writing its own entries so the
    // first user/assistant message appends instead of trying to create the
    // file again with "wx".
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    this.subscriberCount += 1;
    // A new watcher cancels any pending idle disposal (e.g. an SSE reconnect
    // inside the grace window after a tab reload).
    this.cancelPendingDispose();
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
      if (this.subscriberCount > 0) this.subscriberCount -= 1;
      this.scheduleDisposeIfIdle();
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    // The POST route's isAlive() check is not atomic with this call — fork
    // and idle-dispose can destroy the wrapper in between. Fail loudly
    // instead of issuing commands against a disposed AgentSession.
    if (!this._alive) throw new Error("Session is shutting down");
    this.touch();
    this.resetIdleTimer();
    const type = command.type as string;
    if (type === "prompt" || type === "steer" || type === "follow_up" || type === "requeue_at") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "prompt": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot send a prompt while a shell command is running");
        }
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        if (streamingBehavior && this.inner.isStreaming) {
          this.hintQueueImages(streamingBehavior === "followUp" ? "followUp" : "steer", promptImages);
        }
        this.promptRunning = true;
        this.promptPhase = String(command.message ?? "").trimStart().startsWith("/") ? "running_command" : "waiting_model";
        notifyRunningChange();
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          this.promptPhase = null;
          this.resetIdleTimer();
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        }).catch((error) => {
          this.promptRunning = false;
          this.promptPhase = null;
          this.resetIdleTimer();
          invalidateSessionListCache();
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          phase: this.runtimeSnapshot().phase,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          pendingRecovery: this.pendingRecoveryView(),
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
          goalState: this.goalEngine.getState(),
        };
      }

      case "goal_start": {
        const goalText = String(command.goalText ?? "").trim();
        if (!goalText) throw new Error("goal_start requires a non-empty goalText");
        const rawBudget = command.tokenBudget;
        const tokenBudget = typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0
          ? Math.floor(rawBudget)
          : null;
        const state = this.handleGoalStartCommand(goalText, tokenBudget);
        // Kick the loop immediately if the agent is idle (fresh goal).
        this.scheduleGoalKick();
        return { goalState: state };
      }

      case "goal_pause": {
        // Drop any in-flight continuation so the paused goal does not consume
        // an already-queued follow_up.
        try {
          this.inner.clearQueue();
          this.queueMirror = [];
          this.persistQueue();
        } catch {
          // Best-effort queue clear.
        }
        return { goalState: this.goalEngine.pause() };
      }

      case "goal_resume": {
        const state = this.goalEngine.resume();
        if (state.status === "running") {
          this.goalEngine.armContinuation();
          this.scheduleGoalKick();
        }
        return { goalState: state };
      }

      case "goal_stop": {
        try {
          this.inner.clearQueue();
          this.queueMirror = [];
          this.persistQueue();
        } catch {
          // Best-effort queue clear.
        }
        return { goalState: this.handleGoalStopCommand() };
      }

      case "goal_edit": {
        const goalText = String(command.goalText ?? "").trim();
        if (!goalText) throw new Error("goal_edit requires a non-empty goalText");
        const state = this.goalEngine.edit(goalText);
        if (state.status === "running") {
          this.scheduleGoalKick();
        }
        return { goalState: state };
      }

      case "get_goal_state": {
        return { goalState: this.goalEngine.getState() };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          // 会话 wrapper 存活期间 models.json 可能已更新（新增供应商/模型、改 apiKey）：
          // modelRuntime 是创建时的快照，先重读一次配置再查，仍找不到才报错。
          // 这修复“设置里新加的供应商/模型在旧对话中报 Model not found”的问题。
          try {
            await this.inner.modelRuntime.refresh({ allowNetwork: false });
            model = this.inner.modelRuntime.getModel(provider, modelId);
          } catch {
            model = undefined;
          }
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        await this.shutdown();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          return await this.inner.compact(command.customInstructions as string | undefined);
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight. Run under
        // the queue mutation lock so concurrent tabs cannot interleave clears
        // with reorders/recovery writes and drop entries from the mirror.
        return this.withQueueMutation(async () => {
          this.queueMirror = [];
          this.pendingQueueHints = { steer: [], followUp: [] };
          this.persistQueue();
          return this.inner.clearQueue();
        });
      }

      case "move_queue": {
        const kind = command.kind as QueueKind | undefined;
        const fromIndex = Number(command.fromIndex);
        const toIndex = Number(command.toIndex);
        if ((kind !== "steer" && kind !== "followUp") || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
          throw new Error("move_queue requires a queue kind and integer indexes");
        }
        const { queues } = await this.mutateLiveQueue(kind, (entries) => {
          if (fromIndex < 0 || fromIndex >= entries.length || toIndex < 0 || toIndex >= entries.length) {
            throw new Error("move_queue index out of range");
          }
          const [entry] = entries.splice(fromIndex, 1);
          entries.splice(toIndex, 0, entry);
        });
        return queues;
      }

      case "recall_queue_item": {
        const kind = command.kind as QueueKind | undefined;
        const index = Number(command.index);
        if ((kind !== "steer" && kind !== "followUp") || !Number.isInteger(index)) {
          throw new Error("recall_queue_item requires a queue kind and integer index");
        }
        const { value: entry, queues } = await this.mutateLiveQueue(kind, (entries) => {
          if (index < 0 || index >= entries.length) throw new Error("recall_queue_item index out of range");
          const [removed] = entries.splice(index, 1);
          return removed;
        });
        return { entry: { text: entry.text, images: entry.images ?? [] }, ...queues };
      }

      case "requeue_at": {
        const kind = command.kind as QueueKind | undefined;
        const index = Number(command.index);
        const text = command.text as string | undefined;
        if ((kind !== "steer" && kind !== "followUp") || !Number.isInteger(index) || !text?.trim()) {
          throw new Error("requeue_at requires a queue kind, integer index, and text");
        }
        const images = command.images as QueueImage[] | undefined;
        const { queues } = await this.mutateLiveQueue(kind, (entries) => {
          if (index < 0 || index > entries.length) throw new Error("requeue_at index out of range");
          entries.splice(index, 0, createQueueEntry(kind, text, images));
        });
        return queues;
      }

      case "remove_queue_item": {
        const kind = command.kind as QueueKind | undefined;
        const index = Number(command.index);
        if ((kind !== "steer" && kind !== "followUp") || !Number.isInteger(index)) {
          throw new Error("remove_queue_item requires a queue kind and integer index");
        }
        const { queues } = await this.mutateLiveQueue(kind, (entries) => {
          if (index < 0 || index >= entries.length) throw new Error("remove_queue_item index out of range");
          entries.splice(index, 1);
        });
        return queues;
      }

      case "resolve_recovery": {
        return this.withQueueMutation(async () => {
          const keep = new Set((command.keep as string[] | undefined) ?? []);
          const discard = new Set((command.discard as string[] | undefined) ?? []);
          const continueRun = command.continueRun === true;
          let kept = 0;
          for (const entry of this.queueRecovery) {
            if (!keep.has(entry.id)) continue;
            await this.requeueEntry(entry);
            this.ensureMirrored(entry);
            kept += 1;
          }
          this.queueRecovery = this.queueRecovery.filter((entry) => !keep.has(entry.id) && !discard.has(entry.id));
          this.persistQueue();
          if (continueRun && kept > 0) this.runAgentContinue();
          return { remaining: this.pendingRecoveryView(), kept };
        });
      }

      case "export_queue": {
        return {
          live: this.queueMirror.map((entry) => ({ ...entry })),
          recovery: this.queueRecovery.map((entry) => ({ ...entry })),
        };
      }

      case "import_queue": {
        return this.withQueueMutation(async () => {
          const entries = command.entries as QueueEntryInput[] | undefined;
          if (!Array.isArray(entries)) throw new Error("import_queue requires entries[]");
          this.validateQueueEntries(entries);
          let imported = 0;
          for (const entry of entries) {
            if ((entry.kind !== "steer" && entry.kind !== "followUp") || typeof entry.text !== "string") continue;
            const queued = createQueueEntry(entry.kind, entry.text, entry.images);
            await this.requeueEntry(queued);
            this.ensureMirrored(queued);
            imported += 1;
          }
          this.persistQueue();
          return {
            imported,
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          };
        });
      }

      case "stage_recovery": {
        return this.withQueueMutation(async () => {
          const entries = command.entries as QueueEntryInput[] | undefined;
          if (!Array.isArray(entries)) throw new Error("stage_recovery requires entries[]");
          this.validateQueueEntries(entries);
          let staged = 0;
          for (const entry of entries) {
            if ((entry.kind !== "steer" && entry.kind !== "followUp") || typeof entry.text !== "string") continue;
            this.queueRecovery.push(createQueueEntry(entry.kind, entry.text, entry.images));
            staged += 1;
          }
          this.persistQueue();
          return { staged, pendingRecovery: this.pendingRecoveryView() };
        });
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.hintQueueImages("steer", steerImages);
        this.promptPhase = "waiting_model";
        notifyRunningChange();
        try {
          await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        } finally {
          // steer/follow_up must clear the phase like prompt does, or the
          // "waiting for model" spinner lingers after the turn finishes.
          this.promptPhase = null;
          notifyRunningChange();
        }
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.hintQueueImages("followUp", followImages);
        this.promptPhase = "waiting_model";
        notifyRunningChange();
        try {
          await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        } finally {
          this.promptPhase = null;
          notifyRunningChange();
        }
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        this.syncProjectTrust();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "resolve_approval": {
        // Idempotent: a resolve arriving after the request was already
        // resolved (parallel tool batches resolve one-by-one, and the UI may
        // retry) must not throw. Return whether this call actually resolved.
        const resolved = this.resolveApproval(command.id as string, Boolean(command.approve), command.reason as string | undefined);
        return { resolved };
      }

      case "set_approval_mode": {
        const mode = command.mode as "ask" | "auto" | "yolo";
        if (mode !== "ask" && mode !== "auto" && mode !== "yolo") {
          throw new Error(`Invalid approval mode: ${String(mode)}`);
        }
        this.setApprovalMode(mode);
        return null;
      }

      case "set_approval_policy": {
        const input = command.policy as { allow?: string[]; ask?: string[]; deny?: string[] } | undefined;
        this.setApprovalPolicy(policyFromStrings(input));
        return null;
      }

      case "get_approval_state": {
        return {
          mode: this.approvalMode,
          pending: this.getPendingApprovals(),
        };
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "bash": {
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          { excludeFromContext: command.excludeFromContext as boolean | undefined },
        );
        try {
          const result = await execution;
          this.persistSessionFileIfMissing();
          return result;
        } finally {
          this.resetIdleTimer();
          invalidateSessionListCache();
          notifyRunningChange();
        }
      }

      case "abort_bash": {
        this.inner.abortBash();
        notifyRunningChange();
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.cancelPendingDispose();
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
    // Persist the goal sidecar before tearing down.
    if (this.sessionFile && this.goalEngine.hasActiveGoal()) {
      saveGoalState(this.sessionFile, this.goalEngine.getState());
    }
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.rejectAllApprovals("Session closed while approval was pending");
    try {
      this.inner.dispose();
    } finally {
      this.onDestroyCallback?.();
      notifyRunningChange();
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        try {
          await this.waitForExtensionsBound();
        } catch (error) {
          console.error(
            "[pi-web] extension binding failed before session shutdown:",
            error instanceof Error ? error.message : error,
          );
        }
        await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" });
      } finally {
        this.destroy();
      }
    })();
    return this.shutdownPromise;
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : DEFAULT_CUSTOM_UI_COLUMNS;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pi-web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private syncProjectTrust(): void {
    this.inner.settingsManager.setProjectTrusted(getProjectTrustStatus(this.cwd, getAgentDir()).trusted);
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        this.syncProjectTrust();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<RunningListener> | undefined;
  var __piSessionBusListeners: Set<SessionBusListener> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const shutdownAll = () => Promise.allSettled(
      Array.from(globalThis.__piSessions?.values() ?? [], (session) => session.shutdown()),
    );
    // `exit` handlers cannot await promises, so use the synchronous fallback
    // only there. Signal handlers are graceful: wait for extension shutdown
    // and SDK disposal before preserving Node's normal signal exit status.
    process.once("exit", () => globalThis.__piSessions?.forEach((session) => session.destroy()));
    process.once("SIGINT", () => { void shutdownAll().finally(() => process.exit(130)); });
    process.once("SIGTERM", () => { void shutdownAll().finally(() => process.exit(143)); });
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

/** Evict idle AND unwatched wrappers (oldest activity first) when the registry
 *  exceeds MAX_REGISTERED_SESSIONS. Streaming sessions (a listener attached)
 *  and actively-running ones are never evicted. */
function enforceRegistryCap(): void {
  const registry = getRegistry();
  if (registry.size <= MAX_REGISTERED_SESSIONS) return;
  const evictable = Array.from(registry.entries())
    .filter(([, session]) => session.isAlive() && !session.isRunning() && !session.hasSubscribers())
    .sort((a, b) => a[1].activityTimestamp - b[1].activityTimestamp);
  let excess = registry.size - MAX_REGISTERED_SESSIONS;
  for (const [id, session] of evictable) {
    if (excess <= 0) break;
    if (!registry.has(id)) continue;
    console.log(`[pi-web] evicting idle unwatched session ${id} (registry cap ${MAX_REGISTERED_SESSIONS})`);
    void session.shutdown().catch((error) => {
      console.error(`[pi-web] failed to evict session ${id}:`, error instanceof Error ? error.message : error);
    });
    excess -= 1;
  }
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRunningRpcSessionSnapshots(): ReturnType<AgentSessionWrapper["runtimeSnapshot"]>[] {
  const snapshots: ReturnType<AgentSessionWrapper["runtimeSnapshot"]>[] = [];
  for (const [sessionId, session] of getRegistry()) {
    if (!session.isAlive()) continue;
    const snapshot = session.runtimeSnapshot();
    if (snapshot.running) snapshots.push({ ...snapshot, id: snapshot.id || sessionId });
  }
  return snapshots;
}

export function subscribeRunningSessions(listener: RunningListener): () => void {
  globalThis.__piRunningListeners ??= new Set();
  globalThis.__piRunningListeners.add(listener);
  return () => globalThis.__piRunningListeners?.delete(listener);
}

let lastRunningSnapshot = "";

function notifyRunningChange(): void {
  const listeners = globalThis.__piRunningListeners;
  if (!listeners || listeners.size === 0) {
    // A future subscriber receives its own initial snapshot (the SSE route
    // sends one on connect). Reset the dedupe key so the first transition
    // after a reconnect is never swallowed as "unchanged".
    lastRunningSnapshot = "";
    return;
  }
  const snapshots = getRunningRpcSessionSnapshots();
  const serialized = JSON.stringify(snapshots);
  if (serialized === lastRunningSnapshot) return;
  lastRunningSnapshot = serialized;
  for (const listener of listeners) {
    try { listener(snapshots); } catch { /* disconnected SSE clients are ignored */ }
  }
}

export function getRunningRpcSessionIds(): string[] {
  return getRunningRpcSessionSnapshots().map((snapshot) => snapshot.id);
}

// ─── Cross-client session event bus ────────────────────────────────────────

/** Subscribe to session events broadcast across all clients. */
export function subscribeSessionBus(listener: SessionBusListener): () => void {
  globalThis.__piSessionBusListeners ??= new Set();
  globalThis.__piSessionBusListeners.add(listener);
  return () => globalThis.__piSessionBusListeners?.delete(listener);
}

/** Number of live bus subscribers (for tests / diagnostics). */
export function getSessionBusListenersCount(): number {
  return globalThis.__piSessionBusListeners?.size ?? 0;
}

// Per-session message_update coalescing: only the latest accumulated update
// is delivered after the window, so a burst of stream chunks produces one bus
// event instead of O(n) frames (each carrying the whole message so far).
const busCoalesceState = new Map<string, { timer: NodeJS.Timeout; event: SessionBusEvent }>();

function publishSessionBus(event: SessionBusEvent): void {
  const listeners = globalThis.__piSessionBusListeners;
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try { listener(event); } catch { /* a failing listener must not break others */ }
  }
}

/**
 * Deliver an event to the bus. `message_update` events are coalesced per
 * sessionId; every other whitelisted event flushes immediately.
 */
export function broadcastSessionBusEvent(type: string, sessionId: string, payload: unknown): void {
  const listeners = globalThis.__piSessionBusListeners;
  if (!listeners || listeners.size === 0) return;

  if (type !== "message_update") {
    publishSessionBus({ type, sessionId, payload });
    return;
  }

  const key = sessionId;
  const existing = busCoalesceState.get(key);
  const event: SessionBusEvent = { type, sessionId, payload };
  if (existing) {
    clearTimeout(existing.timer);
    existing.event = event;
  } else {
    busCoalesceState.set(key, { event, timer: setTimeout(() => {
      const pending = busCoalesceState.get(key);
      if (pending) {
        busCoalesceState.delete(key);
        publishSessionBus(pending.event);
      }
    }, SESSION_BUS_COALESCE_MS) });
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * The initial model, thinking level, and enabled-model scope are supplied during
 * construction so a prompt cannot observe an intermediate configuration.
 */

/**
 * Wrap an assistant-message event stream to log the web's model call outcome.
 * The stream terminates with `done` (success) or `error` (failure/abort); the
 * agent loop always settles it through `result()`, and iteration may also throw
 * on transport errors. Both paths are covered without touching the payload.
 */
function withModelCallLogging(
  stream: AssistantMessageEventStream,
  meta: { provider: string; modelId: string; sessionId: string },
): AssistantMessageEventStream {
  const startedAt = Date.now();
  const { provider, modelId, sessionId } = meta;

  const log = (final: AssistantMessage) => {
    const elapsedMs = Date.now() - startedAt;
    const failed = final.stopReason === "error" || final.stopReason === "aborted";
    const errorText = final.errorMessage?.trim();
    // Prefer an explicit HTTP status from the error text; fall back to the
    // shared inference (recordErrorLog) for whitelisted codes in the message.
    const statusMatch = errorText?.match(/\bHTTP\s+(\d{3})\b|\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/);
    const statusCode = statusMatch
      ? Number(statusMatch[1] ?? statusMatch[2])
      : undefined;
    recordErrorLog({
      level: failed ? "error" : "info",
      source: "model-call",
      provider,
      model: modelId,
      sessionId,
      ...(statusCode !== undefined ? { statusCode } : {}),
      message: failed
        ? `模型调用失败 ${provider}/${modelId}${errorText ? `：${errorText}` : ""}`
        : `模型调用成功 ${provider}/${modelId}`,
      details: failed ? undefined : `耗时 ${elapsedMs}ms`,
    });
  };

  // The agent loop awaits stream.result() after (or instead of) iterating.
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const final = await originalResult();
    log(final);
    return final;
  };

  // Transport-level throws skip the result() path — log those too.
  const originalIterate = stream[Symbol.asyncIterator].bind(stream);
  stream[Symbol.asyncIterator] = () => {
    const iterator = originalIterate();
    return {
      next: () => iterator.next().catch((error: unknown) => {
        recordErrorLog({
          level: "error",
          source: "model-call",
          provider,
          model: modelId,
          sessionId,
          message: `模型调用传输错误 ${provider}/${modelId}：${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }),
    };
  };

  return stream;
}

// 服务端会话创建硬超时。模型目录网络刷新（ModelRuntime.create 的 create-time
// refresh 与 getAvailable 的 availability refresh）可能联网挂起；该超时通过
// AbortSignal 真正取消底层请求（SDK 支持），避免 /api/agent/new 无限阻塞。
// 略短于客户端 ensureNewSession 的 30s 超时，让客户端优先收到明确的 500 而非自己 abort。
const START_SESSION_TIMEOUT_MS = 25_000;

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { toolNames, initialModel, thinkingLevel } = options;
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive() && !existing.isShuttingDown()) return { session: existing, realSessionId: sessionId };
  if (existing) {
    // A wrapper that is mid-shutdown (idle dispose / fork) must not be
    // reused: SSE subscribers would attach to a session about to be
    // destroyed. Wait it out, then rebuild from the on-disk file. Bounded:
    // a stuck extension shutdown hook must not hang this cold start (and
    // every later one, since this await happens before the start lock).
    const pending = existing.whenShutdown();
    if (pending) {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  let sessionManager: SessionManager;
  if (sessionFile) {
    sessionManager = SessionManager.open(sessionFile, undefined);
  } else {
    if (!cwd) throw new Error("cwd is required for a new session");
    sessionManager = SessionManager.create(cwd, undefined);
  }
  const sessionCwd = sessionManager.getCwd();
  const finishStartingSession = trackStartingSession(sessionCwd);
  const startController = new AbortController();
  const startTimeout = setTimeout(() => startController.abort(), START_SESSION_TIMEOUT_MS);
  const starting = (async () => {
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in pi-web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Creating services imports project extensions for provider discovery, so
    // gate project resources before repository-controlled code can run.
    const trustReloadOptions = projectTrustReloadOptions(sessionCwd, agentDir);
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      modelRuntimeSignal: startController.signal,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });

    // Async shell (long-command tracking): a per-session process manager plus
    // `bash`/`bash_io` tools injected via customTools. `bash` overrides the
    // SDK's built-in synchronous bash; short commands still return directly.
    const { createAsyncBashTools } = await import("./async-bash");
    const asyncBashManager = new AsyncProcessManager();
    const asyncBashTools = createAsyncBashTools(asyncBashManager);

    const scope = await resolveVisibleModels(
      services.modelRuntime,
      services.settingsManager.getEnabledModels(),
      { signal: startController.signal },
    );
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message");
    const initial = hasExistingMessages
      ? { scopedModels: [...scope.scopedModels] }
      : selectInitialModelScope(scope, {
        ...(initialModel ? { requestedModel: initialModel } : {}),
        ...(defaultProvider && defaultModelId
          ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
          : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(initial.model ? { model: initial.model } : {}),
      ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
      ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      customTools: asyncBashTools,
    });
    // Kill any background processes this session spawned when the wrapper dies.
    const cleanupAsyncBash = asyncBashManager.cleanup.bind(asyncBashManager);

    try {

    // Record the web's own model-call traffic for every provider: success as
    // info, failures as error with a status code when inferable. Wrapping the
    // stream function (AgentSession's public factory exposes no per-provider
    // hook, but the Agent stream function is intentionally mutable) keeps the
    // log view focused on web model calls + pi-web runtime logs.
    const agent = (inner as unknown as { agent: { streamFunction: StreamFn } }).agent;
    const baseStream = agent.streamFunction;
    agent.streamFunction = (model, context, options) => {
      const raw = baseStream(model, context, options);
      return raw instanceof Promise
        ? raw.then((stream) => withModelCallLogging(stream, {
          provider: model.provider,
          modelId: model.id,
          sessionId,
        }))
        : withModelCallLogging(raw, {
          provider: model.provider,
          modelId: model.id,
          sessionId,
        });
    };

    const persistedPreferences = await persistExplicitStartupPreferences(
      services.settingsManager,
      {
        ...(initialModel ? { model: initialModel } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      },
      {
        ...(inner.model ? { model: { provider: inner.model.provider, modelId: inner.model.id } } : {}),
        thinkingLevel: inner.agent.state?.thinkingLevel as ThinkingLevel ?? "off",
        supportsThinking: inner.supportsThinking(),
      },
    );
    if (persistedPreferences.modelDefaultChanged) invalidateModelsCache();

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in pi-web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner, sessionCwd);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();
    wrapper.loadQueueRecovery();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    // A brand-new session (no pre-existing file) must be persisted right away:
    // the SDK defers its first flush until an assistant message exists, so
    // without this the sidebar (/api/sessions -> SessionManager.listAll, which
    // scans files on disk) would not show the session until the first response
    // arrives. Persist now so the list refresh triggered by onSessionCreated
    // already finds the file (idempotent for opened sessions).
    wrapper.persistSessionFileIfMissing();

    wrapper.onDestroy(() => {
      cleanupAsyncBash();
      registry.delete(realSessionId);
    });
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });
    enforceRegistryCap();

    return { session: wrapper, realSessionId };
    } catch (error) {
      // The wrapper was never registered, so nothing else will ever dispose
      // it — clean up the half-started session and its bash processes here or
      // they leak for the lifetime of the server process.
      try { inner.dispose(); } catch { /* best effort */ }
      try { cleanupAsyncBash(); } catch { /* best effort */ }
      throw error;
    }
  })().finally(() => {
    clearTimeout(startTimeout);
    locks.delete(sessionId);
    finishStartingSession();
  });

  locks.set(sessionId, starting);
  return starting;
}
