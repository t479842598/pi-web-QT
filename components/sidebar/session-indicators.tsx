"use client";

import { Loader } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

/**
 * Shared session-row indicators + relative time formatting, extracted from
 * SessionSidebar.tsx so both the legacy per-project list and the new projects
 * panel render identical running/unread affordances.
 */

export function formatRelativeTime(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("desktop.justNow");
  if (mins < 60) return t("desktop.minutesAgo", { count: mins });
  if (hours < 24) return t("desktop.hoursAgo", { count: hours });
  if (days < 7) return t("desktop.daysAgo", { count: days });
  return date.toLocaleDateString();
}

export function RunningSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.agentRunning")}
      aria-label={t("desktop.agentRunningLabel")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      {/* ZCode uses lucide's Loader with a spin animation for running tasks. */}
      <Loader size={13} style={{ display: "block", animation: "spin 0.9s linear infinite" }} aria-hidden="true" />
    </span>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.newActivity")}
      aria-label={t("desktop.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="3" fill="currentColor">
          <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}
