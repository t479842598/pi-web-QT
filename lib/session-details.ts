import type { AgentUsage, SessionEntry } from "./types";
import type { SessionFileStats } from "./session-stats";

export function computeSessionDetails(entries: readonly SessionEntry[]): {
  stats: SessionFileStats;
  totalActiveMs: number;
} {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  let totalMessages = 0;
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;

  const addUsage = (usage?: AgentUsage) => {
    if (!usage) return;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  };

  for (const entry of entries) {
    if (entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "custom_message") {
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp)) {
        const role = entry.type === "message" ? entry.message.role : undefined;
        if (role === "user" || role === "bashExecution") previousTimestamp = timestamp;
        else {
          if (previousTimestamp !== undefined && timestamp > previousTimestamp) totalActiveMs += timestamp - previousTimestamp;
          previousTimestamp = timestamp;
        }
      }
    }

    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(entry.usage);
      continue;
    }
    if (entry.type !== "message") continue;
    totalMessages += 1;
    const message = entry.message;
    if (message.role === "user") userMessages += 1;
    else if (message.role === "toolResult") {
      toolResults += 1;
      addUsage(message.usage);
    } else if (message.role === "assistant") {
      assistantMessages += 1;
      const content = message.content;
      toolCalls += Array.isArray(content) ? content.filter((block) => block.type === "toolCall").length : 0;
      addUsage(message.usage);
    }
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    stats: { userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens, cost },
    totalActiveMs,
  };
}
