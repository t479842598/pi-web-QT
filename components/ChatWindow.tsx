"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentMessage, AssistantMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, UserMessage } from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { splitFinalAssistantBlocks, extractPlanText } from "@/lib/message-display";
import { buildHistoryPipeline, hasDisplayableProcessMessage, withAssistantBlocks } from "@/lib/chat-history-pipeline";
import { type WrittenFile } from "@/lib/turn-written-files";
import { collectProcessContentBlocks, splitAssistantContentBlocks, splitProcessSegments } from "@/lib/process-content";
import { MessageView } from "./MessageView";
import { MarkdownBody } from "./MarkdownBody";
import { PlanReviewDialog } from "./PlanReviewDialog";
import { GoalBanner } from "./GoalBanner";
import { ApprovalModal } from "./ApprovalModal";
import { requestCreateTaskFromText } from "@/lib/task-compose-events";

/** Fired after parking a task draft — AppShell listens and opens the board. */
export const OPEN_TASKS_VIEW_EVENT = "pi:open-tasks-view";
import { ProcessGroup } from "./ProcessGroup";
import { SubagentRunRow, type SubagentRunTimes } from "./SubagentRunRow";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { QueueRecoveryDialog } from "./QueueRecoveryDialog";
import { SessionInfoBar } from "./SessionInfoBar";
import { VirtualizedMessageList } from "./VirtualizedMessageList";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useAgentSession, CHAT_BOTTOM_SPACER_PX, BOTTOM_KEEP_OUT_PX, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { stripModeInstructionBlocks, type CollaborationMode } from "@/lib/modes";
import { useAudio } from "@/hooks/useAudio";
import { cnyCost, matchesDeepSeekCNY } from "@/lib/deepseek-pricing";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { isSubagentToolDetails } from "@/lib/subagent-tool-details";
import type { ToolResultMessage } from "@/lib/types";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  /** Live subagent activity (Agent tool spawns/completions) forwarded to AppShell. */
  onOpenSession?: (sessionId: string) => void;
  /** Open a subagent run's transcript in the right-hand panel (AppShell). */
  onOpenSubagent?: (sessionId: string, label: string) => void;
  /** Subagent session id → authoritative run record (from the session list). */
  subagentRuns?: ReadonlyMap<string, SubagentRunTimes>;
  /** Live subagent fleet — rendered as inline cards on Agent/Task tool calls. */
  /** Open the fullscreen subagent conversation view (AppShell). */
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  onWorkspaceControlsHostChange?: (node: HTMLDivElement | null) => void;
  onViewFullHistory?: () => void;
  systemPrompt: string | null;
  /** Task board feature flag — forwarded to ChatInput to skip its SSE connection when disabled. */
  tasksBoardEnabled?: boolean;
}

function phaseLabel(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("desktop.runningTool");
    const tools = names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")} (+${names.length - 2})`;
    return t("desktop.runningTools", { tools });
  }
  if (phase?.kind === "waiting_model") return t("desktop.waitingForModel");
  if (phase?.kind === "running_command") return t("desktop.runningCommand");
  return null;
}

