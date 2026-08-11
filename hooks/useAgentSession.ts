"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import type {
  AgentMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
  SubagentStatus,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { cnyCost, matchesDeepSeekCNY } from "@/lib/deepseek-pricing";
import { sendAgentCommand } from "@/lib/agent-client";
import { getToolNamesForPreset, PRESET_PLAN, type ToolEntry } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { PendingRecoveryItem, QueueEntry, QueueEntryInput } from "@/lib/queue-store";
import type { ChatDraftImage } from "@/lib/draft-store";
import { createStreamUpdateScheduler, type StreamUpdateScheduler } from "@/lib/stream-update-scheduler";
import {
  buildModeSystemPrompt,
  defaultModeSettings,
  ECONOMY_TOOL_WHITELIST,
  normalizeCollaborationMode,
  normalizeTokenMode,
  normalizeToolApprovalMode,
  stripModeInstructionBlocks,
  type CollaborationMode,
  type ModeSettings,
  type TokenMode,
  type ToolApprovalMode,
} from "@/lib/modes";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

interface LastAssistantTextResponse {
  text?: string;
}

type AgentStateResponse = {
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  phase?: "waiting_model" | "running_command" | null;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  pendingRecovery?: PendingRecoveryItem[] | null;
};

function phaseFromServerState(state: AgentStateResponse | undefined): AgentPhase {
  if (!state) return null;
  if (state.phase === "running_command" || state.isBashRunning) return { kind: "running_command" };
  if (state.phase === "waiting_model" || state.isStreaming || state.isPromptRunning || state.isCompacting) return { kind: "waiting_model" };
  return null;
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

/** A tool-approval request waiting for the user (from the RPC wrapper). */
export interface ApprovalRequestItem {
  id: string;
  toolName: string;
  args: unknown;
}

export type GoalStatus = "idle" | "running" | "paused" | "blocked" | "complete";

export interface GoalRuntimeState {
  status: GoalStatus;
  goalText: string | null;
  turnsUsed: number;
  turnsLimit: number;
  noProgressTurns: number;
  noProgressLimit: number;
  tokensUsed: number;
  /** Unix-ms timestamp when the goal run started. */
  startedAt?: number;
}

/** Default turn quota for a goal run (mirrors Reasonix budgetClassSimple). */
export const DEFAULT_GOAL_TURNS_LIMIT = 10;
/** Pause after this many consecutive turns with no host-verifiable progress. */
export const DEFAULT_GOAL_NO_PROGRESS_LIMIT = 4;

/** Injected via followUp after every goal turn that is not done/blocked. */
const GOAL_CONTINUE_INSTRUCTION =
  `Continue pursuing the active goal. Do the next useful work, then report your disposition:\n` +
  `- "continue" with the next concrete step;\n` +
  `- "complete" only when fully done and verified;\n` +
  `- "blocked" when only the user can unblock you.`;

/** Assistant message markers that end or pause the goal loop. */
const GOAL_COMPLETE_MARKERS = ["goal complete", "[goal: complete]", "goal is complete"];
const GOAL_BLOCKED_MARKERS = ["goal blocked", "[goal: blocked]", "blocked:"];

function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
export type NoticeType = "info" | "success" | "warning" | "error";

export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
  exiting?: boolean;
};

type NoticeState = {
  visible: NoticeItem[];
  pending: NoticeItem[];
};

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /** Live subagent activity for this session (Agent tool spawns + completions). */
  onSubagentsChange?: (subagents: SubagentStatus[]) => void;
  setToolPreset?: (preset: "none" | "default" | "full" | "plan") => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
// Height of the blank spacer rendered below the last message (see ChatWindow).
// It is ALWAYS rendered — not just while the agent runs — because the keep-out
// scroll target below needs physical room to scroll into: with no trailing
// space, `scrollTo` clamps at the content end and the last message ends up
// pressed against (or covered by) ChatInput. render and backoff MUST agree,
// so both sides consume this single constant.
export const CHAT_BOTTOM_SPACER_PX = 96;
// Distance from the bottom of the scroll container within which live-follow
// scrolling is active. Larger values make follow more lenient; smaller values
// require the user to stay closer to the bottom.
const SCROLL_BOTTOM_THRESHOLD = 150;
// Keep-out gap between the last message and the scroll container's bottom
// edge when auto-scrolling, so the last message is never hidden behind the
// fixed ChatInput bar below the list. 88px ≈ the composer's top row, so the
// last line of live-followed content sits visibly clear of the input box
// instead of hugging (or being covered by) it.
export const BOTTOM_KEEP_OUT_PX = 88;
const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const EVENT_STREAM_IDLE_GRACE_MS = 120_000;
// Cross-client sync: while the direct SSE is open it is the primary channel
// for this session's events; once it closes after the idle grace window the
// global /api/events bus takes over, so OTHER clients' changes still reach an
// idle tab in seconds without a manual refresh.
const AGENT_STATE_RECONCILE_MS = 15_000;
// Opening an inactive session may load its resources and extensions before the
// SSE route can emit `connected`. Five seconds is not enough for a cold
// Turbopack route or a session with several extensions.
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 30_000;

/** Injected ahead of every prompt while plan mode is active. Read-only
 *  analysis contract — the toolset (read/grep/find/ls) enforces it too. */
const PLAN_MODE_INSTRUCTION =
  `You are in PLAN MODE. Work as a read-only planning assistant.\n` +
  `- Analyze, read, search and reason about the codebase; do NOT modify any files.\n` +
  `- Do NOT run shell commands that mutate state, install packages, or start servers.\n` +
  `- When you have enough understanding, produce a concrete, step-by-step implementation plan.\n` +
  `- Structure the plan with clear phases, the files involved, and any risks or open questions.\n` +
  `- Do not write code yet — the plan itself is the deliverable.`;

/** Known mode-instruction block headers (from lib/modes buildModeSystemPrompt
 *  and the legacy plan block). Used to strip the injected prefix from echoed
 *  user messages so the chat bubble shows only what the user typed. */
const MODE_BLOCK_MARKERS = [
  "You are in PLAN MODE.",
  "<economy-profile>",
  "<delivery-profile>",
  "<goal-profile>",
];
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);

type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

type EventStreamConnectionResult = {
  status: EventStreamConnectionStatus;
  source: EventSource;
};

type EventStreamConnectionAttempt = {
  source: EventSource;
  promise: Promise<EventStreamConnectionResult>;
  pending: boolean;
};

class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(status === "timeout"
      ? "Timed out connecting to the agent event stream. Please try again."
      : "Failed to connect to the agent event stream. Please try again.");
    this.name = "EventStreamConnectionError";
  }
}

function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  if (index === -1) return notices;
  return notices.map((notice, i) => (
    i === index ? { ...notice, exiting: true } : notice
  ));
}

function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        return {
          visible: state.visible.some((notice) => notice.exiting)
            ? state.visible
            : markOldestNoticeExiting(state.visible),
          pending: [...state.pending, action.notice],
        };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible) };
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    default:
      return state;
  }
}

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  replaceMessage?: (message: import("@/lib/types").UserMessage) => void;
  addFiles?: (files: File[], dataTransfer?: DataTransfer | null) => void;
  /** Current rendered height of the composer (px) — used for scroll keep-out. */
  measureHeight?: () => number;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  thinkingLevelPins?: Record<string, string>;
  modelScopeWarnings?: string[];
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

/** localStorage key for the last-seen global mode defaults (system settings). */
const GLOBAL_MODES_CACHE_KEY = "pi-web:modes-global-default";

function readCachedGlobalModeSettings(): ModeSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GLOBAL_MODES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rules = parsed.permissionRules as { allow?: unknown; ask?: unknown; deny?: unknown } | undefined;
    return {
      collaborationMode: normalizeCollaborationMode(parsed.collaborationMode),
      tokenMode: normalizeTokenMode(parsed.tokenMode),
      toolApprovalMode: normalizeToolApprovalMode(parsed.toolApprovalMode),
      permissionRules: {
        allow: Array.isArray(rules?.allow) ? (rules.allow as string[]) : [],
        ask: Array.isArray(rules?.ask) ? (rules.ask as string[]) : [],
        deny: Array.isArray(rules?.deny) ? (rules.deny as string[]) : [],
      },
    };
  } catch {
    return null;
  }
}

