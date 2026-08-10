"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentStatus } from "@/lib/types";
import type { SubagentTranscriptLine, SubagentTranscriptRole } from "@/lib/subagent-transcript";

interface Props {
  agent: SubagentStatus;
  cwd?: string;
  onBack: () => void;
}

const ROLE_COLORS: Record<SubagentTranscriptRole, { label: string; color: string }> = {
  user: { label: "User", color: "var(--accent)" },
  assistant: { label: "Assistant", color: "var(--text)" },
  toolResult: { label: "Result", color: "var(--text-dim)" },
  bashExecution: { label: "Bash", color: "var(--text-muted)" },
};

/** Compact token count: "12.3k" / "1.2M" / "980". */
function formatTokens(count: number | undefined): string {
  if (count === undefined) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function TranscriptLine({ line }: { line: SubagentTranscriptLine }) {
  const meta = ROLE_COLORS[line.role] ?? ROLE_COLORS.toolResult;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: meta.color, marginBottom: 2, fontFamily: "var(--font-mono)" }}>
        [{meta.label}]
      </div>
      <pre style={{
        margin: 0,
        fontSize: 11.5,
        lineHeight: 1.55,
        color: "var(--text-muted)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "var(--font-mono)",
        maxHeight: 240,
        overflowY: "auto",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 8px",
      }}>
        {line.text}
      </pre>
    </div>
  );
}

/**
 * Read-only conversation view for a single subagent — mirrors ZCode's
 * conversation viewer: live-updating transcript, no input affordance.
 * Polls the .output transcript file while the agent is running.
 */
export function SubagentDetail({ agent, cwd, onBack }: Props) {
  const { t } = useI18n();
  const [lines, setLines] = useState<SubagentTranscriptLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!agent.id || !cwd) return;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ id: agent.id, cwd });
      const res = await fetch(`/api/subagents/transcript?${params}`);
      const data = await res.json() as { lines?: SubagentTranscriptLine[]; error?: string };
      if (!res.ok || data.error) {
        if (!silent) setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setLines(data.lines ?? []);
      setError(null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agent.id, cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live polling while running — the .output file appends per turn_end.
  useEffect(() => {
    if (agent.status !== "running") return;
    const timer = setInterval(() => void load(true), 2000);
    return () => clearInterval(timer);
  }, [agent.status, load]);

  // Auto-scroll to bottom on new lines unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const duration = agent.completedAt ? agent.completedAt - agent.startedAt : undefined;
  const tokens = agent.tokens?.total ?? agent.tokens?.input ?? agent.tokens?.output;
  const statusColor = agent.status === "completed" ? "#22c55e"
    : agent.status === "failed" ? "#ef4444"
      : agent.status === "stopped" ? "#d97706"
        : "var(--accent)";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", padding: "6px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onBack}
            title={t("desktop.subagentsBack")}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "3px 6px", border: "none", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <CaretLeft size={12} aria-hidden="true" />
            {t("desktop.subagentsBack")}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
          <span aria-hidden="true" style={{
            width: 8, height: 8, flexShrink: 0, borderRadius: "50%",
            background: statusColor,
            boxShadow: agent.status === "running" ? `0 0 0 0 ${statusColor}` : "none",
            animation: agent.status === "running" ? "subagent-pulse 1.4s ease-out infinite" : "none",
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {agent.agentType}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: "var(--text-muted)" }}>
            {agent.description}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
          {agent.toolUses !== undefined && agent.toolUses > 0 && <span>{agent.toolUses} tool{agent.toolUses === 1 ? "" : "s"}</span>}
          {tokens !== undefined && tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}
          {duration !== undefined && <span>{formatDuration(duration)}</span>}
          <span style={{ color: statusColor }}>{t(`desktop.subagentsStatus${agent.status === "running" ? "Running" : agent.status === "completed" ? "Completed" : agent.status === "failed" ? "Failed" : "Stopped"}`)}</span>
        </div>
      </div>

      {/* Transcript body */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "8px 10px", background: "var(--bg)" }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 4px" }}>{t("desktop.loading")}…</div>
        ) : error ? (
          <div style={{ fontSize: 12, color: "#ef4444", padding: "12px 4px" }}>{error}</div>
        ) : lines.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 4px" }}>
            {agent.status === "running" ? t("desktop.subagentsWaitingFirstMessage") : t("desktop.subagentsNoTranscript")}
          </div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            {lines.map((line, i) => <TranscriptLine key={i} line={line} />)}
          </div>
        )}
      </div>
    </div>
  );
}