const CHAT_MINIMAP_WIDTH = 18;
const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  const text = typeof message.content === "string"
    ? message.content
    : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const trimmed = text.trim();
  return trimmed || null;
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile, onWorkspaceControlsHostChange, onViewFullHistory, systemPrompt, tasksBoardEnabled, onOpenSession, onOpenSubagent, subagentRuns }: Props) {
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();
  const { t } = useI18n();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    // Strip mode-instruction block prefixes so only the user-typed text goes
    // back into the input, even if the optimistic-message dedup missed.
    let cleaned = message;
    if (typeof message.content === "string") {
      const stripped = stripModeInstructionBlocks(message.content);
      if (stripped) cleaned = { ...message, content: stripped };
    }
    chatInputRef?.current?.replaceMessage(cleaned);
  }, [chatInputRef]);

  const handleQuoteReply = useCallback((quote: string) => {
    chatInputRef?.current?.prependText(quote);
  }, [chatInputRef]);

  // "Turn this message into a work task": park the text + the session's cwd
  // in the compose buffer and open the task board pre-filled.
  const handleCreateTask = useCallback((text: string, cwd: string | undefined) => {
    requestCreateTaskFromText({ text, projectRoot: cwd ?? null });
    window.dispatchEvent(new Event(OPEN_TASKS_VIEW_EVENT));
  }, []);

  const {
    loading, error, messages, activeToolResults, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, modelScopeWarnings, modelsError, reloadModels, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, sessionStats, tokenRate,
    slashCommands, slashCommandsLoading, queuedMessages, pendingRecovery, recoveryIsImport,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    agentPhase,
    isNew,
    branchTree, activeLeafId: branchActiveLeafId, handleLeafChange,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef, scrollUserMsgToTop,
    handleSend, executeBash, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue, resolveRecovery, exportQueueData, stageQueueImport,
    moveQueuedMessage, recallQueuedMessage, requeueAt, removeQueuedMessage,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
    planMode,
    collaborationMode, toolApprovalMode,
    handleCollaborationModeChange, handleToolApprovalModeChange,
    approvalRequests, resolveApproval,
    goalState, handleGoalStart, handleGoalPause, handleGoalResume, handleGoalStop, handleGoalEdit,
    historyCursor, hasEarlierMessages, loadContext,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  });

  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  useEffect(() => {
    if (pendingRecovery.length === 0) setRecoveryDismissed(false);
  }, [pendingRecovery.length]);

  // Latest finished turn's token/cost breakdown for the "本次回复" stats block.
  const lastTurnUsage = useMemo(() => {
    const last = messages.findLast(
      (m): m is AssistantMessage => m.role === "assistant" && !!(m as AssistantMessage).usage,
    );
    if (!last?.usage) return null;
    const usage = last.usage;
    return {
      model: last.model ?? "",
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      costCNY: matchesDeepSeekCNY(last.model) ? cnyCost(last.model, usage) : 0,
      costUSD: matchesDeepSeekCNY(last.model) ? 0 : (usage.cost?.total ?? 0),
    };
  }, [messages]);

  // ── Plan review: after a plan-mode run settles, ask what to do next ──────
  const [planReviewOpen, setPlanReviewOpen] = useState(false);
  const [planReviewText, setPlanReviewText] = useState<string | null>(null);
  const wasPlanRunningRef = useRef(false);
  useEffect(() => {
    if (!planMode) {
      wasPlanRunningRef.current = false;
      return;
    }
    if (agentRunning) {
      wasPlanRunningRef.current = true;
      return;
    }
    // Edge: plan mode + just went idle → show the review dialog once.
    if (wasPlanRunningRef.current) {
      wasPlanRunningRef.current = false;
      setPlanReviewText(extractPlanText(messages) ?? null);
      setPlanReviewOpen(true);
    }
  }, [agentRunning, planMode, messages]);

  const handlePlanExecute = useCallback(() => {
    // Exit plan mode, then re-send the last assistant plan text as an
    // execution prompt so the agent implements it with the normal toolset.
    setPlanReviewOpen(false);
    const plan = planReviewTextRef.current;
    if (!plan) return;
    // Wait for the mode switch to finish driving /plan exit before sending, so
    // the execution prompt cannot race the extension command's toolset restore.
    // A failed switch must still run the plan: the user asked to execute it.
    void handleCollaborationModeChange(collaborationMode === "plan" ? "normal" : collaborationMode)
      .catch((error) => { console.error("Failed to leave plan mode before executing:", error); })
      .then(() => {
        void handleSend(t("tasks.planReviewExecutePrompt", { plan }));
      });
  }, [handleCollaborationModeChange, handleSend, t, collaborationMode]);
  const planReviewTextRef = useRef<string | null>(null);
  useEffect(() => {
    planReviewTextRef.current = planReviewText;
  }, [planReviewText]);

  const handlePlanFeedback = useCallback((text: string) => {
    // Stay in plan mode for another pass. This must be a real prompt, not a
    // steer: the review dialog only appears once the run has gone idle, and a
    // steer on an idle session is merely queued — the feedback would silently
    // never run.
    setPlanReviewOpen(false);
    void handleSend(text);
  }, [handleSend]);

  const handlePlanExit = useCallback(() => {
    setPlanReviewOpen(false);
    void handleCollaborationModeChange(collaborationMode === "plan" ? "normal" : collaborationMode);
  }, [handleCollaborationModeChange, collaborationMode]);

  useEffect(() => {
    if (!extensionDialog || soundedExtensionDialogIdRef.current === extensionDialog.id) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    if (soundEnabledRef.current) playDoneSoundRef.current();
  }, [extensionDialog]);

  // Register the abort handler for the global Esc shortcut. The registration
  // is a module-level slot: without cleanup, unmounting (e.g. switching to the
  // Tasks view) would leave Esc wired to a stale ChatWindow's abort handler.
  useEffect(() => {
    registerAbortHandler(agentRunning || bashRunning ? handleAbort : null);
    return () => registerAbortHandler(null);
  }, [agentRunning, bashRunning, handleAbort]);

  // --- Scroll-edge fades ---
  // Display a fade only when more conversation content exists beyond that edge.
  const [showChatTopFade, setShowChatTopFade] = useState(false);
  const [showChatBottomFade, setShowChatBottomFade] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const updateChatFades = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowChatTopFade(container.scrollTop > 1);
    setShowChatBottomFade(remaining > 1);
    // The jump-to-latest button appears only when the user is meaningfully
    // above the newest content (threshold large enough to ignore jitter).
    setShowScrollToBottom(remaining > 240);
  }, [scrollContainerRef]);

  const scrollToBottomAfterProcessExpansion = useCallback(() => {
    window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const end = messagesEndRef.current;
      if (!container || !end) return;
      const composerHeight = chatInputRef?.current?.measureHeight?.() ?? 0;
      const keepOut = Math.max(BOTTOM_KEEP_OUT_PX, composerHeight);
      const doScroll = () => {
        if (!container || !end) return;
        const endInContainer = end.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        const spacerH = CHAT_BOTTOM_SPACER_PX;
        const target = Math.max(0, endInContainer - spacerH - container.clientHeight + keepOut);
        container.scrollTo({ top: target, behavior: "auto" });
      };
      doScroll();
      updateChatFades();
      // Settle correction: virtual list rows measure after mount, growing
      // totalSize and shifting the sentinel. Re-scroll so the button always
      // lands at the true bottom.
      window.setTimeout(doScroll, 200);
    });
  }, [messagesEndRef, scrollContainerRef, updateChatFades, chatInputRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(updateChatFades);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    container.addEventListener("scroll", updateChatFades, { passive: true });
    updateChatFades();

    return () => {
      container.removeEventListener("scroll", updateChatFades);
      observer.disconnect();
    };
  }, [messages.length, scrollContainerRef, updateChatFades]);

  // --- Load-earlier pagination ---
  // The server returns a bounded tail window; scrolling to the very top of the
  // virtualized list fetches and prepends the previous page. Guarded against
  // concurrent fetches and duplicate prepends.
  const loadingOlderRef = useRef(false);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const maybeLoadEarlier = () => {
      if (loadingOlderRef.current) return;
      if (!hasEarlierMessages) return;
      const cursor = historyCursor;
      if (!cursor) return;
      // Near the top (within ~8px of the first row): load the previous page.
      if (container.scrollTop > 8) return;
      const sid = session?.id;
      if (!sid) return;
      loadingOlderRef.current = true;
      // Anchor by distance-from-bottom so the prepended page does not shift the
      // viewport (and so the restored scrollTop lands below the 8px threshold,
      // preventing the scroll event from immediately re-triggering a load).
      const distanceFromBottom = container.scrollHeight - container.scrollTop;
      void loadContext(sid, branchActiveLeafId, cursor).finally(() => {
        loadingOlderRef.current = false;
        // Prepend grew scrollHeight; restore the same distance-from-bottom.
        requestAnimationFrame(() => {
          const target = container.scrollHeight - distanceFromBottom;
          if (Math.abs(container.scrollTop - target) > 1) {
            container.scrollTo({ top: target, behavior: "auto" });
          }
        });
      });
    };

    container.addEventListener("scroll", maybeLoadEarlier, { passive: true });
    return () => container.removeEventListener("scroll", maybeLoadEarlier);
  }, [scrollContainerRef, historyCursor, hasEarlierMessages, loadContext, session?.id, branchActiveLeafId]);

  // Deadlock guard for the scroll-event trigger above: when the tail window
  // collapses into compact ProcessGroups the document can be SHORTER than the
  // viewport. scrollTop is then already 0 and can never change, so no scroll
  // event ever fires and the older pages are unreachable — the viewport shows
  // just the live tail with blank space below ("cannot scroll up to history").
  // Re-check on every message-set change and auto-load pages until real
  // overflow exists (or hasMore runs out); the scroll listener takes over
  // from there.
  const autoFillRef = useRef(false);
  useEffect(() => {
    if (!hasEarlierMessages || !historyCursor) return;
    const container = scrollContainerRef.current;
    const sid = session?.id;
    if (!container || !sid) return;
    if (loadingOlderRef.current || autoFillRef.current) return;
    if (loading) return;
    if (container.scrollTop > 8) return;
    if (container.scrollHeight > container.clientHeight + 50) return;
    autoFillRef.current = true;
    const distanceFromBottom = container.scrollHeight - container.scrollTop;
    void loadContext(sid, branchActiveLeafId, historyCursor).finally(() => {
      autoFillRef.current = false;
      requestAnimationFrame(() => {
        const target = container.scrollHeight - distanceFromBottom;
        if (Math.abs(container.scrollTop - target) > 1) {
          container.scrollTo({ top: target, behavior: "auto" });
        }
      });
    });
  }, [scrollContainerRef, historyCursor, hasEarlierMessages, loadContext, session?.id, branchActiveLeafId, loading, messages.length]);

  // --- Virtualized message list ---
  // T-004 (方案 B): the full rendered array is the data source; the
  // VirtualizedMessageList mounts only the viewport window. The old
  // pagination state (visibleCount / sentinel / scroll restore) is gone —
  // scrolling to the top reaches the oldest message instantly.
  const messageVirtualizerRef = useRef<Virtualizer<HTMLElement, Element> | null>(null);
  // Rendered-item index per visible (user/assistant) message ref index. Built
  // alongside the rendered array in the JSX IIFE below (see refToItemIndexRef).
  const refToItemIndexRef = useRef<Array<number | undefined>>([]);
  // Per-visible-row ref callbacks, keyed by refIndex. Cached so React does not
  // detach/re-attach every row on each streaming render (see attachVisibleRef).
  const visibleRefCallbackCacheRef = useRef(
    new Map<number, { state: { isLastUser: boolean }; callback: (el: HTMLDivElement | null) => void }>(),
  );
  // Height of the extension status/widget block rendered above the virtual list
  // inside the same scroll container. Passed to the virtualizer as scrollMargin
  // so item offsets line up with scrollTop when those rows are present.
  const virtualListHeaderRef = useRef<HTMLDivElement | null>(null);
  const [virtualListHeaderHeight, setVirtualListHeaderHeight] = useState(0);
  useEffect(() => {
    const element = virtualListHeaderRef.current;
    if (!element) {
      setVirtualListHeaderHeight((current) => (current === 0 ? current : 0));
      return;
    }
    const measure = () => {
      const next = element.getBoundingClientRect().height;
      // Round to whole pixels: sub-pixel churn from the observer would push a
      // new scrollMargin (and a virtualizer re-layout) every frame.
      const rounded = Math.round(next);
      setVirtualListHeaderHeight((current) => (current === rounded ? current : rounded));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // NOTE: item keys are passed to VirtualizedMessageList as a plain prop array
  // rendered in the same commit — NOT via a ref read inside getItemKey. A
  // ref-backed callback lets an interrupted/concurrent render publish keys for
  // rows that were never committed; the ResizeObserver then resolves a row's
  // key through the NEW array while measuring the OLD DOM, and the virtualizer
  // stores one row's height under another row's key (overlapping text).
  // Stable adapter object for ChatMinimap (positions from the virtualizer
  // layout instead of DOM, which is virtualized). Object identity is stable
  // so the minimap's ResizeObserver wiring does not re-create on each render.
  const minimapVirtualizerAdapter = useMemo(() => ({
    getOffsetForIndex: (itemIndex: number) => messageVirtualizerRef.current?.getOffsetForIndex(itemIndex)?.[0] ?? 0,
    sizeFor: (itemIndex: number) => {
      const v = messageVirtualizerRef.current;
      if (!v) return 0;
      const cached = v.measurementsCache[itemIndex];
      return cached?.size ?? v.options.estimateSize?.(itemIndex) ?? 0;
    },
    totalHeight: () => messageVirtualizerRef.current?.getTotalSize() ?? 0,
    refToItemIndex: (refIndex: number) => refToItemIndexRef.current[refIndex],
    itemCount: refToItemIndexRef.current.length,
  }), []);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[], dataTransfer: DataTransfer) => {
    // While the agent runs, only image attachments may be added (they queue
    // with the next steer/follow-up). File references / other additions stay
    // blocked because inserting text mid-run would corrupt the live prompt.
    if (agentRunning) {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length) chatInputRef?.current?.addImages(images);
      return;
    }
    chatInputRef?.current?.addFiles(files, dataTransfer);
  }, [agentRunning, chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let index = messages.length - 1; index >= 0 && history.length < 50; index -= 1) {
      const text = getUserInputText(messages[index]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
    }
    return history;
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  // Memoize the per-turn data pipeline (block splits, process-block
  // collection, written-file extraction) so streaming only recomputes the
  // live tail instead of re-transforming every historical turn on each frame.
  const historyPipeline = useMemo(
    () => buildHistoryPipeline(messages, entryIds, messageCwd, activeToolResults),
    [messages, entryIds, messageCwd, activeToolResults],
  );

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // Stable callbacks for ChatInput so `memo(ChatInput)` can skip re-renders
  // during streaming (inline arrows would otherwise create a new identity each
  // frame and defeat the memo).
  const handleRetryModels = useCallback(() => { reloadModels(); }, [reloadModels]);
  // The collaboration mode is the single source of truth: planMode is derived
  // from it inside useAgentSession, and switching the mode drives the
  // @narumitw/pi-plan-mode extension (read-only toolset + plan workflow).
  const handleCollaborationModeSelect = useCallback((mode: CollaborationMode) => {
    void handleCollaborationModeChange(mode);
  }, [handleCollaborationModeChange]);

  // 上游行为：子代理会话只读 —— 不渲染输入框（relation.kind === "subagent"）。
  const isSubagentSession = session?.relation?.kind === "subagent";

  const chatInputElement = isSubagentSession ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 16px", borderTop: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>
      {t("subagent.readOnlyNotice")}
    </div>
  ) : (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onBash={executeBash}
      tasksBoardEnabled={tasksBoardEnabled}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      modelNames={modelNames}
      modelList={modelList}
      modelScopeWarnings={modelScopeWarnings}
      modelsError={modelsError}
      onRetryModels={handleRetryModels}
      onModelChange={handleModelChange}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      collaborationMode={collaborationMode}
      toolApprovalMode={toolApprovalMode}
      onCollaborationModeChange={handleCollaborationModeSelect}
      onToolApprovalModeChange={handleToolApprovalModeChange}
      goalState={goalState}
      onGoalStart={handleGoalStart}
      onGoalPause={handleGoalPause}
      onGoalResume={handleGoalResume}
      onGoalStop={handleGoalStop}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      onMoveQueue={moveQueuedMessage}
      onRecallOne={recallQueuedMessage}
      onRequeueAt={requeueAt}
      onRemoveQueueItem={removeQueuedMessage}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");
  const activePhaseLabel = isCompacting ? t("desktop.compacting") : phaseLabel(agentPhase, t);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        {t("desktop.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {!isNew && pendingRecovery.length > 0 && !recoveryDismissed && (
        <QueueRecoveryDialog
          items={pendingRecovery}
          sessionId={session?.id}
          onResolve={resolveRecovery}
          onExport={exportQueueData}
          onStageImport={stageQueueImport}
          onDismiss={() => setRecoveryDismissed(true)}
          mode={recoveryIsImport ? "import" : "recovery"}
        />
      )}

      {approvalRequests.length > 0 && (
        <ApprovalModal
          request={approvalRequests[0] ?? null}
          queuedCount={Math.max(0, approvalRequests.length - 1)}
          busy={false}
          onResolve={(approve, reason) => {
            const active = approvalRequests[0];
            if (active) void resolveApproval(active.id, approve, reason);
          }}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto">
          <div className="w-full max-w-[820px]">
            {/* Pi Logo */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 28,
              }}
            >
              <svg
                fill="currentColor"
                fillRule="evenodd"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  width: 64,
                  height: 64,
                  color: "var(--accent)",
                  opacity: 0.85,
                }}
                aria-label="Pi"
              >
                <title>Pi</title>
                <path
                  clipRule="evenodd"
                  d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z"
                />
                <path d="M17.5 12H23v11h-5.5V12z" />
              </svg>
            </div>

            {/* 移动端：版本号显示在图标下方（桌面端仍在右上角） */}
            {isMobile && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginBottom: 18, marginTop: -14 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            )}

            {/* Header: workspace picker + version info */}
            <div
              style={{
                padding: "0 34px 6px 7px",
                paddingRight: isMobile ? 16 : 34,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div
                  ref={onWorkspaceControlsHostChange}
                  style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1, minHeight: 48 }}
                />
                <div style={{ display: isMobile ? "none" : "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Notices */}
            <div
              style={{
                padding: "0 16px",
                paddingRight: isMobile ? 16 : 34,
              }}
            >
              <NoticeShelf notices={notices} align="right" />
            </div>

            {collaborationMode === "goal" && (
              <GoalBanner
                goalState={goalState}
                onPause={handleGoalPause}
                onResume={handleGoalResume}
                onStop={handleGoalStop}
                onEdit={handleGoalEdit}
              />
            )}

            {chatInputElement}

            {/* Session Info Bar */}
            <div
              style={{
                padding: "0 16px 6px",
                paddingRight: isMobile ? 16 : 34,
                marginTop: -15,
              }}
            >
              <SessionInfoBar
                onViewFullHistory={onViewFullHistory}
                cwd={messageCwd}
                systemPrompt={systemPrompt}
                sessionStats={sessionStats}
                contextUsage={contextUsage}
                hasSession={!!session}
                showChat={true}
                showSoundLabel
                soundEnabled={soundEnabled}
                onSoundToggle={onSoundToggle}
                onCompact={session ? handleCompact : undefined}
                onAbortCompaction={handleAbortCompaction}
                isCompacting={isCompacting}
                compactError={compactError}
                lastTurnUsage={lastTurnUsage}
                // Branch entry point lives in the bottom SessionInfoBar only;
                // rendering it in both bars would duplicate the button.
              />
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex flex-1 overflow-hidden z-0">
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
            zIndex: 40,
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        <div className="relative flex-1 min-h-0 min-w-0">
          <div ref={scrollContainerRef} className="h-full min-w-0 overflow-x-hidden overflow-y-auto pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div style={{ minWidth: 0, padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ width: "100%", minWidth: 0, maxWidth: 820, margin: "0 auto" }}>
              <div ref={virtualListHeaderRef}>
                <ExtensionStatusBar statuses={extensionStatuses} />
                <ExtensionWidgets widgets={aboveEditorWidgets} />
              </div>

            {(() => {
              const { toolResultsMap, lastUserIdx, visibleRefIndexByMessage, items } = historyPipeline;

              // Ref callbacks are cached per refIndex so their identity survives
              // re-renders. React detaches (calls with null) and re-attaches any
              // row whose callback identity changed, so returning a fresh arrow
              // every render re-attached every visible row on every streaming
              // frame. The cached callback reads only refs plus a per-row mutable
              // flag, so the cache can be keyed by refIndex alone.
              const visibleRefCallbacks = visibleRefCallbackCacheRef.current;
              const attachVisibleRef = (idx: number, refIndex: number) => {
                let entry = visibleRefCallbacks.get(refIndex);
                if (!entry) {
                  const state = { isLastUser: false };
                  entry = {
                    state,
                    callback: (el: HTMLDivElement | null) => {
                      messageRefs.current[refIndex] = el;
                      if (!state.isLastUser) return;
                      (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
                      // Consume the pending scroll-to-user flag exactly when
                      // the target row mounts. The messages.length effect in
                      // useAgentSession defers to this: scrolling there while
                      // the row is not yet attached would read the PREVIOUS
                      // user message's ref and yank the viewport to an old turn.
                      if (el && pendingScrollToUserRef.current) {
                        pendingScrollToUserRef.current = false;
                        initialScrollDoneRef.current = true;
                        scrollUserMsgToTop();
                      }
                    },
                  };
                  visibleRefCallbacks.set(refIndex, entry);
                }
                entry.state.isLastUser = idx === lastUserIdx;
                return entry.callback;
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[] } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                // Defensive: an out-of-range idx (e.g. the orphaned-prefix turn
                // sentinel userIdx=-1) must degrade to a missing row instead of
                // crashing the whole page through the error boundary.
                if (!msg) return null;
                // A standalone toolResult renders NOTHING in MessageView (its
                // content is shown inside a ProcessGroup step). Emitting it as
                // a list item produces a 0-height phantom row that parks at the
                // same offset as its successor — skip it here so every caller
                // (singles, trailing loop, live tail) stays clean.
                if (msg.role === "toolResult") return null;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                const view = (
                  <MessageView
                    key={`${keyPrefix}-view-${idx}`}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    onEditContent={handleEditContent}
                    onQuoteReply={handleQuoteReply}
                    onOpenSession={onOpenSession}
                    onCreateTask={handleCreateTask}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    writtenFiles={options.writtenFiles}
                  />
                );
                if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
                return (
                  <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx, currentRefIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              // Parallel record: the visible (user/assistant) message ref index
              // that each rendered item starts with, for the minimap virtualizer
              // adapter (item boundaries map back to message refs).
              const itemStartRefs: Array<number | undefined> = [];
              // Parallel stable identity per item for the virtualizer's
              // getItemKey: entryId when the item is anchored to one message,
              // otherwise a structural id. Index-positioned keys/measurements
              // go stale on prepend or full tail-window replacement.
              const itemKeys: string[] = [];
              const pushRendered = (node: ReactNode, refIndex: number | undefined, key: string) => {
                // A null node (e.g. a bare toolResult "single" that renders
                // nothing) would become a 0-height virtual row sitting at the
                // same offset as its successor — drop it instead.
                if (node === null) return;
                rendered.push(node);
                itemStartRefs.push(refIndex);
                itemKeys.push(key);
              };
              const messageItemKey = (idx: number, fallbackPrefix: string) => {
                const entryId = entryIds[idx];
                return entryId || `${fallbackPrefix}-${idx}`;
              };
              /**
               * Item keys for a turn's process group and final answer.
               *
               * Two separate schemes, because the two phases have opposite
               * requirements:
               *
               * - LIVE TAIL (streaming): keyed by the turn's user INDEX. This is
               *   the only anchor that exists for the whole run — the assistant
               *   row appears/disappears as tool steps complete and the
               *   persisted entryId does not exist yet (`message_end` is emitted
               *   before the SDK appends the entry). The old keys were not
               *   stable here: the process key embedded `liveProcessIndices[0]`
               *   (changed when the first process block appeared) and the answer
               *   key switched from `live-answer-streaming-*` to an assistant
               *   entryId form on every assistant `message_end` — once per tool
               *   step. Either change remounted ProcessGroup/MessageView and
               *   discarded the user's expanded tool details.
               *
               * - HISTORICAL: keyed by entryId (`messageItemKey`). Indexes shift
               *   when an older page is prepended, so an index key would remount
               *   every group on load-earlier.
               *
               * The one remount when a run ends and the list reloads is expected:
               * a finished run collapses its ProcessGroup anyway.
               */
              const liveProcessItemKey = (userIdx: number) => `live-process-u${userIdx}`;
              const liveAnswerItemKey = (userIdx: number) => `live-answer-u${userIdx}`;
              const processItemKey = (userIdx: number) => `process-${messageItemKey(userIdx, "user")}`;
              const answerItemKey = (userIdx: number) => `answer-${messageItemKey(userIdx, "user")}`;
              // A hoisted subagent row is stable regardless of the turn's
              // position, so both the live tail and the historical list key it
              // by toolCallId (the only anchor that exists mid-run, before any
              // assistant entryId is persisted).
              const subagentItemKey = (toolCallId: string) => `subagent-${toolCallId}`;
              // The row's session id comes from the tool result details; a row
              // whose result has not landed yet has none.
              const subagentSessionId = (run: { result?: ToolResultMessage }) =>
                isSubagentToolDetails(run.result?.details) ? run.result.details.sessionId : "";
              // A turn's process blocks may be split into several groups once
              // subagent rows are hoisted out; derive each group's key from the
              // turn's own key so the "keys stay turn-scoped" rule still holds.
              const liveProcessSegmentKey = (userIdx: number, segmentIdx: number) => `${liveProcessItemKey(userIdx)}-seg${segmentIdx}`;
              const processSegmentKey = (userIdx: number, segmentIdx: number, firstBlockId: string) =>
                `${processItemKey(userIdx)}-${firstBlockId || `seg${segmentIdx}`}`;
              for (const item of items) {
                if (item.kind === "single") {
                  // A bare toolResult renders nothing in MessageView (its
                  // content lives inside a ProcessGroup's step); emitting it
                  // as an item would only produce a 0-height phantom row.
                  if (messages[item.idx]?.role === "toolResult") continue;
                  pushRendered(renderMessage(item.idx), visibleRefIndexByMessage.get(item.idx), messageItemKey(item.idx, "single"));
                  continue;
                }

                const { userIdx, endIdx, startsCompactionTurn, finalAssistantIdx } = item;
                const isLiveTail = (agentRunning || streamState.isStreaming)
                  && endIdx === messages.length
                  && (userIdx === lastUserIdx || startsCompactionTurn);

                if (isLiveTail) {
                  // An orphaned-prefix turn (user message paged out of the tail
                  // window) carries userIdx=-1; there is no user row to render.
                  // Mirror the `userIdx >= 0` guard from the historical branch.
                  if (userIdx >= 0) {
                    pushRendered(renderMessage(userIdx), visibleRefIndexByMessage.get(userIdx), messageItemKey(userIdx, "user"));
                  }
                  const hasStreamingAssistant = streamState.streamingMessage?.role === "assistant";
                  const liveProcessIndices: number[] = [];
                  const existingProcessEnd = !hasStreamingAssistant && finalAssistantIdx >= 0 ? finalAssistantIdx : endIdx;
                  for (let processIdx = userIdx + 1; processIdx < existingProcessEnd; processIdx++) {
                    if (hasDisplayableProcessMessage(messages[processIdx])) liveProcessIndices.push(processIdx);
                  }
                  let liveProcessBlocks = collectProcessContentBlocks(messages, entryIds, liveProcessIndices, toolResultsMap);
                  let liveAnswerMessage: AssistantMessage | null = null;

                  if (!hasStreamingAssistant && finalAssistantIdx >= 0) {
                    const existingAssistant = messages[finalAssistantIdx] as AssistantMessage;
                    const existingSplit = splitFinalAssistantBlocks(existingAssistant, { isStreaming: true });
                    const existingContent = splitAssistantContentBlocks(existingAssistant, {
                      messageIndex: finalAssistantIdx,
                      entryId: entryIds[finalAssistantIdx],
                      toolResults: toolResultsMap,
                      isStreaming: true,
                    });
                    liveProcessBlocks = liveProcessBlocks.concat(existingContent.processBlocks);
                    if (existingSplit.answerBlocks.length > 0) {
                      liveAnswerMessage = withAssistantBlocks(existingAssistant, existingSplit.answerBlocks, { omitUsage: true });
                    }
                  }

                  if (hasStreamingAssistant) {
                    const streamingAssistant = streamState.streamingMessage as AssistantMessage;
                    const streamingSplit = splitFinalAssistantBlocks(streamingAssistant, { isStreaming: true });
                    const streamingContent = splitAssistantContentBlocks(streamingAssistant, {
                      messageIndex: messages.length,
                      toolResults: toolResultsMap,
                      isStreaming: true,
                    });
                    liveProcessBlocks = liveProcessBlocks.concat(streamingContent.processBlocks);
                    if (streamingSplit.answerBlocks.length > 0) {
                      liveAnswerMessage = withAssistantBlocks(streamingAssistant, streamingSplit.answerBlocks, { omitUsage: true });
                    }
                  }
                  if (liveProcessBlocks.length > 0) {
                    const processRefIdx = liveProcessIndices
                      .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
                      .find((value): value is number => typeof value === "number");
                    // Subagent runs render as their own persistent rows instead
                    // of collapsing into the process card.
                    splitProcessSegments(liveProcessBlocks).forEach((segment, segmentIdx) => {
                      if (segment.kind === "subagent" && segment.subagent) {
                        pushRendered(
                          <SubagentRunRow key={subagentItemKey(segment.subagent.toolCallId)} run={segment.subagent} onOpenSubagent={onOpenSubagent} sessionRun={subagentRuns?.get(subagentSessionId(segment.subagent))} />,
                          processRefIdx,
                          subagentItemKey(segment.subagent.toolCallId),
                        );
                        return;
                      }
                      pushRendered(
                        <div
                          key={liveProcessSegmentKey(userIdx, segmentIdx)}
                          ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                        >
                          <ProcessGroup
                            blocks={segment.blocks}
                            isStreaming={agentRunning || streamState.isStreaming}
                            cwd={messageCwd}
                            onOpenFile={onOpenFile}
                            sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                            tokenRate={tokenRate}
                          />
                        </div>,
                        processRefIdx,
                        liveProcessSegmentKey(userIdx, segmentIdx),
                      );
                    });
                  }
                  if (liveAnswerMessage) {
                    pushRendered(
                      <MessageView
                        key={`live-answer-${userIdx}`}
                        message={liveAnswerMessage}
                        isStreaming
                        modelNames={modelNames}
                        cwd={messageCwd}
                        onOpenFile={onOpenFile}
                        onQuoteReply={handleQuoteReply}
                    onOpenSession={onOpenSession}
                      />,
                      finalAssistantIdx >= 0 ? visibleRefIndexByMessage.get(finalAssistantIdx) : undefined,
                      liveAnswerItemKey(userIdx),
                    );
                  }
                  continue;
                }

                if (finalAssistantIdx === -1 && item.processBlocks.length === 0) {
                  // Normal turn with nothing displayable: render raw singles.
                  // An ORPHANED-PREFIX turn (userIdx < 0) must not fall through
                  // to raw singles: its messages carry no user anchor, so they
                  // would all render as expanded MessageViews with inline tool
                  // cards and usage footers (the uncollapsed-turn report).
                  // Their toolResults-only messages are invisible anyway, so
                  // skipping them loses nothing.
                  if (userIdx >= 0) {
                    for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                      pushRendered(renderMessage(renderIdx), visibleRefIndexByMessage.get(renderIdx), messageItemKey(renderIdx, "raw"));
                    }
                  }
                  continue;
                }

                if (userIdx >= 0) {
                  pushRendered(renderMessage(userIdx), visibleRefIndexByMessage.get(userIdx), messageItemKey(userIdx, "user"));
                }

                const { finalAnswerMessage, writtenFiles, visibleProcessIndices } = item;
                if (item.processBlocks.length > 0) {
                  const processRefIdx = visibleProcessIndices
                    .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
                    .find((value): value is number => typeof value === "number")
                    ?? (finalAnswerMessage ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
                  // Subagent runs are hoisted out of the collapsed group so
                  // each is a persistent row of its own.
                  item.processSegments.forEach((segment, segmentIdx) => {
                    if (segment.kind === "subagent" && segment.subagent) {
                      pushRendered(
                        <SubagentRunRow key={subagentItemKey(segment.subagent.toolCallId)} run={segment.subagent} onOpenSubagent={onOpenSubagent} sessionRun={subagentRuns?.get(subagentSessionId(segment.subagent))} />,
                        processRefIdx,
                        subagentItemKey(segment.subagent.toolCallId),
                      );
                      return;
                    }
                    pushRendered(
                      <div
                        key={`process-group-${userIdx}-${segmentIdx}`}
                        ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                      >
                        <ProcessGroup
                          blocks={segment.blocks}
                          isStreaming={false}
                          // Historical processing is always compact after a run;
                          // the user can expand it explicitly from the summary.
                          defaultExpanded={false}
                          onAutoExpanded={undefined}
                          cwd={messageCwd}
                          onOpenFile={onOpenFile}
                          sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                        />
                      </div>,
                      processRefIdx,
                      processSegmentKey(userIdx, segmentIdx, segment.blocks[0]?.id ?? ""),
                    );
                  });
                }

                if (finalAnswerMessage) {
                  pushRendered(
                    renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage, writtenFiles }),
                    visibleRefIndexByMessage.get(finalAssistantIdx),
                    answerItemKey(userIdx),
                  );
                }
                // Trailing singles are messages AFTER the turn's final answer
                // (custom entries, late tool results). An orphaned-prefix turn
                // has finalAssistantIdx === -1 and the ProcessGroup above
                // already represents every prefix message — starting the loop
                // at 0 here would re-render the whole prefix as raw expanded
                // MessageViews (inline tool cards + usage footers), the
                // "running turn won't collapse" report.
                if (finalAssistantIdx >= 0) {
                  for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                    pushRendered(renderMessage(renderIdx), visibleRefIndexByMessage.get(renderIdx), messageItemKey(renderIdx, "tail"));
                  }
                }
              }
              // After building all items, expose the per-message → item map to
              // the minimap adapter: each rendered item represents exactly one
              // visible (user/assistant) message ref (mirroring the old DOM-ref
              // semantics where a ProcessGroup node carried a single ref).
              const refToItem: Array<number | undefined> = [];
              const starts = itemStartRefs
                .map((startRef, itemIdx) => ({ startRef, itemIdx }))
                .filter((item): item is { startRef: number; itemIdx: number } => item.startRef !== undefined);
              starts.forEach((item, index) => {
                const nextStart = starts[index + 1]?.startRef ?? visibleMessages.length;
                // One rendered ProcessGroup can represent dozens of raw assistant
                // messages. Map the whole ref range to that item; ChatMinimap
                // deduplicates by item index so the group gets one landmark.
                for (let refIndex = item.startRef; refIndex < nextStart; refIndex++) {
                  refToItem[refIndex] = item.itemIdx;
                }
              });
              refToItemIndexRef.current = refToItem;
              return (
                <VirtualizedMessageList
                  scrollElementRef={scrollContainerRef}
                  items={rendered}
                  itemKeys={itemKeys}
                  virtualizerRef={messageVirtualizerRef}
                  headerHeight={virtualListHeaderHeight}
                />
              );
            })()}


            {activePhaseLabel && (isCompacting || (agentRunning && !streamState.streamingMessage)) && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">
                  {activePhaseLabel}
                  {agentPhase?.kind === "waiting_model" && (
                    <span style={{ display: "inline-block", width: 12, height: 12, marginLeft: 6, verticalAlign: "-2px", border: "1.5px solid var(--text-muted)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  )}
                </span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                }}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{t("desktop.runningShellCommand")}</span>
              </div>
            )}

            {/* Keep-out room below the last message so scrollToBottom has
                 physical space to land the LAST MESSAGE above ChatInput.
                 Always rendered (not only while the agent runs): without
                 trailing space the browser clamps the scroll at the content
                 end and the last line hugs — or is covered by — the input.
                 A full-viewport spacer makes scrollToBottom land on blank
                 space (the end sentinel sits BELOW the spacer) — keep it
                 small and let scrollToBottom back it off so the LAST MESSAGE,
                 not the spacer, sits at the viewport bottom. (Same approach
                 as upstream PR #372; height shared with useAgentSession's
                 backoff via CHAT_BOTTOM_SPACER_PX.) */}
              <div style={{ height: CHAT_BOTTOM_SPACER_PX }} />

              <div ref={messagesEndRef} />

              {/* Plan review shelf — inline at the end of the chat stream so
                   the user can read the plan above before choosing an action. */}
              <PlanReviewDialog
                open={planReviewOpen}
                planText={planReviewText}
                busy={agentRunning}
                onExecute={handlePlanExecute}
                onFeedback={handlePlanFeedback}
                onExit={handlePlanExit}
                onClose={() => setPlanReviewOpen(false)}
              />
              </div>
            </div>
          </div>
          {showChatTopFade && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-[var(--bg)] to-transparent"
            />
          )}
          {showChatBottomFade && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-[var(--bg)] to-transparent"
            />
          )}
          {showScrollToBottom && (
            <button
              type="button"
              onClick={() => scrollToBottomAfterProcessExpansion()}
              title={t("desktop.scrollToBottom")}
              aria-label={t("desktop.scrollToBottom")}
              style={{
                position: "absolute",
                bottom: 14,
                right: 18,
                zIndex: 20,
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px",
                border: "1px solid var(--border)",
                borderRadius: 999,
                background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
                backdropFilter: "blur(4px)",
                transition: "color 0.12s, border-color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />
              {t("desktop.scrollToBottom")}
            </button>
          )}
        </div>
        {isMobile ? null : (
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            virtualizer={minimapVirtualizerAdapter}
          />
        )}
      </div>

      <div className="relative z-10">
        <div
          style={{
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        </div>
        {chatInputElement}
        <div className={`session-info-bar-wrap${isMobile ? " is-mobile" : ""}`}>
          <div className="session-info-bar-inner">
            <SessionInfoBar
              onViewFullHistory={onViewFullHistory}
              cwd={messageCwd}
              systemPrompt={systemPrompt}
              sessionStats={sessionStats}
              contextUsage={contextUsage}
              hasSession={!!session}
              showChat={true}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              onCompact={session ? handleCompact : undefined}
              onAbortCompaction={handleAbortCompaction}
              isCompacting={isCompacting}
              compactError={compactError}
              branchTree={branchTree}
              branchActiveLeafId={branchActiveLeafId}
              onBranchLeafChange={handleLeafChange}
              lastTurnUsage={lastTurnUsage}
            />
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{status.key}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.text}</span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "var(--status-error)"
          : notice.type === "warning"
            ? "var(--status-warning)"
            : notice.type === "success"
              ? "#10b981"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 44,
              maxHeight: 180,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflowY: "auto",
              overflowX: "hidden",
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: 13,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "10px 0", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const focusFirstOption = useCallback((element: HTMLDivElement | null) => element?.focus(), []);

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{t("desktop.extensionRequest")}</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <MarkdownBody>{request.message}</MarkdownBody>
          )}
          {request.method === "select" && (
            <div
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-extension-option]"));
                const index = buttons.indexOf(event.target as HTMLElement);
                if (index < 0) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0
                  : event.key === "End" ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
              }}
              style={{ display: "grid", gap: 8 }}
            >
              {request.options.map((option, index) => (
                <div
                  key={option}
                  role="button"
                  tabIndex={0}
                  data-extension-option
                  aria-label={option}
                  ref={index === 0 ? focusFirstOption : undefined}
                  onClick={() => onRespond(request, { value: option })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRespond(request, { value: option });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  <div inert>
                    <MarkdownBody>{option}</MarkdownBody>
                  </div>
                </div>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t("desktop.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {t("desktop.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {t("desktop.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function toTerminalKeyData(e: KeyboardEvent): string | null {
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    const ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(ch.charCodeAt(0) - 96);
    }
  }

  switch (e.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case " ":
      return " ";
    default:
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) return e.key;
      return null;
  }
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    panelRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          const data = toTerminalKeyData(e);
          if (!data) return;
          e.preventDefault();
          e.stopPropagation();
          onInput(request, data);
        }}
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>{t("desktop.extensionPanel")}</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("desktop.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