function cacheGlobalModeSettings(settings: ModeSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GLOBAL_MODES_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort cache; privacy mode and quota must not break chat startup.
  }
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen, onSubagentsChange,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;
  const modelContextKey = `${session?.id ?? "new"}\0${newSessionCwd ?? session?.cwd ?? ""}`;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });

  // ── Live token rate (tokens/sec) during streaming ────────────────────────
  // Approximated from streamed text length: every message_update event carries
  // the full accumulated assistant content, so we count characters added since
  // the last event and slide a 1s window to derive a rate (≈4 chars/token).
  const [tokenRate, setTokenRate] = useState<number | null>(null);
  const tokenRateRef = useRef({
    lastChars: 0,
    window: [] as Array<{ at: number; chars: number }>,
    charsPerToken: 4,
  });
  const resetTokenRate = useCallback(() => {
    tokenRateRef.current = { lastChars: 0, window: [], charsPerToken: 4 };
    setTokenRate(null);
  }, []);

  /** Count printable characters in an assistant content block list. */
  const countAssistantChars = useCallback((msg: Partial<AgentMessage> | undefined): number => {
    if (!msg || msg.role !== "assistant") return 0;
    const content = msg.content as unknown;
    if (!Array.isArray(content)) return 0;
    let total = 0;
    for (const block of content as unknown[]) {
      if (typeof block === "string") {
        total += block.length;
      } else if (block && typeof block === "object") {
        const b = block as { type?: string; text?: string; thinking?: string };
        if (typeof b.text === "string") total += b.text.length;
        else if (typeof b.thinking === "string") total += b.thinking.length;
      }
    }
    return total;
  }, []);

  /** Feed streamed content and update the 1s token-rate estimate. */
  const trackTokenRate = useCallback((msg: Partial<AgentMessage> | undefined) => {
    const chars = countAssistantChars(msg);
    const ref = tokenRateRef.current;
    if (chars === ref.lastChars) return;
    const now = Date.now();
    const delta = Math.max(0, chars - ref.lastChars);
    ref.lastChars = chars;
    ref.window.push({ at: now, chars: delta });
    // Drop samples older than 1s.
    const cutoff = now - 1000;
    while (ref.window.length > 0 && ref.window[0].at < cutoff) ref.window.shift();
    const sum = ref.window.reduce((acc, s) => acc + s.chars, 0);
    const windowMs = ref.window.length > 0 ? now - ref.window[0].at : 0;
    if (windowMs < 200) return; // too early for a stable rate
    const perSec = (sum / Math.max(1, windowMs)) * 1000 / ref.charsPerToken;
    setTokenRate(Math.max(0, Math.round(perSec * 10) / 10));
  }, [countAssistantChars]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<{ command: string; excludeFromContext: boolean } | null>(null);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full" | "plan">("full");
  // Plan mode pins the session to a read-only toolset and injects a plan-only
  // instruction into every prompt. Persists until explicitly exited.
  const [planMode, setPlanMode] = useState(false);
  const prePlanPresetRef = useRef<"none" | "default" | "full">("default");
  // Ref mirror so handleSend can read plan mode without re-binding (keeps the
  // React Compiler's memoization stable across the large hook body).
  const planModeRef = useRef(false);
  useEffect(() => {
    planModeRef.current = planMode;
  }, [planMode]);
  // ── Chat modes (Reasonix port) ───────────────────────────────────────────
  // Loaded from /api/modes (~/.pi/agent/settings.json `modes`) so the
  // selection survives page reloads and new sessions inherit the same defaults.
  // Re-loads when the settings "Features" tab broadcasts MODES_CHANGED_EVENT so
  // default changes take effect in real time on already-open chats.
  // Per-session overrides (modesPerSession) are loaded per session id so each
  // existing conversation remembers its own mode/policy choices; the global
  // default remains the fallback for new sessions.
  const [modeSettings, setModeSettings] = useState<ModeSettings>(() => readCachedGlobalModeSettings() ?? defaultModeSettings());
  /**
   * 新对话（session 未创建）里做出的模式选择先暂存于此：session 创建后写入
   * modesPerSession[新id]，绝不写入全局 modes（全局默认只能由设置页修改，
   * 避免“新对话继承上一个对话的计划模式”）。
   */
  const pendingModeOverrideRef = useRef<ModeSettings | null>(null);
  /**
   * 每次挂载的首次模式加载=“进入对话”，仅此时做计划模式重置；
   * MODES_CHANGED 触发的重载保持会话内选择不变。
   */
  const modesEntryHydratedRef = useRef(false);
  const modeSessionIdRef = useRef<string | null>(session?.id ?? null);
  modeSessionIdRef.current = session?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const sessionId = modeSessionIdRef.current;
      const qs = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
      try {
        const response = await fetch(`/api/modes${qs}`);
        if (!response.ok || cancelled) return;
        const loaded = await response.json() as ModeSettings;
        if (cancelled) return;
        let next = {
          collaborationMode: normalizeCollaborationMode(loaded.collaborationMode),
          tokenMode: normalizeTokenMode(loaded.tokenMode),
          toolApprovalMode: normalizeToolApprovalMode(loaded.toolApprovalMode),
          permissionRules: {
            allow: Array.isArray(loaded.permissionRules?.allow) ? loaded.permissionRules.allow : [],
            ask: Array.isArray(loaded.permissionRules?.ask) ? loaded.permissionRules.ask : [],
            deny: Array.isArray(loaded.permissionRules?.deny) ? loaded.permissionRules.deny : [],
          },
        };
        // 进入对话时，上次遗留的计划模式重置为设置里的全局默认——计划是临场
        // 模式，不能从“上次离开时”继承（仅入口生效，会话内 MODES_CHANGED
        // 重载不替换）。修正后回写清理该会话的遗留记录。
        if (!modesEntryHydratedRef.current && sessionId && next.collaborationMode === "plan") {
          const globalResponse = await fetch("/api/modes").catch(() => null);
          if (!cancelled && globalResponse?.ok) {
            const globalData = await globalResponse.json().catch(() => null) as ModeSettings | null;
            if (!cancelled && globalData) {
              const entryCollaborationMode = next.collaborationMode;
              next = { ...next, collaborationMode: normalizeCollaborationMode(globalData.collaborationMode) };
              if (next.collaborationMode !== entryCollaborationMode) {
                void fetch(`/api/modes?session=${encodeURIComponent(sessionId)}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(next),
                }).catch(() => { /* cleanup is best-effort */ });
              }
            }
          }
        }
        modesEntryHydratedRef.current = true;
        setModeSettings(next);
        // Cache the global defaults so a brand-new chat shows the system
        // defaults immediately instead of the hard-coded fallback until the
        // first async /api/modes round-trip completes.
        if (!sessionId) cacheGlobalModeSettings(next);
      } catch {
        /* keep defaults on load failure */
      }
    };
    void load();
    const onModesChanged = () => void load();
    window.addEventListener("pi:modes-changed", onModesChanged);
    return () => {
      cancelled = true;
      // StrictMode dev 双挂载时，第一次（被丢弃的）运行的入口标记必须复位，
      // 否则真实挂载会跳过入口重置。
      modesEntryHydratedRef.current = false;
      window.removeEventListener("pi:modes-changed", onModesChanged);
    };
  }, [session?.id]);
  const collaborationMode = modeSettings.collaborationMode;
  const tokenMode = modeSettings.tokenMode;
  const toolApprovalMode = modeSettings.toolApprovalMode;
  const permissionRules = modeSettings.permissionRules;
  const collaborationModeRef = useRef<CollaborationMode>(collaborationMode);
  const tokenModeRef = useRef<TokenMode>(tokenMode);
  const toolApprovalModeRef = useRef<ToolApprovalMode>(toolApprovalMode);
  const permissionRulesRef = useRef(modeSettings.permissionRules);
  const goalTextRef = useRef<string | null>(null);
  /**
   * Signature of the last mode-instruction block injected into a sent message.
   * The mode (plan / goal / token profile) is held by the agent's context once
   * injected; repeating the same block on every message is redundant noise that
   * shows up in transcripts.
   *
   * Scoped per session (sessionKey): switching to another conversation whose
   * agent context never received the block must inject it fresh, even when both
   * sessions share the same mode composition. Reset whenever the mode
   * composition changes.
   */
  const injectedModeSignatureRef = useRef<{ sessionKey: string; signature: string }>({ sessionKey: "", signature: "" });
  const modeSettingsRef = useRef(modeSettings);
  useEffect(() => {
    modeSettingsRef.current = modeSettings;
  }, [modeSettings]);
  useEffect(() => {
    toolApprovalModeRef.current = toolApprovalMode;
  }, [toolApprovalMode]);
  useEffect(() => {
    permissionRulesRef.current = modeSettings.permissionRules;
  }, [modeSettings.permissionRules]);
  useEffect(() => {
    collaborationModeRef.current = collaborationMode;
    // Mode composition changed — allow a fresh mode-block injection.
    injectedModeSignatureRef.current = { sessionKey: "", signature: "" };
  }, [collaborationMode]);
  useEffect(() => {
    tokenModeRef.current = tokenMode;
    injectedModeSignatureRef.current = { sessionKey: "", signature: "" };
  }, [tokenMode]);
  /** Pending tool-approval requests surfaced by the RPC wrapper (SSE). */
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequestItem[]>([]);
  const approvalRequestsRef = useRef<ApprovalRequestItem[]>([]);
  useEffect(() => {
    approvalRequestsRef.current = approvalRequests;
  }, [approvalRequests]);
  // ── Goal mode runtime (Reasonix goal loop) ───────────────────────────────
  const [goalState, setGoalState] = useState<GoalRuntimeState>({
    status: "idle",
    goalText: null,
    turnsUsed: 0,
    turnsLimit: DEFAULT_GOAL_TURNS_LIMIT,
    noProgressTurns: 0,
    noProgressLimit: DEFAULT_GOAL_NO_PROGRESS_LIMIT,
    tokensUsed: 0,
  });
  const goalStateRef = useRef(goalState);
  useEffect(() => {
    goalStateRef.current = goalState;
  }, [goalState]);
  const goalLoopRunningRef = useRef(false);
  const goalLastAssistantTokensRef = useRef(0);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [promptAnchorActive, setPromptAnchorActive] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecoveryItem[]>([]);
  const [recoveryIsImport, setRecoveryIsImport] = useState(false);

  // ── Subagent fleet monitor ────────────────────────────────────────────────
  // Tracks Agent tool spawns (tool_execution_start) and completions
  // (entry_appended → customType "subagents:record") for the current session.
  const [subagents, setSubagents] = useState<SubagentStatus[]>([]);
  const subagentsRef = useRef<SubagentStatus[]>([]);
  const SUBAGENT_TOOL_NAMES = useMemo(() => new Set(["Agent", "Task"]), []);
  const MAX_SUBAGENT_ROWS = 20;

  const applySubagents = useCallback((updater: (prev: SubagentStatus[]) => SubagentStatus[]) => {
    setSubagents((prev) => {
      const next = updater(prev);
      subagentsRef.current = next;
      return next;
    });
  }, []);

  /** Register an Agent tool spawn as a running subagent row. */
  const addRunningSubagent = useCallback((id: string, args: Record<string, unknown>) => {
    applySubagents((prev) => {
      if (prev.some((s) => s.id === id)) return prev;
      const description =
        typeof args.description === "string" && args.description.trim()
          ? args.description.trim()
          : typeof args.prompt === "string"
            ? args.prompt.slice(0, 80)
            : "Agent";
      const agentType = typeof args.subagent_type === "string" && args.subagent_type ? args.subagent_type : "Agent";
      const next = [...prev, {
        id, agentType, description,
        status: "running" as const,
        startedAt: Date.now(),
      }];
      return next.slice(-MAX_SUBAGENT_ROWS);
    });
  }, [applySubagents]);

  /** Upsert a completed subagent from a subagents:record transcript entry. */
  const upsertSubagentRecord = useCallback((record: Record<string, unknown>) => {
    const recordId = typeof record.id === "string" ? record.id : "";
    const type = typeof record.type === "string" ? record.type : "Agent";
    const description = typeof record.description === "string" ? record.description : "";
    const statusRaw = typeof record.status === "string" ? record.status : "";
    const status: SubagentStatus["status"] =
      statusRaw === "error" || statusRaw === "aborted" ? "failed"
        : statusRaw === "stopped" ? "stopped"
          : "completed";
    const startedAt = typeof record.startedAt === "number" ? record.startedAt : Date.now();
    const completedAt = typeof record.completedAt === "number" ? record.completedAt : Date.now();
    const tokens = typeof record.tokens === "object" && record.tokens !== null
      ? { input: (record.tokens as Record<string, unknown>).input as number | undefined,
          output: (record.tokens as Record<string, unknown>).output as number | undefined,
          total: (record.tokens as Record<string, unknown>).total as number | undefined }
      : undefined;
    const toolUses = typeof record.toolUses === "number" ? record.toolUses : undefined;
    const error = typeof record.error === "string" && record.error ? record.error : undefined;

    applySubagents((prev) => {
      // Match by record.id first, else by (type + description) so a completion
      // lands on the running row spawned from the same Agent tool call.
      const idx = prev.findIndex((s) => s.id === recordId || (s.agentType === type && s.description === description));
      const entry: SubagentStatus = {
        id: recordId || prev[idx]?.id || `${type}-${startedAt}`,
        agentType: type,
        description,
        status,
        startedAt,
        completedAt,
        tokens,
        toolUses,
        error,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [...prev, entry].slice(-MAX_SUBAGENT_ROWS);
    });
  }, [applySubagents]);

  /** Mark a running Agent tool call finished when it ends without a record. */
  const finishRunningSubagent = useCallback((id: string) => {
    applySubagents((prev) => prev.map((s) => {
      if (s.id !== id || s.status !== "running") return s;
      return { ...s, status: "completed" as const, completedAt: Date.now() };
    }));
  }, [applySubagents]);


  // Queue reconciliation: the empty queue_update can be lost during an SSE
  // drop/reconnect window (the bus does not replay history), which leaves
  // stale "queued" chips on a device that never saw the drain. After a non-empty
  // queue_update, quietly re-check get_state so a missed drain self-heals.
  const queueReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleQueueReconcile = useCallback(() => {
    if (queueReconcileTimerRef.current) clearTimeout(queueReconcileTimerRef.current);
    queueReconcileTimerRef.current = setTimeout(async () => {
      queueReconcileTimerRef.current = null;
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!response.ok) return;
        const data = await response.json() as { state?: AgentStateResponse };
        if (data.state?.queuedMessages !== undefined) {
          setQueuedMessages(normalizeQueuedMessages(data.state.queuedMessages));
        }
      } catch {
        // Best-effort; the next event or interval reconciles again.
      }
    }, 8000);
  }, []);
  const clearQueueReconcile = useCallback(() => {
    if (queueReconcileTimerRef.current) {
      clearTimeout(queueReconcileTimerRef.current);
      queueReconcileTimerRef.current = null;
    }
  }, []);

  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceSessionIdRef = useRef<string | null>(null);
  const eventConnectionAttemptRef = useRef<EventStreamConnectionAttempt | null>(null);
  const eventStreamGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamGraceGenerationRef = useRef(0);
  const eventStreamGraceActiveRef = useRef(false);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const sdkAgentActiveRef = useRef(false);
  const rpcPromptPendingRef = useRef(false);
  const notifiedPromptRunIdRef = useRef(-1);
  const bashRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const modelSwitchIdRef = useRef(0);
  const modelLoadGenerationRef = useRef(0);
  const modelLoadAbortRef = useRef<AbortController | null>(null);
  const modelContextKeyRef = useRef(modelContextKey);
  modelContextKeyRef.current = modelContextKey;
  const newSessionModelOverrideRef = useRef<SelectedModel | null>(null);
  const thinkingLevelOverrideRef = useRef<ThinkingLevelOption | null>(null);
  const streamUpdateSchedulerRef = useRef<StreamUpdateScheduler<Partial<AgentMessage>> | null>(null);
  if (!streamUpdateSchedulerRef.current) {
    streamUpdateSchedulerRef.current = createStreamUpdateScheduler((message) => {
      dispatch({ type: "update", message });
    });
  }

  const resetStreamUpdates = useCallback(() => {
    streamUpdateSchedulerRef.current?.reset();
  }, []);

  const queueStreamUpdate = useCallback((message: Partial<AgentMessage>) => {
    streamUpdateSchedulerRef.current?.enqueue(message);
  }, []);

  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  // A session whose saved model is invalid (e.g. Reasonix imports whose
  // assistant messages carry no provider/model fields) makes the SDK resolve
  // context.model to an empty object. Treat it as "no current model" so the
  // UI falls back to the default instead of showing a dead selector.
  const contextModel = data?.context.model;
  const effectiveContextModel =
    contextModel && contextModel.provider && contextModel.modelId ? contextModel : null;
  const currentModel = currentModelOverride ?? effectiveContextModel ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    // Split spend by pricing currency: deepseek-v4-flash/pro (any provider)
    // is priced with the DeepSeek official CNY table; every other model keeps
    // the SDK's USD cost. The legacy `cost` field stays the SDK total for
    // backward compatibility.
    let costCNY = 0;
    let costUSD = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const assistant = msg as import("@/lib/types").AssistantMessage;
      const u = assistant.usage;
      toolCalls += assistant.content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      const costTotal = u.cost?.total ?? 0;
      cost += costTotal;
      if (matchesDeepSeekCNY(assistant.model)) {
        costCNY += cnyCost(assistant.model, u);
      } else {
        costUSD += costTotal;
      }
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      costCNY,
      costUSD,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [messages, sessionStatsOverride, contextUsage, data?.filePath, session?.id, session?.name]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    let messagesLoaded = false;
    try {
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
          applySubagents(() => []);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      if (sessionIdRef.current !== sid) return null;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      // A model_change entry can lag the live set_model result during a reload.
      // Keep the optimistic selection until the persisted context agrees with it.
      setCurrentModelOverride((override) => {
        if (!override) return null;
        return d.context.model
          && override.provider === d.context.model.provider
          && override.modelId === d.context.model.modelId
          ? null
          : override;
      });
      setError(null);
      if (d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }

      messagesLoaded = true;
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      try {
        const stateRes = await fetch(`/api/sessions/${encodeURIComponent(sid)}/state`);
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        if (sessionIdRef.current !== sid) return null;

        const liveState = agentState.state;
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
          if (liveState.pendingRecovery !== undefined) setPendingRecovery(liveState.pendingRecovery ?? []);
        } else if (!agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
        }
        return agentState;
      } catch (e) {
        console.error("Failed to load agent state:", e);
        return null;
      }
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
  }, [applySubagents]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      if (leafId) params.set("leafId", leafId);
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools) {
        const { getPresetFromTools } = await import("@/lib/tool-presets");
        const preset = getPresetFromTools(tools);
        if (preset === "plan" && !planModeRef.current) {
          // 进入对话时计划模式的只读工具集不恢复——计划是临场模式，入口
          // 处重置为默认预设，与重置后的协作模式保持一致（会话内正在使用
          // 计划模式时 /reload 等路径由 planModeRef 保护不重置）。
          await sendAgentCommand(sid, { type: "set_tools", toolNames: getToolNamesForPreset("default") }).catch(() => {});
          setToolPresetState("default");
        } else {
          setToolPresetState(preset);
        }
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetState]);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
    });
  }, [isNew, newSessionCwd, onSessionCreated]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      // Defaults are selected by the server from the current scope/settings
      // snapshot. Send only choices the user explicitly made in this composer.
      const selectedModel = newSessionModelOverrideRef.current;
      const selectedThinkingLevel = thinkingLevelOverrideRef.current;
      if (selectedModel) setPendingModel(selectedModel);
      const toolNames = getToolNamesForPreset(toolPreset);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          toolNames,
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(selectedThinkingLevel ? { thinkingLevel: selectedThinkingLevel } : {}),
        }),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as {
        sessionId: string;
        model?: SelectedModel | null;
        thinkingLevel?: ThinkingLevelOption;
      };
      sessionIdRef.current = result.sessionId;
      // 新对话创建后，把创建前暂存的模式选择写入该会话的 per-session override。
      const pendingMode = pendingModeOverrideRef.current;
      if (pendingMode) {
        pendingModeOverrideRef.current = null;
        void fetch(`/api/modes?session=${encodeURIComponent(result.sessionId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingMode),
        }).catch((error) => {
          console.error("Failed to persist pending mode settings:", error);
        });
      }
      if (result.model && newSessionModelOverrideRef.current === selectedModel) {
        setPendingModel(result.model);
        if (!selectedModel) setNewSessionDefaultModel(result.model);
      }
      if (result.thinkingLevel && thinkingLevelOverrideRef.current === selectedThinkingLevel) {
        setThinkingLevel(result.thinkingLevel);
      }
      return result.sessionId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, toolPreset]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const cancelEventStreamGrace = useCallback(() => {
    eventStreamGraceGenerationRef.current += 1;
    eventStreamGraceActiveRef.current = false;
    if (eventStreamGraceTimerRef.current) {
      clearTimeout(eventStreamGraceTimerRef.current);
      eventStreamGraceTimerRef.current = null;
    }
  }, []);

  const closeEvents = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    eventSourceSessionIdRef.current = null;
    eventConnectionAttemptRef.current = null;
  }, []);

  const connectEvents = useCallback((sid: string): Promise<EventStreamConnectionResult> => {
    closeEvents();
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    eventSourceSessionIdRef.current = sid;

    const promise = new Promise<EventStreamConnectionResult>((resolve) => {
      let settled = false;
      const settle = (status: EventStreamConnectionStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (eventConnectionAttemptRef.current?.source === es) {
          eventConnectionAttemptRef.current.pending = false;
        }
        resolve({ status, source: es });
      };
      const timeout = setTimeout(() => settle("timeout"), EVENT_STREAM_CONNECT_TIMEOUT_MS);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as AgentEvent;
          if (event.type === "connected") settle("connected");
          handleAgentEventRef.current?.(event);
        } catch {
          // Ignore malformed events; EventSource itself reconnects after transient errors.
        }
      };
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED) return;
        settle("closed");
        if (eventSourceRef.current !== es || (!agentRunningRef.current && !eventStreamGraceActiveRef.current)) return;

        eventSourceRef.current = null;
        eventSourceSessionIdRef.current = null;
        eventConnectionAttemptRef.current = null;
        const reconnectGeneration = eventStreamGraceGenerationRef.current;
        setTimeout(() => {
          if (
            reconnectGeneration === eventStreamGraceGenerationRef.current
            && !eventSourceRef.current
            && (agentRunningRef.current || eventStreamGraceActiveRef.current)
          ) {
            void connectEvents(sid);
          }
        }, 1000);
      };
    });
    eventConnectionAttemptRef.current = { source: es, promise, pending: true };
    return promise;
  }, [closeEvents]);

  const ensureEventsConnected = useCallback(async (sid: string) => {
    const current = eventSourceRef.current;
    if (current && eventSourceSessionIdRef.current === sid) {
      if (current.readyState === EventSource.OPEN) return;
      const attempt = eventConnectionAttemptRef.current;
      if (attempt?.source === current && attempt.pending) {
        await attempt.promise;
        if (eventSourceRef.current === current && current.readyState === EventSource.OPEN) return;
      }
    }

    const result = await connectEvents(sid);
    if (result.status === "connected" || result.source.readyState === EventSource.OPEN) return;
    if (eventSourceRef.current === result.source) eventSourceRef.current = null;
    if (eventSourceSessionIdRef.current === sid) eventSourceSessionIdRef.current = null;
    if (eventConnectionAttemptRef.current?.source === result.source) eventConnectionAttemptRef.current = null;
    result.source.close();
    throw new EventStreamConnectionError(result.status);
  }, [connectEvents]);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, []);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, []);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    const type = notice.type ?? "info";
    if (type === "error" || type === "warning") {
      void fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: type, source: "agent-notice", sessionId: sessionIdRef.current ?? undefined, message }),
      }).catch(() => {});
    }
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type,
      },
    });
  }, []);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        setExtensionDialog(request);
        break;
      case "notify": {
        addNotice({
          id: request.id,
          message: request.message,
          type: request.notifyType ?? "info",
        });
        break;
      }
      case "setStatus":
        setExtensionStatuses((prev) => {
          const rest = prev.filter((item) => item.key !== request.statusKey);
          return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((prev) => {
          const rest = prev.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines
            ? [...rest, {
                key: request.widgetKey,
                lines: request.widgetLines,
                placement: request.widgetPlacement ?? "aboveEditor",
              }]
            : rest;
        });
        break;
      case "setTitle":
        if (request.title) document.title = request.title;
        break;
      case "set_editor_text":
        opts.chatInputRef?.current?.insertText(request.text);
        break;
      case "custom":
        setExtensionCustomUi((current) => {
          if (request.closed) return current?.id === request.id ? null : current;
          return request;
        });
        break;
    }
  }, [addNotice, opts.chatInputRef]);

  // Streaming live-follow scheduler state. `cancelStreamingScroll` must exist
  // before settleUiStage (which cancels pending follow-up frames on settle).
  const streamingScrollRafRef = useRef<number | null>(null);
  const cancelStreamingScroll = useCallback(() => {
    if (streamingScrollRafRef.current !== null) {
      cancelAnimationFrame(streamingScrollRafRef.current);
      streamingScrollRafRef.current = null;
    }
  }, []);

  const settleUiStage = useCallback(() => {
    resetStreamUpdates();
    cancelStreamingScroll();
    const wasRunning = agentRunningRef.current;
    agentRunningRef.current = false;
    setAgentRunning(false);
    setAgentPhase(null);
    setRetryInfo(null);
    dispatch({ type: "end" });
    return wasRunning;
  }, [cancelStreamingScroll, resetStreamUpdates]);

  const notifyPromptStage = useCallback((runId: number) => {
    if (notifiedPromptRunIdRef.current === runId) return false;
    notifiedPromptRunIdRef.current = runId;
    onAgentEnd?.();
    return true;
  }, [onAgentEnd]);

  const scheduleEventStreamClose = useCallback((sid: string) => {
    cancelEventStreamGrace();
    eventStreamGraceActiveRef.current = true;
    const generation = eventStreamGraceGenerationRef.current;

    const checkServerIdle = async () => {
      if (
        generation !== eventStreamGraceGenerationRef.current
        || sessionIdRef.current !== sid
        || !eventStreamGraceActiveRef.current
      ) return;

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;

        const state = data.state;
        const promptActive = Boolean(data.running && state && (state.isStreaming || state.isPromptRunning));
        if (promptActive) {
          eventStreamGraceActiveRef.current = false;
          eventStreamGraceTimerRef.current = null;
          sdkAgentActiveRef.current = Boolean(state?.isStreaming);
          rpcPromptPendingRef.current = Boolean(state?.isPromptRunning);
          agentRunningRef.current = true;
          setAgentRunning(true);
          setAgentPhase(phaseFromServerState(state));
          return;
        }

        if (data.running && state?.isCompacting) {
          setIsCompacting(true);
          eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
          return;
        }

        eventStreamGraceActiveRef.current = false;
        eventStreamGraceTimerRef.current = null;
        closeEvents();
      } catch {
        // Keep the stream open while state cannot be verified.
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;
        eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
      }
    };

    eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), EVENT_STREAM_IDLE_GRACE_MS);
  }, [cancelEventStreamGrace, closeEvents]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId = promptRunIdRef.current) => {
    // A slow reconciliation response from a previous run must never settle the
    // current run or overwrite its messages.
    if (promptRunIdRef.current !== runId) return;
    try {
      if (sid) await loadSession(sid);
    } finally {
      if (promptRunIdRef.current !== runId) return;
      const promptWasPending = rpcPromptPendingRef.current;
      const agentWasActive = sdkAgentActiveRef.current;
      rpcPromptPendingRef.current = false;
      sdkAgentActiveRef.current = false;
      optimisticUserMessageKeyRef.current = null;
      const wasRunning = settleUiStage();
      if (promptWasPending) {
        notifyPromptStage(runId);
      } else if (agentWasActive && wasRunning) {
        onAgentEnd?.();
      }
      if (sid) scheduleEventStreamClose(sid);
    }
  }, [loadSession, notifyPromptStage, onAgentEnd, scheduleEventStreamClose, settleUiStage]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId = promptRunIdRef.current) => {
    await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
    const startedAt = Date.now();

    while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (promptRunIdRef.current !== runId) return;
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (res.ok) {
          const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
          const state = data.state;
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
        }
      } catch {
        // SSE remains the primary completion path.
      }
      await delay(PROMPT_SETTLE_POLL_MS);
    }
  }, [finishPromptWithoutStream]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same path as prompt_done.
  const reconcileAgentState = useCallback(async (sid: string) => {
    if (!agentRunningRef.current) return;
    const runId = promptRunIdRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (promptRunIdRef.current !== runId) return;
      const state = data.state;
      // Mirror the server snapshot before deciding whether to settle. This is
      // the convergence path after a lost SSE terminal event.
      setIsCompacting(state?.isCompacting ?? false);
      setAgentPhase(phaseFromServerState(state));
      setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
      setPendingRecovery(state?.pendingRecovery ?? []);
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isBashRunning || state.isCompacting);
      if (busy || !agentRunningRef.current) return;
      if (state) {
        if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
        if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
      }
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [finishPromptWithoutStream]);

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back.
  useEffect(() => {
    if (!agentRunning) return;
    const reconcile = () => {
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
    if (!agentRunning) setPromptAnchorActive(false);
  }, [agentRunning]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    const container = scrollContainerRef.current;
    const end = messagesEndRef.current;
    if (!container || !end) return;
    // Keep-out gap between the last message and the viewport bottom. The
    // composer below the list can grow taller than the fixed constant
    // (image previews, multi-line input, yolo banner, queued-banner), so
    // measure the live composer and never let the last line hide behind it.
    const composerHeight = opts.chatInputRef?.current?.measureHeight?.() ?? 0;
    const keepOut = Math.max(BOTTOM_KEEP_OUT_PX, composerHeight);
    const doScroll = () => {
      if (!container || !end) return;
      const endInContainer = end.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      const spacerH = CHAT_BOTTOM_SPACER_PX;
      const target = Math.max(0, endInContainer - spacerH - container.clientHeight + keepOut);
      container.scrollTo({ top: target, behavior });
    };
    doScroll();
    // Settle correction: virtual list rows measure asynchronously, growing
    // totalSize and shifting the sentinel. Re-scroll after measurements
    // settle so we always land at the true bottom. "instant" covers initial
    // load; "auto" covers streaming follow. Only re-scroll when the user
    // hasn't scrolled away in the meantime.
    if (behavior === "instant" || behavior === "auto") {
      window.setTimeout(() => {
        if (container && end && isNearBottomRef.current) doScroll();
      }, 200);
    }
  }, []);

  // Streaming live-follow. A single rAF can run before React commits the new
  // streaming DOM (concurrent rendering), measuring the stale layout and
  // leaving the viewport a frame behind the growing thinking/text block. The
  // double rAF runs after commit AND layout; the event merge prevents a burst
  // of message_update events from scheduling redundant frames.
  const scheduleStreamingScroll = useCallback(() => {
    if (streamingScrollRafRef.current !== null) return;
    streamingScrollRafRef.current = requestAnimationFrame(() => {
      streamingScrollRafRef.current = null;
      requestAnimationFrame(() => {
        if (!agentRunningRef.current) return;
        // Never fight an active user scroll gesture.
        if (Date.now() < userScrollIntentUntilRef.current) return;
        // Re-read isNearBottom live: virtual list totalSize can grow between
        // scroll events (rows measure after mount), silently pushing the
        // viewport above the bottom. Without this fresh check the stale
        // isNearBottomRef keeps follow suppressed and the viewport drifts.
        const container = scrollContainerRef.current;
        if (container) {
          const { scrollTop, clientHeight, scrollHeight } = container;
          isNearBottomRef.current = scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD;
        }
        if (!isNearBottomRef.current) return;
        scrollToBottom("auto");
      });
    });
  }, [scrollToBottom]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        resetStreamUpdates();
        resetTokenRate();
        cancelEventStreamGrace();
        sdkAgentActiveRef.current = true;
        agentRunningRef.current = true;
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        // Pin the viewport to the newest content as soon as the run starts so
        // the first returned token is visible without an extra manual scroll.
        scheduleStreamingScroll();
        break;
      case "agent_end": {
        resetStreamUpdates();
        resetTokenRate();
        // Multiple agent_end events may precede retry, compaction, queued
        // extension work, or agent_settled. Keep the SSE stream alive; the
        // grace window owns eventual connection teardown.
        if (!agentRunningRef.current) break;
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        // Preserve the desktop-only terminal provider-error notification while
        // using the upstream settlement lifecycle for all other end events.
        if (event.willRetry !== true) {
          const failedMessages = (event.messages as AgentMessage[] | undefined) ?? [];
          for (let i = failedMessages.length - 1; i >= 0; i--) {
            const message = failedMessages[i];
            if (message?.role !== "assistant") continue;
            if (message.stopReason === "error" && message.errorMessage) {
              addNotice({ type: "error", message: message.errorMessage });
            }
            break;
          }
        }
        const sid = sessionIdRef.current;
        if (sid) {
          void loadSession(sid);
          void fetch(`/api/agent/${encodeURIComponent(sid)}`)
            .then((response) => response.ok ? response.json() as Promise<{ state?: AgentStateResponse }> : undefined)
            .then((data) => {
              const state = data?.state;
              if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
              if (state?.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
              if (state?.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
              if (state?.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
              setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
              setPendingRecovery(state?.pendingRecovery ?? []);
            })
            .catch(() => {});
        }
        break;
      }
      case "agent_settled": {
        const agentWasActive = sdkAgentActiveRef.current;
        sdkAgentActiveRef.current = false;
        if (!agentWasActive || rpcPromptPendingRef.current) break;

        const sid = sessionIdRef.current;
        const wasRunning = settleUiStage();
        setIsCompacting(false);
        if (sid) {
          void loadSession(sid);
          scheduleEventStreamClose(sid);
        }
        if (wasRunning) onAgentEnd?.();
        // Goal auto-continue: when in goal mode, keep driving the loop after
        // the run settles idle (the loop itself decides to stop/pause/continue).
        if (collaborationModeRef.current === "goal" && goalStateRef.current.status === "running") {
          void goalActionsRef.current?.drive();
        }
        break;
      }
      case "prompt_done": {
        const runId = promptRunIdRef.current;
        const promptWasPending = rpcPromptPendingRef.current;
        rpcPromptPendingRef.current = false;
        optimisticUserMessageKeyRef.current = null;
        const firstNotification = notifyPromptStage(runId);
        if (!promptWasPending && !firstNotification) break;

        const sid = sessionIdRef.current;
        if (sid) void loadSession(sid);
        // An extension can start another agent run before this RPC prompt has
        // completed. Let its agent_settled event perform that next transition.
        if (!sdkAgentActiveRef.current) {
          settleUiStage();
          if (sid) scheduleEventStreamClose(sid);
        }
        break;
      }
      case "tool_approval_request": {
        // A tool call is waiting on the user. Surface it for the ApprovalModal.
        const item: ApprovalRequestItem = {
          id: String(event.id ?? ""),
          toolName: String(event.toolName ?? ""),
          args: event.args,
        };
        if (!item.id) break;
        setApprovalRequests((prev) => (prev.some((r) => r.id === item.id) ? prev : [...prev, item]));
        break;
      }
      case "tool_approval_resolved": {
        // Server already settled this request (e.g. timeout auto-deny) — drop
        // it from the UI queue so the modal does not stay stuck on a stale id.
        const id = String(event.id ?? "");
        if (!id) break;
        setApprovalRequests((prev) => prev.filter((r) => r.id !== id));
        break;
      }
      case "opencode_zen_switch":
        if (!event.sessionId || event.sessionId === sessionIdRef.current) {
          addNotice({ type: "success", message: `OpenCode Zen 已切换账号和代理：${String(event.to ?? "unknown")}` });
        }
        break;
      case "prompt_error":
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: (event.error as string | undefined) ?? "Extension command failed",
        });
        break;
      case "message_start":
      case "message_update": {
        // Ignore streaming events arriving after this run already finished
        // (e.g. SSE data buffered while the tab was frozen, flushed after
        // reconcile) — they would resurrect a ghost streaming bubble.
        if (!agentRunningRef.current) break;
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg?.role === "user") {
          break;
        }
        if (msg) {
          trackTokenRate(msg);
          queueStreamUpdate(normalizeToolCalls(msg as AgentMessage));
        }
        // Functional bail-out: only commit a change when the phase differs.
        // Without it, every streaming event schedules a phase update that
        // re-renders the whole chat tree while a long thinking block grows.
        setAgentPhase((prev) => (prev === null ? prev : null));
        // Live-follow the streaming output only when the user is already near
        // the bottom of the message list. If they scrolled up, leave them there.
        // Double-rAF (commit + layout) keeps the viewport pinned to the newest
        // token; the scheduler merges the message_update burst into one frame.
        scheduleStreamingScroll();
        break;
      }
      case "message_end": {
        // Same late-event guard: after reconcile finished this run,
        // loadSession already loaded this message from the session file —
        // appending it again would duplicate it.
        if (!agentRunningRef.current) break;
        const completed = event.message as AgentMessage | undefined;
        if (completed && completed.role === "user") {
          // Delivered steering/follow-up messages surface here as user
          // messages. The run's initial prompt also emits one, but handleSend
          // already appended it optimistically. Consume only the still-adjacent
          // optimistic bubble; later same-text queue deliveries must render.
          let delivered = normalizeToolCalls(completed);
          // The server echoes back the full prompt, which includes the mode
          // instruction block injected by handleSend (plan/goal/economy/…).
          // Strip that prefix so the bubble matches what the user actually
          // typed (and the optimistic copy) instead of showing the raw block.
          if (delivered.role === "user" && "content" in delivered) {
            const content = delivered.content;
            if (typeof content === "string") {
              if (MODE_BLOCK_MARKERS.some((m) => content.startsWith(m))) {
                delivered = { ...delivered, content: stripModeInstructionBlocks(content) };
              }
            } else if (Array.isArray(content)) {
              const textBlocks = content.filter((b) => b.type === "text");
              const firstText = textBlocks[0] as { text?: string } | undefined;
              if (firstText && typeof firstText.text === "string" && MODE_BLOCK_MARKERS.some((block) => firstText.text?.startsWith(block))) {
                delivered = {
                  ...delivered,
                  content: content.map((b, i) => {
                    if (b.type !== "text" || i !== 0) return b;
                    const raw = (b as { text?: string }).text ?? "";
                    const stripped = stripModeInstructionBlocks(raw);
                    return { ...b, text: stripped };
                  }),
                };
              }
            }
          }
          const deliveredKey = userMessageKey(delivered);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
              return optimisticKey === deliveredKey
                ? prev
                : [...prev.slice(0, -1), delivered];
            }
            return [...prev, delivered];
          });
        } else if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        resetStreamUpdates();
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        if (SUBAGENT_TOOL_NAMES.has(name)) {
          const args = (event as { args?: unknown }).args;
          addRunningSubagent(id, typeof args === "object" && args !== null ? args as Record<string, unknown> : {});
        }
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        if (SUBAGENT_TOOL_NAMES.has(event.toolName as string)) {
          finishRunningSubagent(id);
        }
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "entry_appended": {
        const entry = (event as { entry?: { customType?: string; data?: unknown } }).entry;
        if (entry?.customType === "subagents:record" && typeof entry.data === "object" && entry.data !== null) {
          upsertSubagentRecord(entry.data as Record<string, unknown>);
        }
        break;
      }
      case "queue_update":
        setQueuedMessages({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        // A non-empty queue means messages are parked; the drain event may be
        // lost on this device (SSE drop), so schedule a get_state self-heal.
        if (((event.steering as string[] | undefined) ?? []).length > 0
          || ((event.followUp as string[] | undefined) ?? []).length > 0) {
          scheduleQueueReconcile();
        } else {
          clearQueueReconcile();
        }
        break;
      case "state_sync": {
        const state = event.state as AgentStateResponse | undefined;
        if (!state) break;
        setIsCompacting(state.isCompacting ?? false);
        setAgentPhase(phaseFromServerState(state));
        setQueuedMessages(normalizeQueuedMessages(state.queuedMessages));
        setPendingRecovery(state.pendingRecovery ?? []);
        if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
        if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
        const busy = Boolean(state.isStreaming || state.isPromptRunning || state.isBashRunning || state.isCompacting);
        if (busy) {
          agentRunningRef.current = true;
          setAgentRunning(true);
          dispatch({ type: "start" });
        } else if (agentRunningRef.current && !rpcPromptPendingRef.current) {
          const sid = sessionIdRef.current;
          if (sid) void finishPromptWithoutStream(sid, promptRunIdRef.current);
        }
        break;
      }
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      case "extension_ui_request":
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
    }
  }, [
    addNotice,
    cancelEventStreamGrace,
    cancelStreamingScroll,
    finishPromptWithoutStream,
    handleExtensionUiRequest,
    loadSession,
    notifyPromptStage,
    onAgentEnd,
    scheduleEventStreamClose,
    scheduleStreamingScroll,
    settleUiStage,
    queueStreamUpdate,
    resetStreamUpdates,
    scheduleQueueReconcile,
    clearQueueReconcile,
    addRunningSubagent,
    upsertSubagentRecord,
    finishRunningSubagent,
    SUBAGENT_TOOL_NAMES,
    trackTokenRate,
    resetTokenRate,
  ]);
  handleAgentEventRef.current = handleAgentEvent;

  // Cross-client message sync. The global /api/events stream carries session
  // events from OTHER clients (and from this client while its direct SSE is
  // closed). Filter by the current session and skip while the direct SSE is
  // OPEN — it already delivers the same wrapper events, and re-feeding them
  // would double-render. When the direct SSE is closed (idle grace window
  // elapsed), the bus is the only live channel and keeps the view in sync.
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string; sessionId?: string; payload?: unknown } | null;
        if (!data || !data.type || !data.payload) return;
        if (data.sessionId !== sessionIdRef.current) return;
        if (eventSourceRef.current?.readyState === EventSource.OPEN) return;
        handleAgentEventRef.current?.(data.payload as AgentEvent);
      } catch {
        // Ignore malformed frames; EventSource reconnects by itself.
      }
    };
    return () => source.close();
  }, []);

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    if (agentRunningRef.current || bashRunningRef.current) return;
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");
    const promptRunId = promptRunIdRef.current + 1;
    cancelEventStreamGrace();
    resetStreamUpdates();
    rpcPromptPendingRef.current = true;

    // Plan mode prefixes every prompt with a read-only instruction block.
    // The UI textarea keeps showing the user's own words; the injected block
    // only reaches the agent.
    const modeBlock = buildModeSystemPrompt({
      collaborationMode: collaborationModeRef.current,
      tokenMode: tokenModeRef.current,
      goalText: collaborationModeRef.current === "goal" ? (goalTextRef.current ?? undefined) : undefined,
    });
    // Compatibility: the legacy plan toggle (T-009 unifies it into
    // collaborationMode) still injects its read-only block when no mode block
    // is otherwise active.
    const planFallback = !modeBlock && planModeRef.current && !isSlashCommandPrompt
      ? PLAN_MODE_INSTRUCTION
      : "";
    // Inject the mode block only once per mode composition. Once the agent has
    // the plan/goal contract in context, repeating the block on every message
    // is redundant — and the user should not see the same prompt text repeated
    // across turns (or after switching windows and back).
    const combinedBlock = modeBlock || planFallback;
    const modeSignature = [
      collaborationModeRef.current,
      tokenModeRef.current,
      planModeRef.current ? "legacy-plan" : "",
      combinedBlock ? String(combinedBlock.length) : "",
    ].join("|");
    // A new session has no id yet (sessionIdRef fills in after ensureNewSession),
    // so key the injection on the stable session identity from props: existing
    // conversations keep their id, new ones stay "new" until they become real.
    const sessionKey = session?.id ?? "new";
    let effectiveMessage: string;
    if (combinedBlock && (injectedModeSignatureRef.current.sessionKey !== sessionKey || injectedModeSignatureRef.current.signature !== modeSignature)) {
      injectedModeSignatureRef.current = { sessionKey, signature: modeSignature };
      effectiveMessage = `${combinedBlock}\n\n${message}`;
    } else {
      effectiveMessage = message;
    }
    const sentMessage = effectiveMessage;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
    promptRunIdRef.current = promptRunId;
    // Goal mode: the first user message becomes the goal; the loop auto-continues.
    if (collaborationModeRef.current === "goal" && !isSlashCommandPrompt) {
      goalTextRef.current = trimmedMessage;
      setGoalState((prev) => ({
        ...prev,
        status: "running",
        goalText: trimmedMessage,
        turnsUsed: 0,
        noProgressTurns: 0,
        tokensUsed: 0,
      }));
      goalLoopRunningRef.current = true;
    }
    agentRunningRef.current = true;
    setAgentRunning(true);
    setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;
    setPromptAnchorActive(true);
    completionScrollAllowedRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    let sentSessionId: string | null = null;
    let promptRequestStarted = false;
    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (sid) {
          sentSessionId = sid;
          if (selectedModel) {
            setPendingModel(selectedModel);
            if (existingSid) {
              await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
            }
          }
          await ensureEventsConnected(sid);
          promptRequestStarted = true;
          await sendAgentCommand(sid, {
            type: "prompt",
            message: sentMessage,
            ...(piImages?.length ? { images: piImages } : {}),
          });
          promoteNewSession(1, message);
        }
      } else if (session) {
        sentSessionId = session.id;
        await ensureEventsConnected(session.id);
        promptRequestStarted = true;
        await sendAgentCommand(session.id, {
          type: "prompt",
          message: sentMessage,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
      if (isSlashCommandPrompt && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      // A failed POST may still have reached the server. Preserve SSE and let
      // reconciliation settle it rather than hiding a real run.
      if (promptRequestStarted && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
        return;
      }
      rpcPromptPendingRef.current = false;
      closeEvents();
      if (e instanceof EventStreamConnectionError) {
        const optimisticKey = optimisticUserMessageKeyRef.current;
        if (optimisticKey) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === "user" && userMessageKey(last) === optimisticKey
              ? prev.slice(0, -1)
              : prev;
          });
        }
        addNotice({ type: "error", message: e.message });
      }
      optimisticUserMessageKeyRef.current = null;
      agentRunningRef.current = false;
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, session, ensureNewSession, ensureEventsConnected, promoteNewSession, waitForPromptSettlement, addNotice, cancelEventStreamGrace, closeEvents, resetStreamUpdates]);

  const executeBash = useCallback(async (command: string, excludeFromContext: boolean) => {
    if (agentRunningRef.current || bashRunningRef.current) return;
    const inputText = `${excludeFromContext ? "!!" : "!"}${command}`;
    bashRunningRef.current = true;
    setPendingBash({ command, excludeFromContext });
    setBashRunning(true);
    try {
      const sid = sessionIdRef.current ?? session?.id ?? await ensureNewSession();
      if (!sid) throw new Error("Unable to create a session for the shell command");
      await sendAgentCommand(sid, { type: "bash", command, excludeFromContext });
      await loadSession(sid);
      promoteNewSession(1, inputText);
    } catch (e) {
      console.error("Failed to execute shell command:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      opts.chatInputRef?.current?.insertIfEmpty(inputText);
    } finally {
      bashRunningRef.current = false;
      setPendingBash(null);
      setBashRunning(false);
    }
  }, [addNotice, ensureNewSession, loadSession, opts.chatInputRef, promoteNewSession, session]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: bashRunningRef.current ? "abort_bash" : "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      const selectedModel = { provider, modelId };
      newSessionModelOverrideRef.current = selectedModel;
      setNewSessionModel(selectedModel);
      setPendingModel(selectedModel);
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    const switchId = ++modelSwitchIdRef.current;
    const previousModel = currentModelOverride ?? data?.context.model ?? null;
    const selectedModel = { provider, modelId };
    // Update the picker immediately; a slow cold-start or persisted model_change
    // entry must not make a successful click look ignored.
    setCurrentModelOverride(selectedModel);
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
      if (modelSwitchIdRef.current === switchId) {
        setCurrentModelOverride(
          previousModel && (previousModel.provider !== provider || previousModel.modelId !== modelId)
            ? previousModel
            : null,
        );
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [addNotice, currentModelOverride, data?.context.model, isNew, setNewSessionModel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const generation = ++modelLoadGenerationRef.current;
    const requestContextKey = modelContextKey;
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const previousController = modelLoadAbortRef.current;
    previousController?.abort();
    const controller = new AbortController();
    modelLoadAbortRef.current = controller;
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const res = await fetch(modelsUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as ModelsResponse;
      // Fetch cancellation is the fast path; the generation/context guards are
      // still required because an already-resolved response may race a cwd or
      // session change and AbortController cannot undo that callback.
      if (generation !== modelLoadGenerationRef.current || requestContextKey !== modelContextKeyRef.current) return;
      setModelNames(d.models);
      setModelThinkingLevels(d.thinkingLevels ?? {});
      setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
      setModelScopeWarnings(d.modelScopeWarnings ?? []);
      const nextModelList = d.modelList ?? [];
      setModelList(nextModelList);
      if (isNew && !sessionIdRef.current) {
        const match = d.defaultModel
          ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
          : undefined;
        const displayModel = match ?? nextModelList[0];
        setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
        const pinnedThinkingLevel = displayModel
          ? d.thinkingLevelPins?.[`${displayModel.provider}/${displayModel.id}`]
          : undefined;
        if (thinkingLevelOverrideRef.current === null) {
          setThinkingLevel((pinnedThinkingLevel as ThinkingLevelOption | undefined) ?? "auto");
        }
      }
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (modelLoadAbortRef.current === controller) modelLoadAbortRef.current = null;
    }
  }, [isNew, modelContextKey, newSessionCwd, session?.cwd]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    const sid = sessionIdRef.current ?? await ensureNewSession();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.action !== "openSessionStats") {
        addNotice({ type: "success", message: result.message ?? "Command completed" });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: "Compacted context" });
        }

        case "reload": {
          if (!sid) return complete({ handled: true, error: "No active session to reload" });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadTools(sid),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: "Reloaded session resources" });
        }

        case "name": {
          if (!sid) return complete({ handled: true, error: "No active session to name" });
          if (!args) return complete({ handled: true, error: "Usage: /name <name>" });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: `Session renamed to ${args}` });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
          if (stats) {
            setSessionStatsOverride(stats);
          }
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        default:
          return { handled: false };
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [addNotice, ensureNewSession, isCompacting, loadModels, loadSession, loadSlashCommands, loadTools, promoteNewSession, onSessionStatsPanelOpen]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to queue prompt:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "Failed to recall queued messages" });
    }
  }, [opts.chatInputRef, addNotice]);

  useEffect(() => {
    if (pendingRecovery.length === 0) setRecoveryIsImport(false);
  }, [pendingRecovery.length]);

  const resolveRecovery = useCallback(async (
    keep: string[],
    discard: string[],
    continueRun = false,
  ): Promise<PendingRecoveryItem[]> => {
    const sid = sessionIdRef.current;
    if (!sid) return pendingRecovery;
    try {
      const result = await sendAgentCommand<{ remaining?: PendingRecoveryItem[] }>(sid, {
        type: "resolve_recovery",
        keep,
        discard,
        continueRun,
      });
      const remaining = result?.remaining ?? [];
      setPendingRecovery(remaining);
      if (continueRun && keep.length > 0) {
        void (async () => {
          try {
            const stateRes = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
            if (!stateRes.ok) return;
            const agentState = await stateRes.json() as { running?: boolean; state?: AgentStateResponse };
            const state = agentState.state;
            if (!agentState.running || !state || (!state.isStreaming && !state.isPromptRunning)) return;
            sdkAgentActiveRef.current = Boolean(state.isStreaming);
            rpcPromptPendingRef.current = Boolean(state.isPromptRunning);
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(phaseFromServerState(state));
            dispatch({ type: "start" });
            void connectEvents(sid);
            if (!state.isStreaming && state.isPromptRunning) void waitForPromptSettlement(sid);
          } catch {
            // The explicit recovery choice already succeeded; reconnect is best effort.
          }
        })();
      }
      return remaining;
    } catch (error) {
      console.error("Failed to resolve queued message recovery:", error);
      addNotice({ type: "error", message: "Failed to resolve queued message recovery" });
      return pendingRecovery;
    }
  }, [pendingRecovery, addNotice, connectEvents, waitForPromptSettlement]);

  const exportQueueData = useCallback(async (): Promise<{ live: QueueEntry[]; recovery: QueueEntry[] } | null> => {
    const sid = sessionIdRef.current;
    if (!sid) return null;
    try {
      return await sendAgentCommand<{ live: QueueEntry[]; recovery: QueueEntry[] }>(sid, { type: "export_queue" });
    } catch (error) {
      console.error("Failed to export queue:", error);
      addNotice({ type: "error", message: "Failed to export queue" });
      return null;
    }
  }, [addNotice]);

  const importQueueData = useCallback(async (entries: QueueEntryInput[]): Promise<number | null> => {
    const sid = sessionIdRef.current;
    if (!sid) return null;
    try {
      const result = await sendAgentCommand<{ imported?: number; steering?: string[]; followUp?: string[] }>(sid, {
        type: "import_queue",
        entries,
      });
      if (result) setQueuedMessages(normalizeQueuedMessages(result));
      return result?.imported ?? 0;
    } catch (error) {
      console.error("Failed to import queue:", error);
      addNotice({ type: "error", message: "Failed to import queue" });
      return null;
    }
  }, [addNotice]);

  const stageQueueImport = useCallback(async (entries: QueueEntryInput[]): Promise<number | null> => {
    const sid = sessionIdRef.current;
    if (!sid) return null;
    try {
      const result = await sendAgentCommand<{ staged?: number; pendingRecovery?: PendingRecoveryItem[] }>(sid, {
        type: "stage_recovery",
        entries,
      });
      if (result?.pendingRecovery) setPendingRecovery(result.pendingRecovery);
      if ((result?.staged ?? 0) > 0) setRecoveryIsImport(true);
      return result?.staged ?? 0;
    } catch (error) {
      console.error("Failed to stage imported queue:", error);
      addNotice({ type: "error", message: "Failed to stage imported queue" });
      return null;
    }
  }, [addNotice]);

  const moveQueuedMessage = useCallback(async (
    kind: "steer" | "followUp",
    fromIndex: number,
    toIndex: number,
  ): Promise<boolean> => {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "move_queue", kind, fromIndex, toIndex,
      });
      if (result) setQueuedMessages(normalizeQueuedMessages(result));
      return true;
    } catch (error) {
      console.error("Failed to move queued message:", error);
      addNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to move queued message" });
      return false;
    }
  }, [addNotice]);

  const recallQueuedMessage = useCallback(async (
    kind: "steer" | "followUp",
    index: number,
  ): Promise<{ text: string; images?: ChatDraftImage[] } | null> => {
    const sid = sessionIdRef.current;
    if (!sid) return null;
    try {
      const result = await sendAgentCommand<{
        entry?: { text: string; images?: Array<{ type: "image"; data: string; mimeType: string }> };
        steering?: string[];
        followUp?: string[];
      }>(sid, { type: "recall_queue_item", kind, index });
      if (result && (result.steering !== undefined || result.followUp !== undefined)) {
        setQueuedMessages(normalizeQueuedMessages(result));
      }
      return result?.entry
        ? { text: result.entry.text, images: result.entry.images?.map(({ data, mimeType }) => ({ data, mimeType })) }
        : null;
    } catch (error) {
      console.error("Failed to recall queued message:", error);
      addNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to recall queued message" });
      return null;
    }
  }, [addNotice]);

  const requeueAt = useCallback(async (
    kind: "steer" | "followUp",
    index: number,
    text: string,
    images?: ChatDraftImage[],
  ): Promise<boolean> => {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "requeue_at",
        kind,
        index,
        text,
        images: images?.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType })),
      });
      if (result) setQueuedMessages(normalizeQueuedMessages(result));
      return true;
    } catch (error) {
      console.error("Failed to requeue message:", error);
      addNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to requeue message" });
      return false;
    }
  }, [addNotice]);

  const removeQueuedMessage = useCallback(async (
    kind: "steer" | "followUp",
    index: number,
  ): Promise<boolean> => {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "remove_queue_item", kind, index,
      });
      if (result) setQueuedMessages(normalizeQueuedMessages(result));
      return true;
    } catch (error) {
      console.error("Failed to remove queued message:", error);
      addNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to remove queued message" });
      return false;
    }
  }, [addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    thinkingLevelOverrideRef.current = level === "auto" ? null : level;
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full" | "plan") => {
    const toolNames = getToolNamesForPreset(preset);
    setToolPresetState(preset);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [setToolPresetState]);

  // ── Plan mode ────────────────────────────────────────────────────────────
  // Entering/exiting delegates to the @narumitw/pi-plan-mode extension via the
  // /plan slash command (the prompt RPC path executes extension commands). The
  // extension owns the read-only toolset and plan workflow; the frontend keeps
  // its own planMode flag + PlanReviewDialog for the post-plan review shelf.
  // Uses a generation counter so rapid toggles don't race (e.g. exit + re-enter
  // before the exit command completes).
  const planModeGenRef = useRef(0);
  const handlePlanModeChange = useCallback(async (enabled: boolean) => {
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    const gen = ++planModeGenRef.current;
    if (enabled) {
      // Remember the active preset so exiting plan mode can restore it.
      prePlanPresetRef.current = toolPreset === "plan" ? "default" : toolPreset;
      setPlanMode(true);
      if (sid) {
        try {
          // Activate the extension's Plan mode (read-only tools + plan workflow).
          await sendAgentCommand(sid, { type: "prompt", message: "/plan" });
          if (planModeGenRef.current !== gen) return; // superseded by a later call
        } catch (e) {
          if (planModeGenRef.current !== gen) return;
          console.error("Failed to enter plan mode:", e);
        }
      }
    } else {
      setPlanMode(false);
      if (sid) {
        try {
          // Exit the extension's Plan mode; it restores the previous toolset.
          await sendAgentCommand(sid, { type: "prompt", message: "/plan exit" });
          if (planModeGenRef.current !== gen) return; // superseded
        } catch (e) {
          if (planModeGenRef.current !== gen) return;
          console.error("Failed to exit plan mode:", e);
          // Fall back to restoring the preset toolset manually.
          try {
            const restore = prePlanPresetRef.current;
            await sendAgentCommand(sid, { type: "set_tools", toolNames: getToolNamesForPreset(restore) });
          } catch { /* ignore */ }
        }
      }
    }
  }, [toolPreset]);

  // ── Chat modes (Reasonix port) ───────────────────────────────────────────
  // Persist to the current session's per-session override (modesPerSession) so
  // each conversation keeps its own mode; a brand-new chat (no session id yet)
  // holds its choice as a pending override applied once the session exists —
  // it must NEVER overwrite the global defaults (owned by the settings
  // "Features" tab), otherwise every new chat would inherit this one's mode.
  const persistModeSettings = useCallback((next: ModeSettings) => {
    setModeSettings(next);
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      pendingModeOverrideRef.current = next;
      return;
    }
    pendingModeOverrideRef.current = null;
    void fetch(`/api/modes?session=${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch((error) => {
      console.error("Failed to persist mode settings:", error);
    });
  }, []);

  const handleCollaborationModeChange = useCallback((mode: CollaborationMode) => {
    persistModeSettings({ ...modeSettingsRef.current, collaborationMode: normalizeCollaborationMode(mode) });
    if (mode !== "goal") {
      // Leaving goal mode stops the auto-continue loop.
      goalTextRef.current = null;
      goalLoopRunningRef.current = false;
      setGoalState((prev) => (prev.status === "idle" ? prev : { ...prev, status: "idle", goalText: null }));
    }
  }, [persistModeSettings]);

  const handleTokenModeChange = useCallback(async (mode: TokenMode) => {
    persistModeSettings({ ...modeSettingsRef.current, tokenMode: normalizeTokenMode(mode) });
    // Economy narrows the active toolset to the whitelist; leaving economy
    // restores the preset's full toolset.
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      if (mode === "economy" && !planModeRef.current) {
        await sendAgentCommand(sid, { type: "set_tools", toolNames: [...ECONOMY_TOOL_WHITELIST] });
      } else if (mode !== "economy") {
        const restore = planModeRef.current ? PRESET_PLAN : getToolNamesForPreset(toolPreset === "plan" ? "default" : toolPreset);
        await sendAgentCommand(sid, { type: "set_tools", toolNames: restore });
      }
    } catch (error) {
      console.error("Failed to apply token mode tools:", error);
    }
  }, [persistModeSettings, toolPreset]);

  const handleToolApprovalModeChange = useCallback(async (mode: ToolApprovalMode) => {
    persistModeSettings({ ...modeSettingsRef.current, toolApprovalMode: normalizeToolApprovalMode(mode) });
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_approval_mode", mode: normalizeToolApprovalMode(mode) });
    } catch (error) {
      console.error("Failed to apply approval mode:", error);
    }
  }, [persistModeSettings]);

  /** Persist permission rules and push them to the live session. */
  const handlePermissionRulesChange = useCallback(async (rules: { allow: string[]; ask: string[]; deny: string[] }) => {
    persistModeSettings({ ...modeSettingsRef.current, permissionRules: rules });
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_approval_policy", policy: rules });
    } catch (error) {
      console.error("Failed to apply permission rules:", error);
    }
  }, [persistModeSettings]);

  /** Resolve a pending tool-approval request (allow / deny + reason). */
  const resolveApproval = useCallback(async (id: string, approve: boolean, reason?: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "resolve_approval", id, approve, reason });
    } catch (error) {
      console.error("Failed to resolve approval:", error);
    } finally {
      // Always drop from the local queue: the server either resolved it (this
      // call) or already settled it (timeout / earlier resolve) — keeping it
      // would leave the modal stuck on a stale id.
      setApprovalRequests((prev) => prev.filter((r) => r.id !== id));
    }
  }, []);

  /** Set the active goal text (goal collaboration mode). */
  const setActiveGoalText = useCallback((text: string | null) => {
    goalTextRef.current = text;
  }, []);

  // ── Goal loop ────────────────────────────────────────────────────────────
  /** Start a goal run: persists the goal text and arms the auto-continue loop. */
  const handleGoalStart = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    goalTextRef.current = trimmed;
    setGoalState((prev) => ({
      ...prev,
      status: "running",
      goalText: trimmed,
      turnsUsed: 0,
      noProgressTurns: 0,
      startedAt: Date.now(),
    }));
  }, []);

  const handleGoalPause = useCallback(() => {
    if (goalStateRef.current.status !== "running") return;
    setGoalState((prev) => ({ ...prev, status: "paused" }));
  }, []);

  const handleGoalResume = useCallback(() => {
    const state = goalStateRef.current;
    if (state.status !== "paused" && state.status !== "blocked") return;
    setGoalState((prev) => ({ ...prev, status: "running" }));
    // Resume: kick the loop with a continue instruction.
    const sid = sessionIdRef.current;
    if (sid && !agentRunningRef.current) {
      void sendAgentCommand(sid, { type: "follow_up", message: GOAL_CONTINUE_INSTRUCTION }).catch(() => {});
    }
  }, []);

  const handleGoalStop = useCallback(() => {
    goalLoopRunningRef.current = false;
    goalTextRef.current = null;
    setGoalState((prev) => ({ ...prev, status: "idle", goalText: null, turnsUsed: 0, noProgressTurns: 0 }));
  }, []);

  /**
   * Goal auto-continue: called when the agent settles idle. Inspects the last
   * assistant message for complete/blocked markers, enforces the turn budget
   * and no-progress stall detection, then either stops, pauses, or continues.
   */
  const driveGoalLoop = useCallback(async () => {
    const state = goalStateRef.current;
    if (state.status !== "running") return;
    const sid = sessionIdRef.current;
    if (!sid) return;

    // Find the latest assistant text + count host-verifiable progress
    // (tool results) since the goal started.
    let lastText = "";
    let toolCallsSinceStart = 0;
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const text = typeof msg.content === "string"
          ? msg.content
          : (msg.content as Array<{ type?: string; text?: string }> | undefined)?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") ?? "";
        if (text) lastText = text;
        const toolCalls = (msg.content as Array<{ type?: string }> | undefined)?.filter((b) => b.type === "toolCall").length ?? 0;
        toolCallsSinceStart += toolCalls;
      }
    }
    const lower = lastText.toLowerCase();

    // Completion marker → stop the loop.
    if (GOAL_COMPLETE_MARKERS.some((m) => lower.includes(m))) {
      setGoalState((prev) => ({ ...prev, status: "complete", turnsUsed: prev.turnsUsed + 1 }));
      goalTextRef.current = null;
      return;
    }
    // Blocked marker → pause and wait for the user.
    if (GOAL_BLOCKED_MARKERS.some((m) => lower.includes(m))) {
      setGoalState((prev) => ({ ...prev, status: "blocked", turnsUsed: prev.turnsUsed + 1 }));
      return;
    }

    const turnsUsed = state.turnsUsed + 1;
    // No-progress detection: a turn with zero tool calls is treated as stalled.
    const noProgressTurns = toolCallsSinceStart === 0 ? state.noProgressTurns + 1 : 0;
    if (noProgressTurns >= state.noProgressLimit) {
      setGoalState((prev) => ({ ...prev, status: "blocked", turnsUsed, noProgressTurns }));
      return;
    }
    // Turn budget exhausted → pause for the user to extend or stop.
    if (turnsUsed >= state.turnsLimit) {
      setGoalState((prev) => ({ ...prev, status: "paused", turnsUsed, noProgressTurns }));
      return;
    }

    setGoalState((prev) => ({ ...prev, turnsUsed, noProgressTurns }));
    // Continue the goal with the next-turn instruction.
    await sendAgentCommand(sid, { type: "follow_up", message: GOAL_CONTINUE_INSTRUCTION }).catch(() => {});
  }, [messages]);

  const goalActionsRef = useRef<{
    drive: () => Promise<void>;
  } | null>(null);
  useEffect(() => {
    goalActionsRef.current = { drive: driveGoalLoop };
  }, [driveGoalLoop]);

  // ── Subagent fleet monitor: push live status up + reset on session switch ──
  const subagentsKey = subagents.map((s) => `${s.id}:${s.status}:${s.completedAt ?? ""}`).join("|");
  const subagentsRef2 = useRef(subagents);
  subagentsRef2.current = subagents;
  useEffect(() => {
    onSubagentsChange?.(subagentsRef2.current);
  }, [subagentsKey, onSubagentsChange]);
  useEffect(() => () => { onSubagentsChange?.([]); }, [onSubagentsChange]);
  useEffect(() => {
    applySubagents(() => []);
    // Reset whenever the active session (or its cwd) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, newSessionCwd ?? session?.cwd]);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetTop = Math.min(Math.max(0, elAbsTop - 16), maxScrollTop);
    isNearBottomRef.current = targetTop >= maxScrollTop - SCROLL_BOTTOM_THRESHOLD;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: targetTop, behavior: "smooth" });
  }, []);

  const markUserScrollIntent = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key)) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
    }
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollTop, clientHeight, scrollHeight } = container;
      isNearBottomRef.current = scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD;
    }
    // A user-initiated scroll away from the bottom revokes the auto-scroll
    // permission regardless of whether an agent is running. (Previously this
    // returned early while idle, so completionScrollAllowed stayed true and
    // the NEXT incoming message yanked an idle reader back to the bottom —
    // the virtualized-list “scroll up → bounce to bottom” report.)
    //
    // Intent window takes priority over the programmatic-ignore window: a
    // real wheel/touch gesture that lands inside a scrollToBottom 700ms
    // window is still a user gesture and must revoke the auto-scroll. Only
    // scrolls OUTSIDE the intent window are checked against the
    // programmatic marker (those are scrollToBottom's own echo events).
    if (Date.now() < userScrollIntentUntilRef.current) {
      completionScrollAllowedRef.current = false;
      return;
    }
    if (Date.now() < ignoreProgrammaticScrollUntilRef.current) return;
    completionScrollAllowedRef.current = false;
  }, []);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      // Sync the persisted approval mode + policy to the live RPC session so
      // the beforeToolCall hook starts with the user's configured posture.
      const approvalMode = toolApprovalModeRef.current;
      const rules = permissionRulesRef.current;
      if (approvalMode !== "auto" || rules.allow.length || rules.ask.length || rules.deny.length) {
        void sendAgentCommand(session.id, { type: "set_approval_mode", mode: approvalMode }).catch(() => {});
        void sendAgentCommand(session.id, { type: "set_approval_policy", policy: rules }).catch(() => {});
      }
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          if (agentState.state?.isBashRunning) {
            bashRunningRef.current = true;
            setBashRunning(true);
          }
          loadTools(session.id);
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            sdkAgentActiveRef.current = Boolean(agentState.state.isStreaming);
            rpcPromptPendingRef.current = Boolean(agentState.state.isPromptRunning);
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(phaseFromServerState(agentState.state));
            dispatch({ type: "start" });
            void connectEvents(session.id);
            if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
              void waitForPromptSettlement(session.id);
            }
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (agentState.state.extensionStatuses !== undefined) setExtensionStatuses(agentState.state.extensionStatuses ?? []);
          if (agentState.state.extensionWidgets !== undefined) setExtensionWidgets(agentState.state.extensionWidgets ?? []);
          if (agentState.state.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
          if (agentState.state.pendingRecovery !== undefined) setPendingRecovery(agentState.state.pendingRecovery ?? []);
        }
        // 入口对账：包装器存活但空闲时，上次访问遗留的计划模式只读工具集
        // 不得泄漏进本次访问。轻量检查（GET 不创建包装器），不付冷启动代价。
        if (!agentState?.running) {
          fetch(`/api/agent/${encodeURIComponent(session.id)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d && (d as { running?: boolean }).running) loadTools(session.id); })
            .catch(() => { /* best-effort; the first send reconciles tools */ });
        }
      });
    }
    return () => {
      // Do not destroy here: React Strict Mode intentionally runs effect
      // cleanup once during development before mounting the real effect.
      // Resetting still prevents an unmounted session from committing stale UI.
      resetStreamUpdates();
      clearQueueReconcile();
      cancelEventStreamGrace();
      closeEvents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetStreamUpdates]);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messages.length, loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        initialScrollDoneRef.current = true;
        // The virtual list mounts rows asynchronously; if the target user row
        // has not been attached yet, leave the flag set — attachVisibleRef in
        // ChatWindow consumes it on mount and scrolls with a live ref.
        // Scrolling here against a stale ref (the PREVIOUS user row) yanks the
        // viewport up to an old turn (the "jump to top" report).
        if (lastUserMsgRef.current) {
          pendingScrollToUserRef.current = false;
          scrollUserMsgToTop();
        }
      } else if (loading || !initialScrollDoneRef.current) {
        if (!loading) initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current && (completionScrollAllowedRef.current || isNearBottomRef.current)) {
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, loading, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  // Settle correction: virtual-list rows measure asynchronously, so the
  // initial scroll target computed from estimate heights drifts once rows
  // report their real sizes. Instead of a single 400ms re-scroll, poll until
  // the container height stabilizes (measurement settled) — but only while
  // the user is still parked at the bottom and no agent run owns the scroll.
  // This guarantees an opened session lands on the LAST message, not halfway
  // up the list after the rows grow.
  const settleScrollDoneRef = useRef(false);
  useEffect(() => {
    if (loading) {
      settleScrollDoneRef.current = false;
      return;
    }
    if (settleScrollDoneRef.current || messages.length === 0) return;
    settleScrollDoneRef.current = true;
    let cancelled = false;
    let lastHeight = -1;
    let stableRuns = 0;
    let timer: number | undefined;
    const tick = () => {
      if (cancelled || agentRunningRef.current) return; // streaming follow owns the scroll
      if (!(completionScrollAllowedRef.current || isNearBottomRef.current)) return;
      scrollToBottom("instant");
      const container = scrollContainerRef.current;
      if (!container) return;
      if (container.scrollHeight === lastHeight) {
        stableRuns += 1;
        if (stableRuns >= 2) return; // measurements settled
      } else {
        lastHeight = container.scrollHeight;
        stableRuns = 0;
      }
      timer = window.setTimeout(tick, 250);
    };
    timer = window.setTimeout(tick, 250);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loading, messages.length, scrollToBottom]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  const branchTree = data?.tree ?? [];

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, modelScopeWarnings, newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, sessionStats,
    tokenRate,
    planMode,
    subagents,
    // Chat modes (Reasonix port)
    collaborationMode, tokenMode, toolApprovalMode, permissionRules, modeSettings,
    approvalRequests,
    handleCollaborationModeChange, handleTokenModeChange, handleToolApprovalModeChange,
    handlePermissionRulesChange, resolveApproval, setActiveGoalText,
    goalState, handleGoalStart, handleGoalPause, handleGoalResume, handleGoalStop,
    slashCommands, slashCommandsLoading, queuedMessages, pendingRecovery, recoveryIsImport,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    agentPhase,
    isNew,
    promptAnchorActive,
    branchTree,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    scrollUserMsgToTop,
    // Actions
    handleSend, executeBash, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue, resolveRecovery, exportQueueData, importQueueData, stageQueueImport,
    moveQueuedMessage, recallQueuedMessage, requeueAt, removeQueuedMessage,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handlePlanModeChange, loadTools, loadSlashCommands, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId,
    handleLeafChange,
    // Subscriptions
    handleAgentEventRef,
  };
}
