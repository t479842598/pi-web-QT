"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isSubagentToolDetails, type SubagentToolDetails } from "@/lib/subagent-tool-details";
import { resolveSubagentDuration } from "@/lib/subagent-run-display";
import { Robot } from "@phosphor-icons/react";
import type { SubagentRunEntry } from "@/lib/process-content";
import type { SubagentSessionStatus } from "@/lib/types";

/** A run's own status and start/finish times, as exposed on the session list. */
export interface SubagentRunTimes {
  status?: SubagentSessionStatus;
  createdAt?: string;
  completedAt?: string;
}

interface Props {
  run: SubagentRunEntry;
  /** Open this subagent's transcript in the right-hand panel. */
  onOpenSubagent?: (sessionId: string, label: string) => void;
  /**
   * Authoritative run record from the subagent's own session (`/api/sessions`).
   * The parent's tool result keeps `running` with no `completedAt` after a
   * background run, so this wins when present.
   */
  sessionRun?: SubagentRunTimes;
}

function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "queued") return "var(--text-dim)";
  if (status === "completed") return "var(--status-success)";
  if (status === "failed") return "var(--status-error)";
  if (status === "aborted") return "var(--status-warning)";
  return "var(--text-dim)";
}

function statusLabelKey(status: SubagentSessionStatus): string {
  switch (status) {
    case "starting":
      return "agentSwitcher.status.starting";
    case "queued":
      return "agentSwitcher.status.queued";
    case "running":
      return "agentSwitcher.status.running";
    case "failed":
      return "agentSwitcher.status.failed";
    case "aborted":
      return "agentSwitcher.status.aborted";
    case "interrupted":
      return "agentSwitcher.status.interrupted";
    default:
      return "agentSwitcher.status.completed";
  }
}

function avatar(status: SubagentSessionStatus, spin: boolean) {
  if (spin) {
    return (
      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return <Robot size={15} weight="regular" color={statusColor(status)} aria-hidden="true" />;
}

/**
 * One subagent run, rendered as a persistent row in the conversation instead
 * of collapsing into the turn's process card. Clicking opens the right-panel
 * transcript tab so the parent conversation keeps its context.
 */
export function SubagentRunRow({ run, onOpenSubagent, sessionRun }: Props) {
  const { t } = useI18n();
  const details: SubagentToolDetails | null = isSubagentToolDetails(run.result?.details) ? run.result.details : null;
  const profile = details?.profile
    ?? (typeof run.input.subagent_type === "string" ? run.input.subagent_type : "Agent");
  const description = details?.description
    ?? (typeof run.input.description === "string" ? run.input.description : "");
  const title = description || profile;
  const sessionId = details?.sessionId ?? null;
  const canOpen = Boolean(sessionId && onOpenSubagent);

  // Status resolution, cheapest first: an explicit run record from the session
  // list, then one lookup of the subagent's own session, then the tool result.
  const [fetchedRun, setFetchedRun] = useState<SubagentRunTimes | null>(null);
  const detailStatus: SubagentSessionStatus = details?.status
    ?? (run.status === "running" ? "running" : run.status === "error" ? "failed" : "completed");
  const status = sessionRun?.status ?? fetchedRun?.status ?? detailStatus;
  const running = status === "running" || status === "starting";

  // Only a row that still looks live needs the extra lookup: a terminal tool
  // result is already authoritative, and a background run's parent result
  // stays "running" forever, which is exactly the case worth resolving. Without
  // this gate every historical row fired its own GET /api/sessions/<id>.
  useEffect(() => {
    if (sessionRun || !sessionId || !running) return;
    const controller = new AbortController();
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { info?: { relation?: { status?: SubagentSessionStatus; createdAt?: string; completedAt?: string } } } | null) => {
        const relation = data?.info?.relation;
        if (!relation) return;
        setFetchedRun({
          ...(relation.status ? { status: relation.status } : {}),
          ...(relation.createdAt ? { createdAt: relation.createdAt } : {}),
          ...(relation.completedAt ? { completedAt: relation.completedAt } : {}),
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sessionId, sessionRun, running]);

  // Tick while running so the row shows live progress like ZCode's run rows.
  // The clock lives in state (not read during render) so the component stays
  // pure between ticks.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // The authoritative times are the run's own; the parent tool result cannot
  // supply a completion for a background run.
  const durationSeconds = resolveSubagentDuration({
    startedAt: details?.createdAt ?? sessionRun?.createdAt ?? fetchedRun?.createdAt ?? null,
    completedAt: details?.completedAt ?? sessionRun?.completedAt ?? fetchedRun?.completedAt ?? null,
    toolDuration: run.duration ?? null,
    running,
    nowMs: now ?? 0,
  });
  const meta = [profile, durationSeconds !== null ? `${durationSeconds}s` : null].filter(Boolean).join(" · ");
  const statusText = t(statusLabelKey(status));

  return (
    <button
      type="button"
      className="subagent-run-row"
      onClick={() => { if (sessionId) onOpenSubagent?.(sessionId, title); }}
      disabled={!canOpen}
      title={canOpen ? t("subagent.openTranscript") : title}
      aria-label={`${t("agentSwitcher.subagent")}: ${title} — ${meta} — ${statusText}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "7px 10px",
        margin: "4px 0",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--text)",
        textAlign: "left",
        cursor: canOpen ? "pointer" : "default",
        opacity: canOpen ? 1 : 0.75,
      }}
      onMouseEnter={(e) => { if (canOpen) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-panel)"; }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, flexShrink: 0, color: statusColor(status) }}>
        {avatar(status, running)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span style={{ display: "block", marginTop: 1, fontSize: 10.5, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta}
        </span>
      </span>
      <span style={{ flexShrink: 0, fontSize: 11, color: statusColor(status), whiteSpace: "nowrap" }}>
        {statusText}
      </span>
    </button>
  );
}
