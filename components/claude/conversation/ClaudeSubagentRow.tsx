"use client";

/**
 * CDS subagent run card.
 *
 * Contract: `ComponentProps<typeof SubagentRunRow>`. The pi version is a single
 * line ("robot · label · status · duration"); this is a card, because a subagent
 * is a *delegated run* the reader may want to inspect rather than a step in a
 * tool sequence. Same data, same `onOpenSubagent` callback.
 */

export interface ClaudeSubagentRowProps {
  run: {
    toolCallId: string;
    label?: string;
    description?: string;
    prompt?: string;
    status?: string;
    startedAt?: string;
    completedAt?: string;
    model?: string;
    tokens?: number;
  };
  onOpenSubagent?: (sessionId: string, label: string) => void;
  sessionRun?: { status?: string; createdAt?: string; completedAt?: string };
}

function tone(status?: string): { color: string; text: string } {
  switch (status) {
    case "running":
    case "starting":
      return { color: "var(--accent)", text: "running" };
    case "queued":
      return { color: "var(--text-dim)", text: "queued" };
    case "completed":
      return { color: "var(--status-success)", text: "completed" };
    case "failed":
      return { color: "var(--status-error)", text: "failed" };
    case "aborted":
      return { color: "var(--status-warning)", text: "aborted" };
    default:
      return { color: "var(--text-dim)", text: status ?? "unknown" };
  }
}

function duration(run: { startedAt?: string; completedAt?: string }): string | null {
  if (!run.startedAt) return null;
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ClaudeSubagentRow({ run, onOpenSubagent, sessionRun }: ClaudeSubagentRowProps) {
  const status = sessionRun?.status ?? run.status;
  const state = tone(status);
  const elapsed = duration({
    startedAt: run.startedAt ?? sessionRun?.createdAt,
    completedAt: run.completedAt ?? sessionRun?.completedAt,
  });
  const label = run.label ?? run.description ?? "Subagent";
  const running = status === "running" || status === "starting";

  return (
    <button
      type="button"
      onClick={() => onOpenSubagent?.(run.toolCallId, label)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        marginBlock: 6,
        padding: "10px 12px",
        borderRadius: "var(--cds-radius-card, 12px)",
        border: "0.5px solid var(--cds-hairline-1, var(--border))",
        background: "var(--cds-surface-1, var(--bg-panel))",
        cursor: onOpenSubagent ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: state.color,
            animation: running ? "tab-breathe 1.8s ease-in-out infinite" : undefined,
          }}
        />
        <span
          style={{
            fontSize: "var(--text-ui-caption)",
            fontWeight: 600,
            color: "var(--cds-text-primary, var(--text))",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "var(--text-ui-xs)",
            color: "var(--cds-text-muted, var(--text-muted))",
            flexShrink: 0,
          }}
        >
          {state.text}
          {elapsed ? ` · ${elapsed}` : ""}
        </span>
      </div>
      {run.prompt && (
        <div
          style={{
            marginTop: 5,
            fontSize: "var(--text-ui-sm)",
            lineHeight: 1.55,
            color: "var(--cds-text-muted, var(--text-muted))",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {run.prompt}
        </div>
      )}
    </button>
  );
}
