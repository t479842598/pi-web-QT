"use client";

import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { sessionDisplayTitle } from "@/lib/session-display-title";

/**
 * CDS subagent board.
 *
 * Contract: `ComponentProps<typeof AgentSessionPanel>` — five props, all data in
 * and one callback out. The pi version is a flat `role="listbox"` of rows; this
 * is a two-column board of cards, because the question a reader has about
 * subagents is "which of these is still working / which failed", and a grid with
 * status dots answers it without reading every line.
 *
 * Kept from pi: `sessionDisplayTitle` for naming, the six `SubagentSessionStatus`
 * values and their colours, `runningSessionIds` as the authoritative liveness
 * signal, and the `role="option"`/`aria-selected` semantics so keyboard users
 * keep the same contract.
 */

export interface ClaudeSubagentPanelProps {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}

function tone(status: SubagentSessionStatus | undefined): string {
  switch (status) {
    case "running":
    case "starting":
      return "var(--accent)";
    case "queued":
      return "var(--text-dim)";
    case "completed":
      return "var(--status-success)";
    case "failed":
      return "var(--status-error)";
    case "aborted":
      return "var(--status-warning)";
    default:
      return "var(--text-dim)";
  }
}

export function ClaudeSubagentPanel({
  subagents,
  selectedSessionId,
  runningSessionIds,
  onSelectSession,
}: ClaudeSubagentPanelProps) {
  if (subagents.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="Subagents"
        style={{
          padding: "18px 14px",
          fontSize: "var(--text-ui-sm)",
          color: "var(--cds-text-muted, var(--text-muted))",
          textAlign: "center",
        }}
      >
        No subagents for this session yet.
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Subagents"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
        gap: 8,
        padding: 10,
        alignContent: "start",
        overflowY: "auto",
        minHeight: 0,
      }}
    >
      {subagents.map((session) => {
        const selected = session.id === selectedSessionId;
        const live = runningSessionIds.has(session.id);
        const status = (session as { subagentStatus?: SubagentSessionStatus }).subagentStatus;
        const color = live ? "var(--accent)" : tone(status);
        return (
          <button
            key={session.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelectSession(session)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
              padding: "9px 11px",
              textAlign: "left",
              borderRadius: "var(--cds-radius-card, 12px)",
              border: selected
                ? "1px solid var(--cds-clay, var(--accent))"
                : "0.5px solid var(--cds-hairline-1, var(--border))",
              background: selected
                ? "var(--cds-fill-secondary, var(--bg-selected))"
                : "var(--cds-surface-1, var(--bg-panel))",
              cursor: "pointer",
              transition: "border-color 120ms var(--cds-ease-swift, ease), background 120ms ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                  animation: live ? "tab-breathe 1.8s ease-in-out infinite" : undefined,
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
                {sessionDisplayTitle(session)}
              </span>
            </div>
            <div
              style={{
                fontSize: "var(--text-ui-xs)",
                color: "var(--cds-text-muted, var(--text-muted))",
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span>{status ?? (live ? "running" : "completed")}</span>
              {session.modified ? (
                <span style={{ color: "var(--cds-text-faint, var(--text-dim))" }}>
                  · {new Date(session.modified).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
