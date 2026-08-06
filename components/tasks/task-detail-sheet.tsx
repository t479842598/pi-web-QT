"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import {
  ArrowClockwise,
  ArrowUUpLeft,
  Archive,
  GitBranch,
  GitCommit,
  GitDiff,
  ListChecks,
  PencilSimpleLine,
  Play,
  Prohibit,
  Trash,
  X,
  type Icon,
} from "@phosphor-icons/react";
import {
  taskAction,
  taskArchive,
  taskReturn,
  deleteTaskApi,
  listTaskEvents,
  listTaskChangedFiles,
  getTaskDiff,
} from "@/lib/task-api";
import type { WorkTask, WorkTaskEvent, WorkTaskChangedFile } from "@/lib/task-types";
import { StatusChip } from "./task-card";

interface TaskDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live task row (already refreshed by the board's provider). */
  task: WorkTask | null;
  onViewSession: (task: WorkTask) => void;
  onMerge: (task: WorkTask) => void;
  onEdit: (task: WorkTask) => void;
}

/** Translated label for a timeline event kind; falls back to the raw kind. */
function eventLabel(kind: string, t: (key: string) => string): string {
  const key = `tasks.event_${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

/** Right-side detail drawer: metadata, the action zone, and the append-only
 *  progress timeline (task events). The bottom bar keeps utilities only
 *  (delete). */
export function TaskDetailSheet({
  open,
  onOpenChange,
  task,
  onViewSession,
  onMerge,
  onEdit,
}: TaskDetailSheetProps) {
  const { t } = useI18n();
  const { refetch } = useTasksView();
  const [events, setEvents] = useState<WorkTaskEvent[]>([]);
  const [files, setFiles] = useState<WorkTaskChangedFile[]>([]);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffPatch, setDiffPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnText, setReturnText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  const [busy, setBusy] = useState(false);

  const taskId = task?.id ?? null;
  const projectRoot = task?.projectRoot ?? null;

  const reload = useCallback(async () => {
    if (taskId == null || projectRoot == null) return;
    const [evs, fls] = await Promise.all([
      listTaskEvents(projectRoot, taskId).catch(() => [] as WorkTaskEvent[]),
      task?.worktreePath
        ? listTaskChangedFiles(projectRoot, taskId).then((d) => d.files).catch(() => [] as WorkTaskChangedFile[])
        : Promise.resolve([] as WorkTaskChangedFile[]),
    ]);
    setEvents(evs);
    setFiles(fls);
  }, [taskId, projectRoot, task?.worktreePath]);

  useEffect(() => {
    if (!open || taskId == null) return;
    setEvents([]);
    setFiles([]);
    setReturnOpen(false);
    setReturnText("");
    void reload();
    // Refresh while open: poll every 5s is enough for the timeline to follow
    // engine progress without an extra event channel per sheet.
    const id = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(id);
  }, [open, taskId, reload]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } catch (error) {
        console.error("detail action failed", error);
      } finally {
        setBusy(false);
        void refetch();
      }
    },
    [refetch],
  );

  const loadDiff = useCallback(
    async (file: string) => {
      if (projectRoot == null || taskId == null) return;
      setDiffLoading(true);
      try {
        const result = await getTaskDiff(projectRoot, taskId, file);
        setDiffPatch(result.supported && result.patch ? result.patch : null);
      } catch {
        setDiffPatch(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [projectRoot, taskId],
  );

  const handleViewDiff = (file: string) => {
    setDiffFile(file);
    setDiffPatch(null);
    void loadDiff(file);
  };

  const handleDelete = async () => {
    if (task == null || projectRoot == null) return;
    await act(() => deleteTaskApi(task.id, projectRoot, deleteWorktree));
    onOpenChange(false);
  };

  const handleReturn = async () => {
    if (task == null || projectRoot == null || !returnText.trim()) return;
    await act(() => taskReturn(task.id, projectRoot, returnText.trim()));
    setReturnOpen(false);
    setReturnText("");
  };

  if (!open || task == null || projectRoot == null) return null;

  const zoneButtons: Array<{
    label: string;
    icon: Icon;
    onClick: () => void;
    filled?: boolean;
    danger?: boolean;
  }> = [];
  if (task.archivedAt == null) {
    switch (task.status) {
      case "todo":
        zoneButtons.push({ label: t("tasks.actionStart"), icon: Play, onClick: () => void act(() => taskAction(task.id, projectRoot, "start")), filled: true });
        zoneButtons.push({ label: t("tasks.actionEdit"), icon: PencilSimpleLine, onClick: () => onEdit(task) });
        break;
      case "queued":
      case "preparing":
      case "running":
      case "awaiting_input":
        zoneButtons.push({ label: t("tasks.actionCancel"), icon: Prohibit, onClick: () => void act(() => taskAction(task.id, projectRoot, "cancel")), danger: true });
        break;
      case "review":
        zoneButtons.push({ label: t("tasks.actionMerge"), icon: GitCommit, onClick: () => onMerge(task), filled: true });
        zoneButtons.push({ label: t("tasks.actionReturn"), icon: ArrowUUpLeft, onClick: () => setReturnOpen(true) });
        break;
      case "failed":
        zoneButtons.push({ label: t("tasks.actionRetry"), icon: ArrowClockwise, onClick: () => void act(() => taskAction(task.id, projectRoot, "retry")), filled: true });
        zoneButtons.push({ label: t("tasks.actionEdit"), icon: PencilSimpleLine, onClick: () => onEdit(task) });
        break;
      case "done":
        zoneButtons.push({ label: t("tasks.actionArchive"), icon: Archive, onClick: () => void act(() => taskArchive(task.id, projectRoot, true)) });
        break;
      case "canceled":
        zoneButtons.push({ label: t("tasks.actionRequeue"), icon: ArrowUUpLeft, onClick: () => void act(() => taskAction(task.id, projectRoot, "requeue")), filled: true });
        break;
      default:
        break;
    }
  } else {
    zoneButtons.push({ label: t("tasks.actionUnarchive"), icon: Archive, onClick: () => void act(() => taskArchive(task.id, projectRoot, false)) });
  }
  if (task.conversationId != null) {
    zoneButtons.push({ label: t("tasks.actionViewSession"), icon: ListChecks, onClick: () => onViewSession(task) });
  }

  const buttonStyle = (filled?: boolean, danger?: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
    background: filled ? "var(--accent)" : danger ? "rgba(239,68,68,0.1)" : "var(--bg-hover)",
    color: filled ? "#fff" : danger ? "#dc2626" : "var(--text)",
    border: filled || danger ? "none" : "1px solid var(--border)",
  });

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 800,
        background: "rgba(0,0,0,0.35)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: "min(480px, 90vw)",
          background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 16px 0" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4, overflowWrap: "break-word" }}>{task.title}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <StatusChip task={task} />
              {task.workBranch ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                  <GitBranch size={12} aria-hidden="true" />
                  {task.workBranch}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("i18n.close")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", flexShrink: 0 }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Action zone */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "14px 16px 0" }}>
          {zoneButtons.map((button) => (
            <button key={button.label} type="button" onClick={button.onClick} disabled={busy} style={buttonStyle(button.filled, button.danger)}>
              <button.icon size={13} weight="bold" aria-hidden="true" />
              {button.label}
            </button>
          ))}
        </div>

        {/* Return feedback */}
        {returnOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px 0" }}>
            <textarea
              value={returnText}
              onChange={(e) => setReturnText(e.target.value)}
              placeholder={t("tasks.returnPlaceholder")}
              rows={3}
              style={{
                width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 12,
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setReturnOpen(false)} style={{ padding: "6px 12px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
                {t("i18n.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleReturn()}
                disabled={!returnText.trim()}
                style={{ padding: "6px 14px", borderRadius: 8, background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                {t("tasks.returnSubmit")}
              </button>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px 0", fontSize: 12, color: "var(--text-muted)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ flexShrink: 0, color: "var(--text-dim)", width: 64 }}>{t("tasks.metaProject")}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }}>{task.projectRoot}</span>
          </div>
          {task.createdAt ? (
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ flexShrink: 0, color: "var(--text-dim)", width: 64 }}>{t("tasks.metaCreated")}</span>
              <span>{new Date(task.createdAt).toLocaleString()}</span>
            </div>
          ) : null}
          {task.mergeCommit ? (
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ flexShrink: 0, color: "var(--text-dim)", width: 64 }}>{t("tasks.metaCommit")}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{task.mergeCommit}</span>
            </div>
          ) : null}
        </div>

        {/* Changed files + diff */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px 0" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("tasks.changedFiles")}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 140, overflowY: "auto" }}>
              {files.map((f) => (
                <button
                  key={f.file}
                  type="button"
                  onClick={() => handleViewDiff(f.file)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                    padding: "4px 6px", borderRadius: 6, background: "none", border: "none",
                    color: "var(--text)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  <GitDiff size={13} style={{ flexShrink: 0, color: "var(--text-muted)" }} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }}>{f.file}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#059669", flexShrink: 0 }}>+{f.additions}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#dc2626", flexShrink: 0 }}>-{f.deletions}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Diff preview */}
        {diffFile != null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px 0", minHeight: 0, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{t("tasks.diff")}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{diffFile}</span>
              <button type="button" onClick={() => setDiffFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
            {diffLoading ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 8 }}>{t("tasks.loading")}</div>
            ) : diffPatch ? (
              <pre style={{
                margin: 0, maxHeight: 200, overflow: "auto",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                whiteSpace: "pre",
              }}>
                {diffPatch.split("\n").map((line, i) => {
                  let color: string | undefined;
                  if (line.startsWith("+") && !line.startsWith("+++")) color = "#059669";
                  else if (line.startsWith("-") && !line.startsWith("---")) color = "#dc2626";
                  else if (line.startsWith("@@")) color = "var(--accent)";
                  return <div key={i} style={{ color }}>{line || " "}</div>;
                })}
              </pre>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 8 }}>{t("tasks.noDiff")}</div>
            )}
          </div>
        )}

        {/* Timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px 0", flex: 1, minHeight: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("tasks.timeline")}
          </span>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 8 }}>
            {events.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)", padding: 8 }}>{t("tasks.noEvents")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {[...events].reverse().map((event) => (
                  <div key={event.id} style={{ display: "flex", gap: 8, padding: "4px 6px", borderRadius: 6, fontSize: 11 }}>
                    <span style={{ color: "var(--text-dim)", flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 10, paddingTop: 1 }}>
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                    <span style={{ color: "var(--text)", flexShrink: 0, fontWeight: 500 }}>{eventLabel(event.kind, t)}</span>
                    {event.payload?.feedback ? (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {String(event.payload.feedback)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar: delete */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {deleteOpen ? (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={deleteWorktree} onChange={(e) => setDeleteWorktree(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                {t("tasks.deleteWorktree")}
              </label>
              <button type="button" onClick={() => setDeleteOpen(false)} style={{ padding: "6px 12px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
                {t("i18n.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                style={{ padding: "6px 14px", borderRadius: 8, background: "#dc2626", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                {t("tasks.deleteConfirm")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "#dc2626", fontSize: 12, cursor: "pointer" }}
            >
              <Trash size={13} aria-hidden="true" />
              {t("tasks.delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
