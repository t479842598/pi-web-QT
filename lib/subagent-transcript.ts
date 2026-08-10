/**
 * subagent-transcript.ts — Read a subagent's streaming .output transcript.
 *
 * pi-subagents writes each subagent's conversation turns to a JSONL file
 * (Claude Code's task output format) at:
 *
 *   /tmp/pi-subagents-{uid}/{encoded-cwd}/{parentSessionId}/tasks/{agentId}.output
 *
 * Every line is one of:
 *   { "type":"user",       "message": {...AgentMessage}, ... }
 *   { "type":"assistant",  "message": {...AgentMessage}, ... }
 *   { "type":"toolResult", "message": {...AgentMessage}, ... }
 *
 * We re-shape these into lightweight chat lines for a read-only
 * "conversation view" in the pi-web right panel.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export type SubagentTranscriptRole = "user" | "assistant" | "toolResult" | "bashExecution";

export interface SubagentTranscriptLine {
  role: SubagentTranscriptRole;
  /** Plain-text summary of the message (text, tool call name, command, etc.). */
  text: string;
  /** Raw message object when the line is expandable. */
  message?: Record<string, unknown>;
}

/** Encode a cwd path as a filesystem-safe directory name (mirrors pi-subagents). */
export function encodeCwd(cwd: string): string {
  return cwd
    .replace(/[/\\]/g, "-")
    .replace(/^[A-Za-z]:-/, "")
    .replace(/^-+/, "");
}

/**
 * Resolve the expected transcript path for a subagent.
 * Falls back gracefully: when the session id is unknown, probe the
 * per-cwd tasks dir for a file named `${agentId}.output`.
 */
export function resolveTranscriptPath(
  cwd: string,
  agentId: string,
  parentSessionId?: string,
  rootOverride?: string,
): string | null {
  const encoded = encodeCwd(cwd);
  const root = rootOverride ?? join(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
  const candidates: string[] = [];
  if (parentSessionId) {
    candidates.push(join(root, encoded, parentSessionId, "tasks", `${agentId}.output`));
  }
  candidates.push(join(root, encoded, "tasks", `${agentId}.output`));
  // Probe any {sessionId}/tasks/{agentId}.output under the encoded cwd.
  try {
    const cwdDir = join(root, encoded);
    if (existsSync(cwdDir)) {
      for (const sessionDir of readdirSync(cwdDir)) {
        const candidate = join(cwdDir, sessionDir, "tasks", `${agentId}.output`);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // Ignore probing errors — fall through to the explicit candidates.
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Extract plain text from an AgentMessage content (string or content blocks). */
function messageText(message: Record<string, unknown> | undefined): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") parts.push(b.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/** Render one transcript line into a lightweight { role, text } record. */
export function lineFromEntry(entry: Record<string, unknown>): SubagentTranscriptLine | null {
  const type = typeof entry.type === "string" ? entry.type : "";
  const message = (typeof entry.message === "object" && entry.message !== null
    ? entry.message as Record<string, unknown>
    : undefined);

  switch (type) {
    case "user": {
      const text = messageText(message);
      return text.trim() ? { role: "user", text, message } : null;
    }
    case "assistant": {
      const textParts: string[] = [];
      const toolCalls: string[] = [];
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "string") {
            textParts.push(block);
          } else if (block && typeof block === "object") {
            const b = block as Record<string, unknown>;
            if (typeof b.text === "string" && b.text) textParts.push(b.text);
            else if (b.type === "toolCall") {
              const name = typeof b.name === "string" ? b.name
                : typeof b.toolName === "string" ? b.toolName
                  : "tool";
              toolCalls.push(name);
            }
          }
        }
      }
      const lines: string[] = [];
      if (textParts.length > 0) lines.push(textParts.join("\n").trim());
      for (const name of toolCalls) lines.push(`[Tool: ${name}]`);
      const text = lines.join("\n");
      return text.trim() ? { role: "assistant", text, message } : null;
    }
    case "toolResult": {
      const text = messageText(message);
      const truncated = text.length > 600 ? `${text.slice(0, 600)}… (truncated)` : text;
      return truncated.trim() ? { role: "toolResult", text: truncated, message } : null;
    }
    default:
      return null;
  }
}

/**
 * Read the transcript file and return parsed lines (newest appended last).
 * Returns an empty array when the file is missing or unreadable.
 */
export function readSubagentTranscript(path: string, limit = 400): SubagentTranscriptLine[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const lines: SubagentTranscriptLine[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const parsed = lineFromEntry(entry);
        if (parsed) lines.push(parsed);
      } catch {
        // Skip malformed lines (partial writes while streaming).
      }
      if (lines.length >= limit) break;
    }
    return lines;
  } catch {
    return [];
  }
}
