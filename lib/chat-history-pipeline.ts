import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolResultMessage } from "./types";
import { getAssistantErrorMessage, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "./message-display";
import {
  collectProcessContentBlocks,
  splitAssistantContentBlocks,
  splitProcessSegments,
  type ProcessContentBlock,
  type ProcessSegment,
} from "./process-content";
import { extractTurnWrittenFiles, type WrittenFile } from "./turn-written-files";

/**
 * History render pipeline for ChatWindow.
 *
 * The chat render walks `messages` and, for every historical turn, runs block
 * splitting / process-block collection / written-file extraction. Those are
 * pure functions of (messages, entryIds, messageCwd), but they used to run
 * inside the JSX on EVERY render — including every streamed token (30fps
 * coalesced), recomputing all prior turns. ChatWindow memoizes the result of
 * buildHistoryPipeline on the stable inputs, so streaming only recomputes the
 * live tail.
 *
 * Lives in lib/ (not the component file) so it is unit-testable.
 */

export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

export function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

export function isCompactionBoundary(message: AgentMessage): boolean {
  return message.role === "custom" && message.customType === "compaction";
}

export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

export type HistoryRenderItem =
  | { kind: "single"; idx: number }
  | {
      kind: "turn";
      userIdx: number;
      endIdx: number;
      startsCompactionTurn: boolean;
      finalAssistantIdx: number;
      visibleProcessIndices: number[];
      processBlocks: ProcessContentBlock[];
      /**
       * `processBlocks` split into consecutive groups with every subagent
       * `Agent` call hoisted into its own segment, so each subagent renders as
       * a persistent row instead of collapsing into the process card.
       */
      processSegments: ProcessSegment[];
      finalAnswerMessage: AssistantMessage | null;
      writtenFiles: WrittenFile[] | undefined;
    };

export interface HistoryPipeline {
  toolResultsMap: Map<string, ToolResultMessage>;
  lastUserIdx: number;
  visibleRefIndexByMessage: Map<number, number>;
  items: HistoryRenderItem[];
}

export function buildHistoryPipeline(
  messages: AgentMessage[],
  entryIds: string[],
  messageCwd: string | undefined,
  /**
   * In-flight tool results (bash/powershell partial output). Seeded first so a
   * completed message result — which is authoritative — always overwrites the
   * partial for the same toolCallId.
   */
  activeToolResults?: Map<string, ToolResultMessage>,
): HistoryPipeline {
  const toolResultsMap = new Map<string, ToolResultMessage>(activeToolResults);
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      toolResultsMap.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
    }
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }

  const visibleRefIndexByMessage = new Map<number, number>();
  let refIdx = 0;
  messages.forEach((msg, idx) => {
    if (msg.role === "user" || msg.role === "assistant") {
      visibleRefIndexByMessage.set(idx, refIdx++);
    }
  });

  const items: HistoryRenderItem[] = [];
  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    const startsCompactionTurn = isCompactionBoundary(msg);
    // Paging can omit a turn's user anchor, but must not change which blocks
    // are answers. The -1 sentinel suppresses only the missing user row.
    const orphanedPrefix = idx === 0 && msg.role !== "user" && !startsCompactionTurn;
    // Non-turn-starting messages render as singles (mirrors the JSX loop).
    if (msg.role !== "user" && !startsCompactionTurn && !orphanedPrefix) {
      items.push({ kind: "single", idx });
      idx += 1;
      continue;
    }

    const userIdx = orphanedPrefix ? -1 : idx;
    let endIdx = idx + 1;
    while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

    const candidateAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
    const finalAssistantIdx = orphanedPrefix && candidateAssistantIdx >= 0
      && !hasFinalAssistantAnswer(messages[candidateAssistantIdx])
      && !getAssistantErrorMessage(messages[candidateAssistantIdx] as AssistantMessage)
      ? -1
      : candidateAssistantIdx;

    if (finalAssistantIdx === -1) {
      const processIndices = Array.from({ length: endIdx - userIdx - 1 }, (_, offset) => userIdx + 1 + offset)
        .filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
      const processBlocks = collectProcessContentBlocks(messages, entryIds, processIndices, toolResultsMap);
      if (orphanedPrefix && processBlocks.length === 0) {
        for (let singleIdx = 0; singleIdx < endIdx; singleIdx += 1) {
          if (messages[singleIdx].role !== "toolResult") items.push({ kind: "single", idx: singleIdx });
        }
        idx = endIdx;
        continue;
      }
      items.push({ kind: "turn", userIdx, endIdx, startsCompactionTurn, finalAssistantIdx, visibleProcessIndices: processIndices, processBlocks, processSegments: splitProcessSegments(processBlocks), finalAnswerMessage: null, writtenFiles: undefined });
      idx = endIdx;
      continue;
    }

    const processIndices: number[] = [];
    for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
      processIndices.push(processIdx);
    }
    const visibleProcessIndices = processIndices.filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
    const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
    const finalSplit = splitFinalAssistantBlocks(finalAssistant);
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null;
    const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant)
      ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
      : null;

    let processBlocks = collectProcessContentBlocks(messages, entryIds, visibleProcessIndices, toolResultsMap);
    if (finalProcessMessage) {
      processBlocks = processBlocks.concat(splitAssistantContentBlocks(finalAssistant, {
        messageIndex: finalAssistantIdx,
        entryId: entryIds[finalAssistantIdx],
        toolResults: toolResultsMap,
      }).processBlocks);
    }

    let writtenFiles: WrittenFile[] | undefined;
    if (finalAnswerMessage) {
      // Each tool call is stored as its own assistant entry, so the final
      // answer alone carries no record of what the turn wrote. Gather the
      // turn's assistant blocks and derive the file list from the successful
      // write/edit calls among them.
      const turnContent: AssistantContentBlock[] = [];
      for (let i = userIdx + 1; i <= finalAssistantIdx; i++) {
        const m = messages[i];
        if (m?.role === "assistant") {
          for (const b of (m as AssistantMessage).content ?? []) turnContent.push(b);
        }
      }
      writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
    }

    items.push({
      kind: "turn",
      userIdx,
      endIdx,
      startsCompactionTurn,
      finalAssistantIdx,
      visibleProcessIndices,
      processBlocks,
      processSegments: splitProcessSegments(processBlocks),
      finalAnswerMessage,
      writtenFiles,
    });
    idx = endIdx;
  }

  return { toolResultsMap, lastUserIdx, visibleRefIndexByMessage, items };
}
