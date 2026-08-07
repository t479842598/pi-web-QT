"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import { X } from "@phosphor-icons/react";
import { taskAction } from "@/lib/task-api";
import type { WorkTask } from "@/lib/task-types";

export type TaskRestartKind = "retry" | "requeue";

interface TaskRestartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: WorkTask | null;
  /** `retry` for a failed task, `requeue` for a canceled one. */
  kind: TaskRestartKind;
}

/** Restart a failed / canceled task from the board, with an optional note for
 *  the agent. The note is injected into the launch prompt of the next run —
 *  "run pnpm install first" is common, but so is pointing at the file that
 *  broke. Empty is a complete answer: the note is a modifier on the restart,
 *  and submitting an untouched box is the plain one-click restart. */
export function TaskRestartDialog({
  open,
  onOpenChange,
  task,
  kind,
}: TaskRestartDialogProps) {
  const { t } = useI18n();
  const { refetch } = useTasksView();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A fresh box per open — a note belongs to one restart, not to the next.
  useEffect(() => {
    if (!open) return;
    setNote("");
    setSubmitting(false);
  }, [open, task]);

  if (!open || !task) return null;

  const isRetry = kind === "retry";

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await taskAction(task.id, task.projectRoot, kind, {
        note: note.trim() || null,
      });
      onOpenChange(false);
      void refetch();
    } catch (error) {
      console.error("restart failed", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 950,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(480px, calc(100vw - 48px))",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {isRetry ? t("tasks.restartTitleRetry") : t("tasks.restartTitleRequeue")}
          </h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px 16px" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
            {t("tasks.restartDescription")}
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("tasks.actionAddNote")}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isRetry
                  ? t("tasks.followUpPlaceholderRetry")
                  : t("tasks.followUpPlaceholderRequeue")
              }
              rows={3}
              autoFocus
              style={{
                width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13,
                outline: "none", fontFamily: "inherit", resize: "vertical",
              }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} style={{ padding: "8px 14px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {t("i18n.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {isRetry ? t("tasks.actionRetry") : t("tasks.actionRequeue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
