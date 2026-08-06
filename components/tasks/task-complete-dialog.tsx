"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import { X } from "@phosphor-icons/react";
import { taskComplete, getTaskSettingsEffective } from "@/lib/task-api";
import type { WorkTask } from "@/lib/task-types";

interface TaskCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: WorkTask | null;
}

/** Accept a reviewed task that changed nothing. There is no merge to dispatch
 *  and no commit message to write, so the only decision left is what happens
 *  to the (empty) worktree — hence one checkbox and a confirm. Settles
 *  synchronously: the command returns once the task is `done`. */
export function TaskCompleteDialog({
  open,
  onOpenChange,
  task,
}: TaskCompleteDialogProps) {
  const { t } = useI18n();
  const { refetch } = useTasksView();
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const hasWorktree = task?.worktreePath != null;

  useEffect(() => {
    if (!open || !task) return;
    // Same seed as the merge dialog: the project's worktree-cleanup default.
    setSubmitting(false);
    let cancelled = false;
    getTaskSettingsEffective(task.projectRoot)
      .then((s) => {
        if (!cancelled) setDeleteWorktree(s.deleteWorktreeDefault);
      })
      .catch(() => {
        if (!cancelled) setDeleteWorktree(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task]);

  if (!open || !task) return null;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await taskComplete(task.id, task.projectRoot, hasWorktree && deleteWorktree);
      onOpenChange(false);
      void refetch();
    } catch (error) {
      console.error("complete failed", error);
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
        width: "min(440px, calc(100vw - 48px))",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("tasks.completeTitle")}</h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px 16px" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
            {t("tasks.completeDescription")}
          </p>
          {hasWorktree ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={deleteWorktree} onChange={(e) => setDeleteWorktree(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
              {t("tasks.completeDeleteWorktree")}
            </label>
          ) : null}
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
              {t("tasks.completeSubmit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
