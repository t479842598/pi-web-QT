"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaretRight, SpinnerGap } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentStatus } from "@/lib/types";
import type { SubagentTranscriptLine } from "@/lib/subagent-transcript";

interface Props {
  agent: SubagentStatus;
  cwd?: string;
  /** Called when the card is clicked — AppShell switches to the fullscreen subagent view. */
  onOpen?: (agentId: string) => void;
}

const STATUS_COLORS: Record<SubagentStatus["status"], string> = {
  running: "var(--accent)",
  completed: "#22c55e",
  failed: "#ef4444",
  stopped: "#d97706",
};

/** Compact token count: "12.3k" / "1.2M" / "980". */
function formatTokens(count: number | undefined): string {
  if (count === undefined) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

/** Duration from ms → "3.2s" / "1m 5s". */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "…";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * Inline subagent card rendered in the main conversation stream where the
 * model invoked the Agent/Task tool. Shows a spinner + "processing" title
 * while running, the latest transcript line as a live preview, and opens the
 * fullscreen SubagentDetail view on click.
 */
export function SubagentCard({ agent, cwd, onOpen }: Props) {
  const { t } = useI18n();
  const roleLabel = (role: SubagentTranscriptLine["role"] | undefined): string | undefined => {
    if (!role) return undefined;
    const key = role === "user" ? "desktop.transcriptRoleUser"
      : role === "assistant" ? "desktop.transcriptRoleAssistant"
        : role === "toolResult" ? "desktop.transcriptRoleResult"
          : "desktop.transcriptRoleBash";
    return t(key);
  };
  const [hovered, setHovered] = useState(false);
  // Live elapsed tick for running rows (re-renders this row every second).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (agent.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [agent.status]);

  // Latest transcript line — polled while running, fetched once when finished.
  const [latest, setLatest] = useState<SubagentTranscriptLine | null>(null);
  const loadLatest = useCallback(async () => {
    if (!agent.id || !cwd) return;
    try {
      const params = new URLSearchParams({ id: agent.id, cwd });
      const res = await fetch(`/api/subagents/transcript?${params}`);
      if (!res.ok) return;
      const data = await res.json() as { lines?: SubagentTranscriptLine[] };
      const lines = data.lines ?? [];
      if (lines.length > 0) setLatest(lines[lines.length - 1]);
    } catch {
      // Ignore transient errors — the preview is best-effort.
    }
  }, [agent.id, cwd]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // Fetch once more when the run transitions to a terminal state: the last
  // 2s poll may have run just before the final assistant output landed.
  const statusRef = useRef(agent.status);
  useEffect(() => {
    const wasRunning = statusRef.current === "running";
    statusRef.current = agent.status;
    if (wasRunning && agent.status !== "running") void loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.status]);

  useEffect(() => {
    if (agent.status !== "running") return;
    const timer = setInterval(() => void loadLatest(), 2000);
    return () => clearInterval(timer);
  }, [agent.status, loadLatest]);

  const color = STATUS_COLORS[agent.status];
  const running = agent.status === "running";
  const duration = running ? now - agent.startedAt : agent.completedAt ? agent.completedAt - agent.startedAt : undefined;
  const tokens = agent.tokens?.total ?? agent.tokens?.input ?? agent.tokens?.output;
  const statusLabel = running
    ? t("desktop.subagentCardProcessing")
    : t(`desktop.subagentsStatus${agent.status === "completed" ? "Completed" : agent.status === "failed" ? "Failed" : "Stopped"}`);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(agent.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={agent.error || `${agent.agentType} · ${agent.description}`}
      style={{
        display: "block",
        width: "100%",
        minWidth: 0,
        textAlign: "left",
        margin: "6px 0",
        padding: 0,
        border: `1px solid ${hovered ? "color-mix(in srgb, var(--accent) 55%, var(--border))" : "var(--border)"}`,
        borderRadius: 8,
        background: "var(--bg-panel)",
        color: "var(--text)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: hovered ? "0 2px 10px rgba(0,0,0,0.18)" : "none",
      }}
    >
      {/* Header: spinner + processing title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>
        {running ? (
          <span
            aria-hidden="true"
            style={{ flexShrink: 0, display: "inline-flex", width: 13, height: 13, borderRadius: "50%", border: "2px solid color-mix(in srgb, var(--accent) 25%, transparent)", borderTopColor: "var(--accent)", animation: "spin 0.8s linear infinite" }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: color }}
          />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: running ? "var(--text)" : "var(--text-muted)" }}>
          {statusLabel}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", textAlign: "right" }}>
          {agent.agentType}
        </span>
        <CaretRight size={11} style={{ flexShrink: 0, color: hovered ? "var(--text)" : "var(--text-dim)", transition: "color 0.15s, transform 0.15s", transform: hovered ? "translateX(1px)" : "none" }} aria-hidden="true" />
      </div>

      {/* Description */}
      {agent.description && (
        <div style={{ padding: "6px 10px 0", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agent.description}
        </div>
      )}

      {/* Latest transcript line preview */}
      {latest && (
        <div style={{ padding: "3px 10px 0", display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
          {latest.role && roleLabel(latest.role) && (
            <span style={{ flexShrink: 0, fontSize: 9.5, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent)", marginTop: 1 }}>
              [{roleLabel(latest.role)}]
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.45, color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>
            {latest.text}
          </span>
        </div>
      )}

      {/* Footer: elapsed / tokens */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px 7px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <SpinnerGap size={9} weight="bold" style={{ animation: running ? "spin 1.2s linear infinite" : "none", color: running ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true" />
          {formatDuration(duration)}
        </span>
        {tokens !== undefined && tokens > 0 && <span>{formatTokens(tokens)}t</span>}
      </div>
    </button>
  );
}
