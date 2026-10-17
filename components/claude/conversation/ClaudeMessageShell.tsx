"use client";

import { memo, useMemo, type ReactNode } from "react";

import type { AgentMessage, ToolResultMessage } from "@/lib/types";

/**
 * CDS message shell.
 *
 * The `messageShell` slot contract is `ComponentProps<typeof MessageView>`, so
 * this has to accept the whole surface and render something useful for all four
 * roles. That said, the *content* pipeline is not reimplemented here: text,
 * tool-call and tool-result bodies are delegated to `MessageView` itself via
 * `contentRenderer`, and this component owns only the frame — bubble geometry,
 * author rhythm, and the action affordances attached to a user turn.
 *
 * Why delegate the body: MarkdownBody carries the KaTeX/Mermaid/Shiki stack and
 * MessageView carries the block-state machine (thinking durations, paired diff
 * results, streaming tails). Rewriting either would be a rendering regression
 * with no design payoff — the kit difference lives in the frame, not the parser.
 */

export interface ClaudeMessageShellProps {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  entryId?: string;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  /** Supplied by the caller: renders the message body using the shared pipeline. */
  contentRenderer?: (message: AgentMessage) => ReactNode;
  actions?: ReactNode;
}

function relative(ts?: number): string | null {
  if (!ts) return null;
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

/**
 * Plain rendering of a message body when no `contentRenderer` is supplied.
 *
 * Deliberately not a Markdown pipeline: `MarkdownBody` carries the KaTeX/Mermaid
 * stack and belongs to the caller. This keeps the text visible — a user turn with
 * no text is worse than a user turn without pretty code blocks.
 */
function FallbackMessageBody({ message }: { message: AgentMessage }) {
  const text = (() => {
    // `AgentMessage` is a union and not every member carries `content`.
    if (!("content" in message)) return "";
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  })();

  if (!text) return null;
  return (
    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</span>
  );
}

function ClaudeMessageShellInner({
  message,
  isStreaming,
  showTimestamp,
  prevTimestamp,
  contentRenderer,
  actions,
  entryId,
}: ClaudeMessageShellProps) {
  const role = message.role;
  const isUser = role === "user";
  // The slot is typed on `ComponentProps<typeof MessageView>`, which has no
  // `contentRenderer` — so nothing ever supplies one and the body came out null.
  // That is why the Claude transcript rendered tool rows with no user turns.
  // Fall back to reading the message content directly; the caller's renderer
  // still wins when someone does pass one.
  const body = contentRenderer ? contentRenderer(message) : <FallbackMessageBody message={message} />;

  const stamp = useMemo(() => {
    if (!showTimestamp) return null;
    const ts = (message as { timestamp?: number }).timestamp;
    // Only show a stamp when this turn is meaningfully after the previous one,
    // matching the pi behaviour of collapsing bursts of messages.
    if (typeof ts === "number" && typeof prevTimestamp === "number" && ts - prevTimestamp < 60_000) {
      return null;
    }
    return relative(ts);
  }, [message, prevTimestamp, showTimestamp]);

  if (role === "toolResult") {
    // A bare tool result renders nothing in the pi tree either (its content is
    // shown inside the owning ProcessGroup step), so keep that contract.
    return null;
  }

  return (
    <article
      data-entry-id={entryId}
      data-role={role}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginInline: isUser ? "0" : "0",
        paddingBlock: 6,
      }}
    >
      {stamp && (
        <div
          style={{
            fontSize: "var(--text-ui-xs)",
            color: "var(--cds-text-faint, var(--text-dim))",
            textAlign: "center",
            letterSpacing: "0.02em",
          }}
        >
          {stamp}
        </div>
      )}

      {isUser ? (
        <div
          style={{
            alignSelf: "flex-end",
            maxWidth: "min(78%, 720px)",
            padding: "10px 14px",
            borderRadius: "var(--cds-radius-bubble, 18px)",
            background: "var(--user-bg, var(--bg-selected))",
            color: "var(--cds-text-primary, var(--text))",
            fontSize: "var(--chat-content-font-size, 14px)",
            lineHeight: 1.6,
            overflowWrap: "anywhere",
          }}
        >
          {body}
        </div>
      ) : (
        <div
          style={{
            alignSelf: "stretch",
            paddingInline: 2,
            fontSize: "var(--chat-content-font-size, 14px)",
            lineHeight: 1.65,
            color: "var(--cds-text-primary, var(--text))",
            opacity: isStreaming ? 1 : undefined,
          }}
        >
          {body}
        </div>
      )}

      {actions && (
        <div
          style={{
            display: "flex",
            gap: 4,
            justifyContent: isUser ? "flex-end" : "flex-start",
            opacity: 0.75,
          }}
        >
          {actions}
        </div>
      )}
    </article>
  );
}

export const ClaudeMessageShell = memo(ClaudeMessageShellInner);
