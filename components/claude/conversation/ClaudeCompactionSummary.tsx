"use client";

/**
 * CDS compaction summary card.
 *
 * Contract: `ComponentProps<typeof CompactionSummary>`. A compaction is a marker
 * in the transcript ("everything above was summarised"), so it reads as a ruled
 * divider with a capsule label rather than a message.
 */

export interface ClaudeCompactionSummaryProps {
  summary?: string;
  tokensBefore?: number;
  timestamp?: number;
  onOpenFull?: () => void;
}

function formatTokens(value?: number): string | null {
  if (!value || !Number.isFinite(value)) return null;
  if (value < 1000) return `${value} tokens`;
  return `${(value / 1000).toFixed(1)}k tokens`;
}

export function ClaudeCompactionSummary({ summary, tokensBefore, onOpenFull }: ClaudeCompactionSummaryProps) {
  const tokens = formatTokens(tokensBefore);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBlock: 14 }}>
      <span
        aria-hidden="true"
        style={{ flex: 1, height: 0.5, background: "var(--cds-hairline-1, var(--border))" }}
      />
      <button
        type="button"
        onClick={onOpenFull}
        title={summary}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 999,
          border: "0.5px solid var(--cds-hairline-1, var(--border))",
          background: "var(--cds-fill-secondary, var(--bg-hover))",
          color: "var(--cds-text-muted, var(--text-muted))",
          fontSize: "var(--text-ui-xs)",
          cursor: onOpenFull ? "pointer" : "default",
          whiteSpace: "nowrap",
        }}
      >
        Conversation compacted
        {tokens && <span style={{ color: "var(--cds-text-faint, var(--text-dim))" }}>· {tokens}</span>}
      </button>
      <span
        aria-hidden="true"
        style={{ flex: 1, height: 0.5, background: "var(--cds-hairline-1, var(--border))" }}
      />
    </div>
  );
}
