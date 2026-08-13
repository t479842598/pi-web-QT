"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TargetIcon } from "@phosphor-icons/react/Target";

export type GoalStatus = "idle" | "running" | "paused" | "blocked" | "budget_limited" | "complete";

export interface GoalRuntimeState {
  status: GoalStatus;
  goalText: string | null;
  turnsUsed: number;
  turnsLimit: number;
  noProgressTurns: number;
  noProgressLimit: number;
  tokensUsed: number;
  tokenBudget?: number | null;
  timeUsedSeconds?: number;
  startedAt?: number;
  updatedAt?: number;
}

interface GoalBannerProps {
  goalState: GoalRuntimeState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onEdit: (text: string) => void;
}

const STATUS_COLORS: Record<GoalStatus, string> = {
  idle: "#6b7280",
  running: "#10b981",
  paused: "#d97706",
  blocked: "#ea580c",
  budget_limited: "#ef4444",
  complete: "#6b7280",
};

const RESUMABLE = new Set<GoalStatus>(["paused", "blocked"]);

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function statusLabel(status: GoalStatus): string {
  switch (status) {
    case "running": return "active";
    case "paused": return "paused";
    case "blocked": return "stalled";
    case "budget_limited": return "budget limited";
    case "complete": return "complete";
    default: return "idle";
  }
}

/**
 * Goal panel shown between the chat messages and the input while a goal is
 * active (Goal collaboration mode). Mirrors the Codex-style GoalPanel from
 * lyhue1991/pi-web: status dot + status label + elapsed time + token budget +
 * Edit / Pause / Resume / Clear actions, with inline editing.
 */
export function GoalBanner({ goalState, onPause, onResume, onStop, onEdit }: GoalBannerProps) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Live elapsed-time ticker while the goal is running.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (goalState.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goalState.status]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  if (goalState.status === "idle" || goalState.status === "complete") return null;

  const dotColor = STATUS_COLORS[goalState.status] ?? "var(--text-muted)";
  const canPause = goalState.status === "running";
  const canResume = RESUMABLE.has(goalState.status);
  const isRunning = goalState.status === "running";

  // Elapsed wall time: prefer accumulated timeUsedSeconds, live-tick while running.
  let elapsedSeconds = goalState.timeUsedSeconds ?? 0;
  if (isRunning && goalState.startedAt) {
    elapsedSeconds = Math.floor((now - goalState.startedAt) / 1000);
  }
  const budgetLabel = goalState.tokenBudget != null
    ? `${formatTokens(goalState.tokensUsed)}/${formatTokens(goalState.tokenBudget)}`
    : formatTokens(goalState.tokensUsed);

  const startEdit = () => {
    setDraft(goalState.goalText ?? "");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft("");
  };

  const saveEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === goalState.goalText) {
      cancelEdit();
      return;
    }
    onEdit(trimmed);
    setIsEditing(false);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const btn = (label: string, onClick: () => void, primary: boolean) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 9px",
        borderRadius: 5,
        border: `1px solid ${primary ? "var(--accent)" : "var(--border)"}`,
        background: primary ? "var(--accent)" : "var(--bg)",
        color: primary ? "#fff" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: 1.4,
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderTop: `1px solid ${dotColor}55`,
        borderBottom: `1px solid ${dotColor}55`,
        background: `color-mix(in srgb, ${dotColor} 5%, transparent)`,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <TargetIcon size={13} weight="fill" color={dotColor} aria-hidden="true" />
        <span
          title={statusLabel(goalState.status)}
          style={{
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: dotColor,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {statusLabel(goalState.status)}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            whiteSpace: "nowrap",
            textAlign: "right",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatTime(elapsedSeconds)} · {budgetLabel}t{goalState.tokenBudget != null ? " · " + t("desktop.goalBudget") : ""}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {canPause && btn(t("desktop.goalPauseShort"), onPause, false)}
          {canResume && btn(t("desktop.goalResumeShort"), onResume, true)}
          {!isEditing && btn(t("desktop.goalEdit"), startEdit, false)}
          {btn("✕", onStop, false)}
        </div>
      </div>

      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--accent)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: "var(--font-sans)",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            {btn(t("desktop.goalCancel"), cancelEdit, false)}
            {btn(t("desktop.goalSave"), saveEdit, true)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {t("desktop.goalEditHint")}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {goalState.goalText ?? t("desktop.goalRunning")}
          </div>
          {isRunning && (
            <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexWrap: "wrap" }}>
              <span>
                {t("desktop.goalTurns")}: {goalState.turnsUsed}/{goalState.turnsLimit}
              </span>
              {goalState.noProgressTurns > 0 && (
                <span>{t("desktop.goalNoProgress", { n: goalState.noProgressTurns })}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
