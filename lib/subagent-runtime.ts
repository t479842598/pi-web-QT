import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";
import {
  subagentNotificationText,
  subagentToolDetails,
  type ResumeSubagentRequest,
  type StartSubagentRequest,
  type SubagentExecution,
  type SubagentExtensionRuntime,
} from "./subagent-extension";
import {
  readSubagentRun,
  resolveSubagentProfile,
  SUBAGENT_CONTROL_TOOL_NAMES,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  SUBAGENT_RESULT_TYPE,
  selectSubagentExtensionTools,
  withSubagentExtensionTools,
  type SubagentMetadata,
  type SubagentResultMetadata,
  type SubagentRunInfo,
} from "./subagents";
import type { SessionEntry } from "./types";
import { buildSubagentPromptPlan } from "./subagent-prompt";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { appendSubagentInputFiles, loadSubagentInputFiles } from "./subagent-input";
import { projectTrustReloadOptions } from "./project-trust";
import { resolveShellTools } from "./powershell-settings";
import { isBuiltInSubagentsEnabled, readSubagentSettings } from "./subagent-settings";
import { SubagentQueue } from "./subagent-queue";
import { addWorktree, removeWorktree } from "./worktree";
import { randomUUID } from "node:crypto";

interface HostSession {
  readonly inner: AgentSessionLike;
  readonly sessionFile: string;
  readonly cwd: string;
  isAlive(): boolean;
  isRunning(): boolean;
  waitUntilReady(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface SubagentRuntimeDependencies {
  getSession(sessionId: string): HostSession | undefined;
  registerSession(
    inner: AgentSessionLike,
    options?: { exactSystemPrompt?: string; chatOnly?: boolean },
  ): void;
  reopenSession(sessionId: string, sessionFile: string): Promise<HostSession>;
  resolveSessionPath(sessionId: string): Promise<string | null>;
  invalidateSessionList(): void;
  notifyRunningChange?(): void;
  isBuiltInSubagentsEnabled?(): boolean;
}

export interface SubagentController {
  readonly extensionRuntime: SubagentExtensionRuntime;
  get(sessionId: string): Promise<SubagentRunInfo | null>;
  steer(sessionId: string, message: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

type StoredSubagentExecution = {
  run: SubagentRunInfo;
  completion: Promise<SubagentRunInfo>;
  abortRequested: boolean;
  cancelQueued?: () => boolean;
};

declare global {
  var __piSubagentRuns: Map<string, StoredSubagentExecution> | undefined;
  var __piSubagentQueue: SubagentQueue<SubagentRunInfo> | undefined;
  var __piSubagentConsumedResults: Set<string> | undefined;
}
const SUBAGENT_CONTEXT_LIMIT = 50_000;
const PARENT_IDLE_POLL_MS = 200;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** pi's agent loop records provider failures as an assistant message with `stopReason: "error"` and resolves `prompt()` normally; surface that as a failed run. */
function lastAssistantError(sessionManager: { getEntries?: () => unknown }): string | undefined {
  const entries = sessionManager.getEntries?.();
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: unknown; message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } };
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    if (entry.message.stopReason !== "error") return undefined;
    return typeof entry.message.errorMessage === "string" && entry.message.errorMessage ? entry.message.errorMessage : "Provider returned an error";
  }
  return undefined;
}

function getSubagentRuns(): Map<string, StoredSubagentExecution> {
  if (!globalThis.__piSubagentRuns) globalThis.__piSubagentRuns = new Map();
  return globalThis.__piSubagentRuns;
}

function getSubagentQueue(): SubagentQueue<SubagentRunInfo> {
  if (!globalThis.__piSubagentQueue) globalThis.__piSubagentQueue = new SubagentQueue();
  return globalThis.__piSubagentQueue;
}

/**
 * Session IDs whose terminal result the parent already collected with `get_subagent_result`.
 * Only background runs are recorded: a foreground run never notifies, so nothing would ever
 * clear its entry. `notifyParent` consumes the mark, so the set stays bounded by the
 * background results still waiting to be delivered.
 */
function getConsumedSubagentResults(): Set<string> {
  if (!globalThis.__piSubagentConsumedResults) globalThis.__piSubagentConsumedResults = new Set();
  return globalThis.__piSubagentConsumedResults;
}

function markResultConsumed(sessionId: string): void {
  getConsumedSubagentResults().add(sessionId);
}

function takeResultConsumed(sessionId: string): boolean {
  return getConsumedSubagentResults().delete(sessionId);
}

function parseSubagentModel(runtime: ModelRuntime, value: string | undefined) {
  if (!value?.trim()) return undefined;
  const requested = value.trim();
  const slash = requested.indexOf("/");
  if (slash > 0) {
    const provider = requested.slice(0, slash);
    const modelId = requested.slice(slash + 1);
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error(`Subagent model not found: ${requested}`);
    return model;
  }
  const matches = runtime.getModels().filter((model) => model.id === requested);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Subagent model not found: ${requested}`);
  throw new Error(`Subagent model is ambiguous; use provider/modelId: ${requested}`);
}

function parentContextText(parent: HostSession): string {
  const messages = parent.inner.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(messages);
  if (serialized.length <= SUBAGENT_CONTEXT_LIMIT) return serialized;
  return `${serialized.slice(0, SUBAGENT_CONTEXT_LIMIT)}\n[Parent context truncated]`;
}

async function cleanupWorktree(
  parentCwd: string,
  worktree: { path: string; branch: string } | undefined,
): Promise<string | undefined> {
  if (!worktree) return undefined;
  try {
    await removeWorktree(parentCwd, worktree.path);
    return undefined;
  } catch (error) {
    return `Worktree retained at ${worktree.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** One listener spans setup, queue admission and execution. Installing a late
 * listener cannot replay an abort that happened during an earlier await. */
function observeParentAbort(signal?: AbortSignal) {
  let ignored = false;
  let handler: (() => void) | undefined;
  const onAbort = () => { if (!ignored) handler?.(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const state = {
    get aborted() { return !ignored && signal?.aborted === true; },
    throwIfAborted() {
      if (state.aborted) throw new DOMException("Subagent was stopped during setup", "AbortError");
    },
    setHandler(next: () => void) {
      handler = next;
      if (state.aborted) next();
    },
    dispose() {
      signal?.removeEventListener("abort", onAbort);
      handler = undefined;
    },
    ignore() { ignored = true; state.dispose(); },
  };
  return state;
}

type ParentAbort = ReturnType<typeof observeParentAbort>;

export function createSubagentController(
  dependencies: SubagentRuntimeDependencies,
): SubagentController {
  async function disposeSession(inner: AgentSessionLike): Promise<void> {
    const wrapper = dependencies.getSession(inner.sessionId);
    if (wrapper?.inner === inner && wrapper.shutdown) await wrapper.shutdown();
    else inner.dispose();
  }

  /** Every terminal path shares one finalizer, including queue cancellation
   * before enqueue() has returned its cancel callback. */
  function queueRun(options: {
    initialRun: SubagentRunInfo;
    inner: AgentSessionLike;
    request: StartSubagentRequest | ResumeSubagentRequest;
    cancellation: ParentAbort;
    prompt: (checkCanceled: () => void) => Promise<void>;
    maxTurnsReached?: () => boolean;
    unsubscribe?: () => void;
    cleanup?: (result: SubagentRunInfo) => Promise<string | undefined>;
    close?: (result: SubagentRunInfo) => Promise<void>;
  }): SubagentExecution {
    const { initialRun, inner, request, cancellation } = options;
    let resolveCompletion!: (run: SubagentRunInfo) => void;
    const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
    const stored: StoredSubagentExecution = { run: initialRun, completion, abortRequested: cancellation.aborted };
    let finishing: Promise<SubagentRunInfo> | undefined;
    let promptStarted = false;
    const canceled = () => stored.abortRequested || cancellation.aborted;
    const abortedResult = (): SubagentRunInfo => ({ ...initialRun, status: "aborted", completedAt: new Date().toISOString() });
    const publish = (run: SubagentRunInfo) => {
      // A disconnected tool observer must not prevent persistence/cleanup.
      try { request.onUpdate?.(run); } catch (error) { console.error("[subagents] update listener failed:", error); }
    };
    const finish = (result: SubagentRunInfo): Promise<SubagentRunInfo> => {
      if (finishing) return finishing;
      stored.run = result;
      stored.cancelQueued = undefined;
      cancellation.dispose();
      options.unsubscribe?.();
      finishing = Promise.resolve().then(async () => {
        let finalResult = result;
        try {
          const cleanupError = await options.cleanup?.(result);
          if (cleanupError) finalResult = { ...result, worktreeCleanupError: cleanupError };
          const persisted: SubagentResultMetadata = {
            version: 1,
            status: finalResult.status as SubagentResultMetadata["status"],
            completedAt: finalResult.completedAt!,
            ...(finalResult.result ? { result: finalResult.result } : {}),
            ...(finalResult.error ? { error: finalResult.error } : {}),
            ...(finalResult.worktreeCleanupError ? { worktreeCleanupError: finalResult.worktreeCleanupError } : {}),
          };
          inner.sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, persisted);
        } catch (error) {
          finalResult = { ...finalResult, error: error instanceof Error ? error.message : String(error) };
          if (finalResult.status !== "aborted") finalResult.status = "failed";
        } finally {
          // Persist terminal status (including worktree cleanup diagnostics)
          // before shutdown can revoke persistence or dispose the SDK session.
          try { await options.close?.(finalResult); } catch (error) {
            console.error("[subagents] session shutdown failed:", error);
          }
          stored.run = finalResult;
          if (getSubagentRuns().get(initialRun.sessionId) === stored) getSubagentRuns().delete(initialRun.sessionId);
          publish(finalResult);
          dependencies.invalidateSessionList();
          dependencies.notifyRunningChange?.();
          resolveCompletion(finalResult);
        }
        return finalResult;
      });
      return finishing;
    };
    const execute = async (): Promise<SubagentRunInfo> => {
      if (canceled()) return finish(abortedResult());
      let result: SubagentRunInfo;
      try {
        promptStarted = true;
        await options.prompt(() => {
          if (canceled()) throw new DOMException("Subagent was stopped before prompt preflight completed", "AbortError");
        });
        const text = inner.getLastAssistantText()?.trim();
        result = { ...initialRun, status: canceled() ? "aborted" : "completed", completedAt: new Date().toISOString(), ...(text ? { result: text } : {}) };
      } catch (error) {
        const aborted = canceled();
        const text = inner.getLastAssistantText()?.trim();
        const limited = options.maxTurnsReached?.() === true;
        result = {
          ...initialRun,
          status: aborted ? "aborted" : limited ? "completed" : "failed",
          completedAt: new Date().toISOString(),
          ...(text ? { result: text } : {}),
          ...(!aborted && !limited ? { error: error instanceof Error ? error.message : String(error) } : {}),
        };
      } finally {
        promptStarted = false;
      }
      return finish(result);
    };
    getSubagentRuns().set(initialRun.sessionId, stored);
    cancellation.setHandler(() => {
      stored.abortRequested = true;
      if (stored.run.status === "queued") stored.cancelQueued?.();
      else if (promptStarted) void inner.abort().catch(() => undefined);
    });
    publish(initialRun);
    dependencies.invalidateSessionList();
    if (canceled()) {
      void finish(abortedResult());
    } else {
      try {
        const queued = getSubagentQueue().enqueue(initialRun.parentSessionId, readSubagentSettings().maxConcurrent, execute, (status) => {
          if (finishing) return;
          stored.run = { ...stored.run, status };
          inner.sessionManager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status });
          publish(stored.run);
          dependencies.invalidateSessionList();
        }, async () => { await finish(abortedResult()); });
        stored.cancelQueued = queued.cancel;
        if (canceled() && stored.run.status === "queued") queued.cancel();
        void queued.promise.catch((error) => finish(canceled() ? abortedResult() : {
          ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error),
        }));
      } catch (error) {
        void finish(canceled() ? abortedResult() : {
          ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { run: stored.run, completion };
  }

  async function start(request: StartSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    if (!parent.sessionFile) throw new Error("Parent session must be persisted before starting a subagent");

    const profile = resolveSubagentProfile(parent.cwd, request.profile);
    if (!profile) throw new Error(`Unknown or disabled subagent profile: ${request.profile}`);
    const runInBackground = request.runInBackground ?? profile.runInBackground;
    const cancellation = observeParentAbort(runInBackground ? undefined : request.signal);
    let isolatedWorktree: { path: string; branch: string } | undefined;
    let createdInner: AgentSessionLike | undefined;
    let setupManager: SessionManager | undefined;
    try {
      cancellation.throwIfAborted();
      const isolation = profile.isolation === "off" ? undefined : request.isolation ?? profile.isolation;
      if (isolation === "worktree") {
        isolatedWorktree = await addWorktree(parent.cwd, `pi-web-agent-${randomUUID()}`);
        cancellation.throwIfAborted();
      }
      const childCwd = isolatedWorktree?.path ?? parent.cwd;
      const inheritContext = request.inheritContext ?? profile.inheritContext;
      const maxTurns = request.maxTurns ?? profile.maxTurns;
      if (maxTurns !== undefined && (!Number.isFinite(maxTurns) || maxTurns < 0)) {
        throw new Error("max_turns must be a non-negative number");
      }
      const turnLimit = maxTurns && maxTurns > 0 ? Math.floor(maxTurns) : undefined;
      const thinking = request.thinking ?? profile.thinking ?? parent.inner.agent.state?.thinkingLevel;
      if (thinking && !THINKING_LEVELS.has(thinking as ThinkingLevel)) {
        throw new Error(`Invalid subagent thinking level: ${thinking}`);
      }

      const agentDir = getAgentDir();
      const parentModelRuntime = (parent.inner as unknown as { modelRuntime: ModelRuntime }).modelRuntime;
      const settingsManager = SettingsManager.create(childCwd, agentDir);
      const inheritedParentContext = inheritContext
        ? `The following is the active conversation context from the parent session. Use it only as background for the delegated task:\n${parentContextText(parent)}`
        : undefined;
      const inputFiles = loadSubagentInputFiles(parent.cwd, request.inputFiles ?? []);
      const promptPlan = buildSubagentPromptPlan({
        profileSystemPrompt: profile.systemPrompt,
        tools: profile.tools,
        loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        promptMode: profile.promptMode,
        task: appendSubagentInputFiles(request.task, inputFiles),
        inheritedParentContext,
      });
      const { chatOnly, appendSystemPrompt, delegatedTask } = promptPlan;
      if (!chatOnly) initTheme();
      const services = await createAgentSessionServices({
        cwd: childCwd,
        agentDir,
        modelRuntime: parentModelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          noExtensions: !profile.loadExtensions,
          noSkills: !profile.loadSkills,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          ...(chatOnly || promptPlan.exactSystemPrompt !== undefined
            ? {
                systemPrompt: " ",
                systemPromptOverride: () => undefined,
              }
            : {}),
          appendSystemPrompt,
          // The exact prompt is sent through before_agent_start; see lib/exact-system-prompt.ts.
          ...(promptPlan.exactSystemPrompt !== undefined
            ? { extensionFactories: [createExactSystemPromptExtension(() => promptPlan.exactSystemPrompt)] }
            : {}),
        },
        ...((profile.loadExtensions || profile.loadSkills)
          ? { resourceLoaderReloadOptions: projectTrustReloadOptions(childCwd, agentDir) }
          : {}),
      });
      cancellation.throwIfAborted();

      const extensionToolNames = profile.loadExtensions
        ? profile.extensionTools?.length
          ? selectSubagentExtensionTools(services.resourceLoader.getExtensions().extensions, profile.extensionTools)
          : services.resourceLoader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])
        : [];
      const activeTools = resolveShellTools(
        withSubagentExtensionTools(profile.tools, extensionToolNames),
        settingsManager.getDefaultTools(),
      );

      const sessionManager = isolatedWorktree
        ? SessionManager.create(childCwd, undefined, { parentSession: parent.sessionFile })
        : SessionManager.create(parent.cwd, undefined, { parentSession: parent.sessionFile });
      setupManager = sessionManager;
      const createdAt = new Date().toISOString();
      const metadata: SubagentMetadata = {
        version: 1,
        parentSessionId,
        parentSessionPath: parent.sessionFile,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: request.description.trim() || profile.displayName,
        task: request.task,
        runInBackground,
        createdAt,
        resourceSnapshot: {
          version: 1,
          appendSystemPrompt: [...appendSystemPrompt],
          tools: [...activeTools],
          loadSkills: profile.loadSkills,
          loadExtensions: profile.loadExtensions,
          ...(promptPlan.exactSystemPrompt !== undefined ? { exactSystemPrompt: promptPlan.exactSystemPrompt } : {}),
        },
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };
      sessionManager.appendCustomEntry(SUBAGENT_META_TYPE, metadata);
      sessionManager.appendSessionInfo(metadata.description);

      const requestedModel = parseSubagentModel(parentModelRuntime, request.model ?? profile.model);
      const parentModel = parent.inner.model as ReturnType<ModelRuntime["getModel"]>;
      const { session: inner } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model: requestedModel ?? parentModel,
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
        tools: activeTools,
        excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES],
      });
      createdInner = inner as unknown as AgentSessionLike;
      cancellation.throwIfAborted();
      dependencies.registerSession(inner, {
        ...(promptPlan.exactSystemPrompt !== undefined
          ? { exactSystemPrompt: promptPlan.exactSystemPrompt }
          : {}),
        chatOnly,
      });

      const initialRun: SubagentRunInfo = {
        sessionId: inner.sessionId,
        sessionPath: inner.sessionFile ?? sessionManager.getSessionFile() ?? "",
        parentSessionId,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: metadata.description,
        task: request.task,
        runInBackground,
        status: "queued",
        createdAt,
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };

      let turnCount = 0;
      let maxTurnsReached = false;
      let softLimitReached = false;
      const unsubscribeTurns = turnLimit
        ? inner.subscribe((event) => {
            if (event.type !== "turn_end") return;
            turnCount += 1;
            if (!softLimitReached && turnCount >= turnLimit) {
              softLimitReached = true;
              void inner.steer("You have reached your turn limit. Wrap up immediately and provide your final answer now.");
            } else if (softLimitReached && turnCount >= turnLimit + 1) {
              maxTurnsReached = true;
              void inner.abort();
            }
          })
        : () => {};
      return queueRun({
        initialRun,
        inner: createdInner,
        request,
        cancellation,
        unsubscribe: unsubscribeTurns,
        maxTurnsReached: () => maxTurnsReached,
        prompt: (checkCanceled) => inner.prompt(delegatedTask, {
          source: "rpc",
          preflightResult: (success: boolean) => {
            if (!success) return;
            checkCanceled();
            if (chatOnly && inner.agent.state) inner.agent.state.systemPrompt = profile.systemPrompt;
          },
        }),
        cleanup: () => cleanupWorktree(parent.cwd, isolatedWorktree),
        close: async (result) => {
          if (isolatedWorktree || result.status === "aborted") await disposeSession(createdInner!);
        },
      });
    } catch (error) {
      cancellation.dispose();
      const cleanupError = await cleanupWorktree(parent.cwd, isolatedWorktree);
      const aborted = cancellation.aborted;
      try {
        setupManager?.appendCustomEntry(SUBAGENT_RESULT_TYPE, {
          version: 1, status: aborted ? "aborted" : "failed", completedAt: new Date().toISOString(),
          ...(cleanupError ? { worktreeCleanupError: cleanupError } : {}),
        });
      } finally {
        if (createdInner) await disposeSession(createdInner);
      }
      if (aborted) throw new DOMException(`Subagent was stopped during setup${cleanupError ? `; ${cleanupError}` : ""}`, "AbortError");
      if (cleanupError) throw new Error(`${error instanceof Error ? error.message : String(error)}; ${cleanupError}`, { cause: error });
      throw error;
    }
  }

  async function resume(request: ResumeSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    // The persisted background default is not known until get() finishes. Track
    // the signal meanwhile, then ignore it entirely if this is a background run.
    const cancellation = observeParentAbort(request.runInBackground === true ? undefined : request.signal);
    let reopened: HostSession | undefined;
    try {
      if (request.runInBackground === false) cancellation.throwIfAborted();
      const existing = await get(request.sessionId);
      if (!existing) throw new Error(`Subagent not found: ${request.sessionId}`);
      if (existing.parentSessionId !== parentSessionId) throw new Error("Subagent does not belong to this parent session");
      const runInBackground = request.runInBackground ?? existing.runInBackground;
      if (runInBackground) cancellation.ignore();
      cancellation.throwIfAborted();
      if (existing.status === "running" || existing.status === "queued") throw new Error("Subagent is already running");
      const parent = dependencies.getSession(parentSessionId);
      if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
      const sessionPath = existing.sessionPath || await dependencies.resolveSessionPath(request.sessionId);
      cancellation.throwIfAborted();
      if (!sessionPath) throw new Error(`Subagent session file not found: ${request.sessionId}`);
      let wrapper = dependencies.getSession(request.sessionId);
      if (!wrapper?.isAlive()) {
        reopened = wrapper = await dependencies.reopenSession(request.sessionId, sessionPath);
        cancellation.throwIfAborted();
      }
      if (!wrapper.isAlive()) throw new Error("Subagent session is no longer available");
      if (wrapper.isRunning() || getSubagentRuns().has(request.sessionId)) throw new Error("Subagent is already running");
      const initialRun: SubagentRunInfo = {
        ...existing,
        parentToolCallId: request.parentToolCallId,
        task: request.task,
        description: request.description.trim() || existing.description,
        runInBackground,
        status: "queued",
        completedAt: undefined,
        result: undefined,
        error: undefined,
      };
      const inner = wrapper.inner;
      return queueRun({
        initialRun, inner, request, cancellation,
        prompt: (checkCanceled) => inner.prompt(request.task, {
          source: "rpc",
          preflightResult: (success) => { if (success) checkCanceled(); },
        }),
        close: async (result) => {
          if (result.status === "aborted") await disposeSession(inner);
        },
      });
    } catch (error) {
      cancellation.dispose();
      if (reopened && !reopened.isRunning() && !getSubagentRuns().has(request.sessionId)) {
        await disposeSession(reopened.inner);
      }
      cancellation.throwIfAborted();
      throw error;
    }
  }

  async function get(sessionId: string): Promise<SubagentRunInfo | null> {
    const stored = getSubagentRuns().get(sessionId);
    if (stored) return stored.run;
    const wrapper = dependencies.getSession(sessionId);
    if (wrapper?.isAlive()) {
      const run = readSubagentRun(
        wrapper.inner.sessionManager.getEntries() as unknown as SessionEntry[],
        sessionId,
        wrapper.sessionFile,
      );
      if (run && wrapper.isRunning()) return { ...run, status: "running" };
      if (run) return run;
    }
    const sessionPath = await dependencies.resolveSessionPath(sessionId);
    if (!sessionPath) return null;
    const manager = SessionManager.open(sessionPath);
    return readSubagentRun(manager.getEntries() as unknown as SessionEntry[], sessionId, sessionPath);
  }

  async function steer(sessionId: string, message: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (!message.trim()) throw new Error("Steering message is required");
    await wrapper.inner.steer(message.trim());
  }

  async function notifyParent(run: SubagentRunInfo): Promise<void> {
    if (takeResultConsumed(run.sessionId)) return;
    let parent = dependencies.getSession(run.parentSessionId);
    if (!parent?.isAlive()) {
      const sessionFile = await dependencies.resolveSessionPath(run.parentSessionId);
      if (!sessionFile) throw new Error(`Parent session not found: ${run.parentSessionId}`);
      parent = await dependencies.reopenSession(run.parentSessionId, sessionFile);
    }
    await parent.waitUntilReady();
    // The parent may still be inside the `get_subagent_result` call that collects this result,
    // and `deliverAs: "followUp"` would only queue the message until that turn ends anyway.
    // Hold the notification until the parent is idle and re-check the mark, so a result the
    // parent already consumed never triggers a duplicate turn.
    while (parent.isAlive() && parent.isRunning()) {
      if (takeResultConsumed(run.sessionId)) return;
      await new Promise<void>((resolve) => { setTimeout(resolve, PARENT_IDLE_POLL_MS); });
    }
    if (takeResultConsumed(run.sessionId)) return;
    if (!parent.isAlive()) throw new Error(`Parent session is no longer available: ${run.parentSessionId}`);
    await parent.inner.sendCustomMessage({
      customType: "pi-web:subagent-notification",
      content: subagentNotificationText(run),
      display: true,
      details: subagentToolDetails(run),
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  async function abort(sessionId: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    const stored = getSubagentRuns().get(sessionId);
    if (stored?.run.status === "queued") {
      stored.abortRequested = true;
      if (!stored.cancelQueued?.()) throw new Error("Subagent is no longer queued");
      return;
    }
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (stored) stored.abortRequested = true;
    await wrapper.inner.abort();
  }

  return {
    extensionRuntime: { start, resume, get, steer, notifyParent, markResultConsumed },
    get,
    steer,
    abort,
  };
}
