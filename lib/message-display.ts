import type { AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isEmptyThinkingBlock(block, options));
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}

/**
 * Best-effort extraction of the plan text from a message stream for the plan
 * review shelf. The plan-mode extension returns the finished plan as a
 * `plan_mode_complete` tool result (`**Proposed Plan**\n\n{plan}`), so we look
 * for it there first, then fall back to the last assistant text block.
 */
export function extractPlanText(messages: Array<{ role: string; content?: unknown }>): string | null {
  // 1. Last assistant text block (streamed plans that were not tooled).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const content = m.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = (content as AssistantContentBlock[])
        .filter((b) => b.type === "text")
        .map((b) => (b as { text?: string }).text ?? "")
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  // 2. plan_mode_complete tool result (the authoritative finished plan).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "toolResult") continue;
    const content = m.content;
    const raw = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? (content as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n")
        : "";
    if (!raw) continue;
    const proposed = raw.match(/\*\*Proposed Plan\*\*\s*\n+([\s\S]+)/i);
    if (proposed?.[1]?.trim()) return proposed[1].trim();
  }
  return null;
}
