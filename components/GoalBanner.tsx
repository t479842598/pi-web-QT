"use client";

import { useI18n } from "@/hooks/useI18n";
import { TargetIcon } from "@phosphor-icons/react/Target";

export interface GoalRuntimeState {
  status: "idle" | "running" | "complete" | "blocked" | "paused";
  goalText: string | null;
  turnsUsed: number;
  turnsLimit: number;
  noProgressTurns: number;
  tokensUsed: number;
  startedAt?: number;
}

interface GoalBannerProps {
  goalState: GoalRuntimeState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

/**
 * Goal banner displayed between the chat messages and the input.
 * Mirrors Reasonix's goal display: always visible with timestamp and
 * pause / continue / stop actions.
 * 始终显示在对话框和输入框之间（Reasonix 样式参考）。
 */
export function GoalBanner({ goalState, onPause, onResume, onStop }: GoalBannerProps) {
  const { t } = useI18n();
  if (goalState.status === "idle" || goalState.status === "complete") return null;

  const isRunning = goalState.status === "running";
  const isPaused = goalState.status === "paused" || goalState.status === "blocked";
  const startTime =
    goalState.startedAt
      ? new Date(goalState.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : null;

  const borderColor =
    isRunning ? "var(--accent)"
    : isPaused ? "color-mix(in srgb, #f59e0b 60%, transparent)"
    : "var(--border)";

  return (
    <div
      style={{
        flexShrink: 0,
        marginTop: 0,
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        background: `color-mix(in srgb, ${borderColor} 6%, transparent)`,
        padding: "6px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <TargetIcon size={14} weight="fill" color="var(--accent)" aria-hidden="true" />
      <span style={{
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
      }}>
        {goalState.goalText ?? t("desktop.goalRunning")}
      </span>

      {startTime && (
        <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
          {startTime}
        </span>
      )}

      {isRunning && (
        <>
          <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {goalState.turnsUsed}/{goalState.turnsLimit}
          </span>
          {goalState.noProgressTurns > 0 && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
              {t("desktop.goalNoProgress", { n: goalState.noProgressTurns })}
            </span>
          )}
          <button
            type="button"
            onClick={onPause}
            title={t("desktop.goalPause")}
            aria-label={t("desktop.goalPause")}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "2px 6px", borderRadius: 4,
              background: "color-mix(in srgb, var(--text-muted) 10%, transparent)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {t("desktop.goalPauseShort")}
          </button>
        </>
      )}

      {isPaused && (
        <button
          type="button"
          onClick={onResume}
          title={t("desktop.goalResume")}
          aria-label={t("desktop.goalResume")}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "2px 6px", borderRadius: 4,
            background: "color-mix(in srgb, #f59e0b 12%, transparent)",
            border: "1px solid color-mix(in srgb, #f59e0b 30%, transparent)",
            color: "var(--text)", cursor: "pointer", fontSize: 11, fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {t("desktop.goalResumeShort")}
        </button>
      )}

      <button
        type="button"
        onClick={onStop}
        title={t("desktop.goalStop")}
        aria-label={t("desktop.goalStop")}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: 0, width: 20, height: 20, borderRadius: 4,
          background: "none", border: "none",
          color: "var(--text-muted)", cursor: "pointer", fontSize: 13,
          opacity: 0.7, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
