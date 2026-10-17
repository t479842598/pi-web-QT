"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * CDS thinking accordion.
 *
 * Contract: `ComponentProps<typeof ThinkingBlock>`. The pi version already
 * solved the hard part — while a run is streaming the block must stay open and
 * ignore clicks, because collapsing it mid-stream hides the token tail the
 * reader is watching. That behaviour is preserved here exactly:
 * `openChangeLocked = isStreaming`.
 *
 * What changes is the motion and the frame: a `grid-template-rows: 0fr → 1fr`
 * expansion (no measured height, so it works for both a two-line thought and a
 * 400-line one) plus the clay-tinted reasoning glow the Claude client uses while
 * tokens are still arriving.
 */

export interface ClaudeThinkingProps {
  /** Text of the thought, or a node when the caller pre-renders it. */
  block?: { thinking?: string } | string;
  duration?: number;
  isStreaming?: boolean;
  contentOnly?: boolean;
  className?: string;
  /** Pre-rendered body; takes precedence over `block`. */
  children?: ReactNode;
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function ClaudeThinking({
  block,
  duration,
  isStreaming = false,
  contentOnly = false,
  className,
  children,
}: ClaudeThinkingProps) {
  const text = typeof block === "string" ? block : block?.thinking ?? "";
  // A streamed thought is forced open and cannot be closed by the reader: the
  // tail keeps arriving and a collapsed box would hide it.
  const [open, setOpen] = useState(true);
  const lockRef = useRef(isStreaming);

  useEffect(() => {
    lockRef.current = isStreaming;
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  const toggle = () => {
    if (lockRef.current) return;
    setOpen((value) => !value);
  };

  const label = isStreaming ? "Thinking" : "Thought";
  const time = formatDuration(duration);

  if (contentOnly) {
    return (
      <div
        className={className}
        style={{ fontSize: "var(--text-ui-base)", lineHeight: 1.7, color: "var(--cds-text-secondary, var(--text-muted))" }}
      >
        {children ?? text}
      </div>
    );
  }

  return (
    <div
      className={className}
      data-thinking
      style={{
        position: "relative",
        marginBlock: 6,
        borderRadius: "var(--cds-radius-card, 12px)",
        background: isStreaming ? "var(--cds-clay-soft, transparent)" : "transparent",
        transition: "background 240ms var(--cds-ease-swift, ease)",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={label}
        disabled={isStreaming}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "4px 2px",
          border: "none",
          background: "none",
          color: "var(--cds-text-muted, var(--text-muted))",
          fontSize: "var(--text-ui-sm)",
          cursor: isStreaming ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: isStreaming ? "var(--cds-clay, var(--accent))" : "var(--cds-hairline-3, var(--border))",
            animation: isStreaming ? "tab-breathe 1.8s ease-in-out infinite" : undefined,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 500 }}>{label}</span>
        {time && <span style={{ color: "var(--cds-text-faint, var(--text-dim))" }}>{time}</span>}
        {!isStreaming && (
          <span
            aria-hidden="true"
            style={{
              marginLeft: "auto",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 160ms var(--cds-ease-swift, ease)",
              fontSize: "var(--text-ui-xs)",
            }}
          >
            ›
          </span>
        )}
      </button>

      {/* Grid-rows expansion: `0fr → 1fr` animates to the content's real height
          without measuring it, and collapses cleanly for very long thoughts. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms var(--cds-ease-expand, ease), opacity 160ms ease",
          opacity: open ? 1 : 0,
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              paddingInline: 14,
              paddingBlock: open ? 8 : 0,
              borderLeft: "2px solid var(--cds-hairline-1, var(--border))",
              marginLeft: 2,
              fontSize: "var(--text-ui-base)",
              lineHeight: 1.7,
              color: "var(--cds-text-secondary, var(--text-muted))",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {children ?? text}
          </div>
        </div>
      </div>
    </div>
  );
}
