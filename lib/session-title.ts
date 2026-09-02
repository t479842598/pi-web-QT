import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { stripModeInstructionBlocks } from "./modes";

const TITLE_TIMEOUT_MS = 80_000;
const TITLE_ABORT_SETTLE_MS = 5_000;
/** Max time to wait for the source session to become idle before snapshotting.
 *  The app is frequently deployed behind Cloudflare (100s gateway timeout), so
 *  idle-wait + model call must stay comfortably under that ceiling. */
const TITLE_IDLE_WAIT_TIMEOUT_MS = 10_000;
const MAX_TITLE_LENGTH = 80;
/** Cap the number of messages sent to the title model so very long sessions
 *  (imported sessions can have thousands of tool messages) generate quickly
 *  instead of timing out. The tail of a conversation carries the current goal. */
const MAX_TITLE_MESSAGES = 40;

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

export interface GeneratedSessionTitle {
  title: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

function createShadowTools(tools: AgentTool[]): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async () => {
      throw new Error("Tools cannot be executed while generating a session title");
    },
  }));
}

/**
 * Build a temporary Agent configuration whose provider-facing prefix matches
 * the source Agent. Tool implementations are replaced without changing their
 * names, descriptions, or schemas, so a naming run cannot mutate the project.
 */
export function buildSessionTitleAgentOptions(source: Agent): AgentOptions {
  const state = source.state;
  return {
    initialState: {
      systemPrompt: state.systemPrompt,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      tools: createShadowTools(state.tools),
      messages: state.messages,
    },
    convertToLlm: source.convertToLlm,
    transformContext: source.transformContext,
    streamFn: source.streamFunction,
    getApiKey: source.getApiKey,
    onPayload: source.onPayload,
    onResponse: source.onResponse,
    steeringMode: source.steeringMode,
    followUpMode: source.followUpMode,
    sessionId: source.sessionId,
    thinkingBudgets: source.thinkingBudgets,
    transport: source.transport,
    maxRetryDelayMs: source.maxRetryDelayMs,
    toolExecution: source.toolExecution,
  };
}

/**
 * A running source session usually ends in the user message currently being
 * answered. Fold the title request into a copy of that message so the title
 * request does not send two consecutive user messages to the provider.
 */
export function appendTitleRequestToTrailingUser(messages: AgentMessage[]): AgentMessage[] {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "user") return messages;

  const content = typeof lastMessage.content === "string"
    ? `${lastMessage.content}\n\n${TITLE_PROMPT}`
    : [...lastMessage.content, { type: "text" as const, text: TITLE_PROMPT }];

  return [
    ...messages.slice(0, -1),
    { ...lastMessage, content },
  ];
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

export function parseGeneratedSessionTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Fall back to plain-text cleanup below.
    }
  }

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();
  // The model may echo an injected mode-instruction block (delivery/economy/
  // plan) into the title when the conversation history starts with one.
  // Strip it so a title never begins with "<delivery-profile>…".
  value = stripModeInstructionBlocks(value);

  if (!/[\p{L}\p{N}]/u.test(value)) {
    throw new Error("The model did not return a usable session title");
  }

  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) {
    value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  }
  return value;
}

function getAssistantResult(agent: Agent, historyLength: number): GeneratedSessionTitle {
  const generatedMessages = agent.state.messages.slice(historyLength);
  for (let i = generatedMessages.length - 1; i >= 0; i--) {
    const message = generatedMessages[i];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || "The title model request failed");
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) continue;
    return {
      title: parseGeneratedSessionTitle(text),
      ...(message.usage ? {
        usage: {
          input: message.usage.input,
          output: message.usage.output,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
          total: message.usage.totalTokens,
        },
      } : {}),
    };
  }
  throw new Error("The model did not return a session title");
}

export function sanitizeTitleMessages(messages: AgentMessage[]): AgentMessage[] {
  const sanitized: AgentMessage[] = [];
  let expectedToolResultIds: Set<string> | undefined;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (message.role === "assistant") {
      const followingToolResultIds = new Set<string>();
      for (let resultIndex = index + 1; resultIndex < messages.length; resultIndex++) {
        const resultMessage = messages[resultIndex];
        if (resultMessage.role !== "toolResult") break;
        followingToolResultIds.add(resultMessage.toolCallId);
      }

      expectedToolResultIds = new Set<string>();
      const content = message.content.filter((block) => {
        if (block.type !== "toolCall") return true;
        if (!followingToolResultIds.has(block.id)) return false;
        expectedToolResultIds!.add(block.id);
        return true;
      });

      if (content.length > 0) {
        sanitized.push({ ...message, content: repairTextBlocks(content) });
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (expectedToolResultIds?.delete(message.toolCallId)) {
        sanitized.push(repairMessageTextBlocks(message));
      }
      continue;
    }

    expectedToolResultIds = undefined;
    sanitized.push(repairMessageTextBlocks(message));
  }

  return sanitized;
}

/**
 * Providers read `block.text.length` when serializing text blocks; sessions
 * imported from other tools can contain `{"type":"text"}` blocks with a
 * missing `text` field, which previously crashed title generation with
 * "Cannot read properties of undefined (reading 'length')". Patch those
 * blocks in place (keeping the message reference when nothing is broken).
 */
function repairMessageTextBlocks(message: AgentMessage): AgentMessage {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return message;
  const repaired = repairTextBlocks(content as Array<{ type: string }>);
  if (repaired === content) return message;
  return { ...message, content: repaired } as AgentMessage;
}

