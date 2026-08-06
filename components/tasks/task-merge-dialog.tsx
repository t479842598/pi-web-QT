"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import { X } from "@phosphor-icons/react";
import { taskMerge, getTaskSettingsEffective } from "@/lib/task-api";
import type { WorkTask } from "@/lib/task-types";

interface TaskMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: WorkTask | null;
}

/** Accept a reviewed task. The merge itself is performed by the agent in the
 *  task's session (or by the engine's git merge when no session is live), so
 *  the form is down to two choices: let the agent write the commit message
 *  (default) or provide one, and whether to delete the worktree after
 *  landing. Submit awaits only the dispatch; the outcome rides
 *  `task://changed` (merging → done, or back to review with an error). */
export function TaskMergeDialog({
  open,
  onOpenChange,
  task,
}: TaskMergeDialogProps) {
  const { t } = useI18n();
  const { refetch } = useTasksView();
  const [autoMessage, setAutoMessage] = useState(true);
  const [message, setMessage] = useState("");
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    setAutoMessage(true);
    setMessage(task.title);
    setSubmitting(false);
    getTaskSettingsEffective(task.projectRoot)
      .then((s) => setDeleteWorktree(s.deleteWorktreeDefault))
      .catch(() => setDeleteWorktree(true));
  }, [open, task]);

  if (!open || !task) return null;

  const submit = async () => {
    if ((!autoMessage && !message.trim()) || submitting) return;
    setSubmitting(true);
    try {
      await taskMerge(task.id, task.projectRoot, autoMessage ? null : message.trim(), deleteWorktree);
      onOpenChange(false);
      void refetch();
    } catch (error) {
      console.error("merge failed", error);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13,
    outline: "none", fontFamily: "inherit",
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
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("tasks.mergeTitle")}</h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px 16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="radio" checked={autoMessage} onChange={() => setAutoMessage(true)} style={{ accentColor: "var(--accent)" }} />
            {t("tasks.mergeAutoMessage")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="radio" checked={!autoMessage} onChange={() => setAutoMessage(false)} style={{ accentColor: "var(--accent)" }} />
            {t("tasks.mergeManualMessage")}
          </label>
          {!autoMessage && (
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("tasks.mergeMessagePlaceholder")}
              style={inputStyle}
            />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={deleteWorktree} onChange={(e) => setDeleteWorktree(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            {t("tasks.mergeDeleteWorktree")}
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => onOpenChange(false)} style={{ padding: "8px 14px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {t("i18n.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={(!autoMessage && !message.trim()) || submitting}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("tasks.mergeConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
