"use client";

import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { X } from "@phosphor-icons/react";
import type { WorkTask } from "@/lib/task-types";

interface TaskTranscriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: WorkTask | null;
}

/**
 * Read-only live session viewer for a work task. For tasks with a live
 * session the user can open the conversation in the main chat area; this
 * dialog shows the task's stored session file path and metadata, plus a note
 * on how to view it (the full transcript is browsable through the sessions
 * sidebar since task sessions live under the same ~/.pi/agent/sessions tree).
 */
export function TaskTranscriptDialog({
  open,
  onOpenChange,
  task,
}: TaskTranscriptDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
  }, [open, task]);

  if (!open || !task) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 970,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(520px, calc(100vw - 48px))",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("tasks.sessionTitle")}</h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px 16px", fontSize: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>{t("tasks.sessionId")}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflowWrap: "anywhere" }}>
              {task.conversationId ?? "—"}
            </span>
          </div>
          {task.sessionFile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
              <span style={{ color: "var(--text-muted)" }}>{t("tasks.sessionFile")}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflowWrap: "anywhere" }}>{task.sessionFile}</span>
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("tasks.sessionHint")}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ padding: "8px 16px", borderRadius: 8, background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {t("i18n.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