function repairTextBlocks<T extends { type: string }>(content: T[]): T[] {
  let changed = false;
  const repaired = content.map((block) => {
    if (block.type === "text" && typeof (block as { text?: unknown }).text !== "string") {
      changed = true;
      return { ...block, text: "" } as T;
    }
    return block;
  });
  return changed ? repaired : content;
}

/** Per-text-block cap for title generation: tool outputs can be huge, and the
 *  title model's context is smaller than the main model's. Truncating keeps a
 *  40-message tail comfortably inside the budget. */
const MAX_TITLE_TEXT_BLOCK = 600;
/** Total cap for all text across the title input (safety net). */
const MAX_TITLE_TOTAL_TEXT = 8_000;

/** Trim oversized text blocks in the title input so the title model's context
 *  is never exceeded (GLM code=10040 "model response context exceeded"). */
function truncateTitleMessages(messages: AgentMessage[]): AgentMessage[] {
  let remaining = Math.max(0, MAX_TITLE_TOTAL_TEXT - TITLE_PROMPT.length - 32);
  const reversed = [...messages].reverse().map((message) => {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      const kept = remaining > 0 ? content.slice(Math.max(0, content.length - remaining)) : "";
      remaining = Math.max(0, remaining - kept.length);
      return kept === content ? message : { ...message, content: kept } as AgentMessage;
    }
    if (!Array.isArray(content)) return message;
    let changed = false;
    const next = [...content].reverse().map((block) => {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") return block;
      const textBlock = block as { text?: string };
      const raw = typeof textBlock.text === "string" ? textBlock.text : "";
      const perBlock = raw.length > MAX_TITLE_TEXT_BLOCK
        ? `${raw.slice(0, MAX_TITLE_TEXT_BLOCK)}\n…[truncated]`
        : raw;
      const kept = remaining > 0 ? perBlock.slice(Math.max(0, perBlock.length - remaining)) : "";
      remaining = Math.max(0, remaining - kept.length);
      if (kept !== raw) changed = true;
      return changed || kept !== raw ? { ...textBlock, text: kept } : block;
    }).reverse();
    return changed ? { ...message, content: next } as AgentMessage : message;
  });
  return reversed.reverse();
}

function selectTitleMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_TITLE_MESSAGES) return messages;
  const tailStart = messages.length - MAX_TITLE_MESSAGES;
  const tail = messages.slice(tailStart);
  if (tail.some((message) => message.role === "user" || (message.role === "custom" && message.customType === "compaction"))) {
    return tail;
  }
  for (let index = tailStart - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" || (message.role === "custom" && message.customType === "compaction")) {
      return [message, ...tail.slice(1)];
    }
  }
  return tail;
}

function abortError(): Error {
  const error = new Error("Session title generation was cancelled");
  error.name = "AbortError";
  return error;
}

async function waitForIdleOrTimeout(sourceAgent: Agent, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      sourceAgent.waitForIdle(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, TITLE_IDLE_WAIT_TIMEOUT_MS); }),
      ...(signal ? [new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort!, { once: true });
      })] : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function generateSessionTitle(
  source: AgentSession,
  modelOverride?: Model<Api>,
  signal?: AbortSignal,
): Promise<GeneratedSessionTitle> {
  const sourceAgent = source.agent;
  // The source session may still be running (e.g. the user just sent a
  // message). Waiting indefinitely would exceed the Cloudflare 100s gateway
  // timeout (HTTP 524) whenever the session takes longer than that to finish.
  // Wait a bounded amount of time, then snapshot the current messages — the
  // title is derived from the conversation tail, which is already complete.
  await waitForIdleOrTimeout(sourceAgent, signal);

  // Keep only the tail of long conversations: imported sessions can contain
  // thousands of toolResult messages that bloat the context and slow or time
  // out title generation. The most recent turn carries the current goal.
  // If the tail happens to be all tool messages, fall back to the full
  // transcript so we never claim the session has no user messages.
  const rawMessages = sourceAgent.state.messages;
  const candidate = selectTitleMessages(rawMessages);
  const sanitizedMessages = truncateTitleMessages(sanitizeTitleMessages(candidate));
  const historyLength = sanitizedMessages.length;
  const hasTitleSource = sanitizedMessages.some((message) => (
    message.role === "user"
    || (message.role === "custom" && message.customType === "compaction")
  ));
  if (!hasTitleSource) {
    throw new Error("The session has no user messages to name");
  }

  const options = buildSessionTitleAgentOptions(sourceAgent);
  if (modelOverride) {
    options.initialState!.model = modelOverride;
  }
  options.initialState!.messages = sanitizedMessages;
  const continuesFromTrailingUser = sanitizedMessages.at(-1)?.role === "user";
  if (continuesFromTrailingUser) {
    options.initialState!.messages = appendTitleRequestToTrailingUser(sanitizedMessages);
  }

  const temporaryAgent = new Agent(options);
  const runPromise = continuesFromTrailingUser
    ? temporaryAgent.continue()
    : temporaryAgent.prompt(TITLE_PROMPT);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Session title generation timed out")), TITLE_TIMEOUT_MS);
      }),
      ...(signal ? [new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort!, { once: true });
      })] : []),
    ]);
  } catch (error) {
    temporaryAgent.abort();
    runPromise.catch(() => {});
    await Promise.race([
      runPromise.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, TITLE_ABORT_SETTLE_MS)),
    ]);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }

  return getAssistantResult(temporaryAgent, historyLength);
}
