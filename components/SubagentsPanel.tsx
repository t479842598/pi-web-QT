"use client";

import { useEffect, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentStatus } from "@/lib/types";

interface Props {
  subagents: SubagentStatus[];
  /** Called when a subagent row is clicked (open its detail view). */
  onSelect?: (agent: SubagentStatus) => void;
  selectedId?: string | null;
}

const STATUS_COLORS: Record<SubagentStatus["status"], string> = {
  running: "var(--accent)",
  completed: "#22c55e",
  failed: "#ef4444",
  stopped: "#d97706",
};

const STATUS_LABEL_KEY: Record<SubagentStatus["status"], string> = {
  running: "desktop.subagentsStatusRunning",
  completed: "desktop.subagentsStatusCompleted",
  failed: "desktop.subagentsStatusFailed",
  stopped: "desktop.subagentsStatusStopped",
};

/** Compact token count: "12.3k" / "1.2M" / "980". */
function formatTokens(count: number | undefined): string {
  if (count === undefined) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

/** Duration from ms → "3.2s" / "1m 5s"; running agents show live elapsed via 1s tick. */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "…";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function SubagentRow({ agent, selected, onSelect }: {
  agent: SubagentStatus;
  selected: boolean;
  onSelect?: (agent: SubagentStatus) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { t } = useI18n();
  // Live elapsed tick for running rows (re-renders this row every second).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (agent.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [agent.status]);
  const duration = agent.completedAt ? agent.completedAt - agent.startedAt : now - agent.startedAt;
  const tokens = agent.tokens?.total ?? agent.tokens?.input ?? agent.tokens?.output;
  const color = STATUS_COLORS[agent.status];

  return (
    <button
      type="button"
      onClick={() => onSelect?.(agent)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={agent.error || `${agent.agentType} · ${agent.description}`}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        border: "none",
        borderRadius: 5,
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: "50%",
          background: color,
          boxShadow: agent.status === "running" ? `0 0 0 0 ${color}` : "none",
          animation: agent.status === "running" ? "subagent-pulse 1.4s ease-out infinite" : "none",
        }}
      />
      <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-dim)" }}>
        {agent.agentType}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: "var(--text-muted)" }}>
        {agent.description || t("desktop.subagentsNoDesc")}
      </span>
      {tokens !== undefined && tokens > 0 && (
        <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
          {formatTokens(tokens)}t
        </span>
      )}
      <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
        {formatDuration(duration)}
      </span>
      <span style={{ flexShrink: 0, fontSize: 10, color: color }}>{t(STATUS_LABEL_KEY[agent.status])}</span>
    </button>
  );
}

/**
 * Subagent fleet list for the right panel — mirrors ZCode's widget rows:
 * status dot + type + description + tokens + elapsed + status label.
 * Clicking a row opens SubagentDetail (read-only conversation view).
 */
export function SubagentsPanel({ subagents, onSelect, selectedId }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const running = subagents.filter((s) => s.status === "running").length;

  if (subagents.length === 0) {
    return (
      <div style={{ padding: "18px 14px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
        {t("desktop.subagentsEmpty")}
      </div>
    );
  }

  return (
    <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left" }}
        >
          <CaretRight size={9} weight="regular" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("desktop.subagentsPanelTitle")}</span>
        </button>
        {running > 0 && (
          <span style={{ marginRight: 4, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
            ● {running} {t("desktop.subagentsStatusRunning")}
          </span>
        )}
      </div>
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 0 8px" }}>
          {subagents.map((agent) => (
            <SubagentRow key={agent.id} agent={agent} selected={agent.id === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}
