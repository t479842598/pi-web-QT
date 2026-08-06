"use client";

import { useI18n } from "@/hooks/useI18n";
import {
  Archive,
  ArrowClockwise,
  ArrowUUpLeft,
  Check,
  CheckCircle,
  CircleNotch,
  GitMerge,
  ListChecks,
  PencilSimpleLine,
  Play,
  Prohibit,
  WarningCircle,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import type { WorkTask } from "@/lib/task-types";

export function statusLabelKey(status: WorkTask["status"]): string {
  switch (status) {
    case "todo": return "tasks.statusTodo";
    case "queued": return "tasks.statusQueued";
    case "preparing": return "tasks.statusPreparing";
    case "running": return "tasks.statusRunning";
    case "awaiting_input": return "tasks.statusAwaitingInput";
    case "review": return "tasks.statusReview";
    case "merging": return "tasks.statusMerging";
    case "done": return "tasks.statusDone";
    case "failed": return "tasks.statusFailed";
    case "canceled": return "tasks.statusCanceled";
  }
}

/** Per-status presentation: live = accent spinner text, attention = amber
 *  pill, done = green check, failed = red pill, rest = muted pill. */
export function StatusChip({ task }: { task: WorkTask }) {
  const { t } = useI18n();
  const label =
    task.status === "failed" && task.failureReason === "interrupted"
      ? t("tasks.statusInterrupted")
      : t(statusLabelKey(task.status));
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.4,
    flexShrink: 0,
    whiteSpace: "nowrap",
  };
  switch (task.status) {
    case "queued":
    case "preparing":
    case "running":
    case "merging":
      return (
        <span style={{ ...base, color: "var(--accent)" }}>
          <CircleNotch size={11} className="pi-spin" style={{ animation: "pi-spin 1s linear infinite" }} aria-hidden="true" />
          {label}
        </span>
      );
    case "awaiting_input":
    case "review":
      return (
        <span style={{ ...base, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.08)", color: "#d97706" }}>
          {label}
        </span>
      );
    case "done":
      return (
        <span style={{ ...base, background: "rgba(16,185,129,0.12)", color: "#059669" }}>
          <Check size={10} weight="bold" aria-hidden="true" />
          {label}
        </span>
      );
    case "failed":
      return (
        <span style={{ ...base, background: "rgba(239,68,68,0.12)", color: "#dc2626" }}>
          {label}
        </span>
      );
    default:
      return (
        <span style={{ ...base, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
          {label}
        </span>
      );
  }
}

/** Acceptance red/green light for a reviewed card. */
export function PreflightChip({ task }: { task: WorkTask }) {
  const light = task.preflight;
  if (!light || task.status !== "review") return null;
  const tone =
    light.status === "passed"
      ? { background: "rgba(16,185,129,0.12)", color: "#059669" }
      : light.status === "failed"
        ? { background: "rgba(239,68,68,0.12)", color: "#dc2626" }
        : { background: "var(--bg-hover)", color: "var(--text-muted)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        padding: "1px 6px",
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1.5,
        maxWidth: "100%",
        ...tone,
      }}
      title={light.command}
    >
      {light.status === "running" ? (
        <CircleNotch size={10} style={{ animation: "pi-spin 1s linear infinite" }} aria-hidden="true" />
      ) : light.status === "passed" ? (
        <CheckCircle size={10} aria-hidden="true" />
      ) : (
        <XCircle size={10} aria-hidden="true" />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{light.command}</span>
    </span>
  );
}

/** Relative time label (minutes/hours/days). */
export function formatTaskWhen(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface CardActionItem {
  icon: Icon;
  label: string;
  onClick: () => void;
}

interface TaskCardProps {
  task: WorkTask;
  folderName: string | null;
  now: number;
  onOpen: () => void;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRequeue: () => void;
  onViewSession: () => void;
  onMerge: () => void;
  onArchive: () => void;
  onEdit: () => void;
}

/** One board card. The whole card opens the detail sheet; the footer carries
 *  exactly one filled primary action per status on the left and round icon
 *  buttons on the right (edit / archive / view session). */
export function TaskCard({
  task,
  folderName,
  now,
  onOpen,
  onStart,
  onCancel,
  onRetry,
  onRequeue,
  onViewSession,
  onMerge,
  onArchive,
  onEdit,
}: TaskCardProps) {
  const { t } = useI18n();
  const archived = task.archivedAt != null;
  const live =
    task.status === "running" ||
    task.status === "awaiting_input" ||
    task.status === "merging";

  const stat =
    task.filesChanged != null && task.filesChanged > 0 ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--font-mono)", fontSize: 10 }}>
        <span style={{ color: "#059669" }}>+{task.additions ?? 0}</span>
        <span style={{ color: "#dc2626" }}>-{task.deletions ?? 0}</span>
      </span>
    ) : null;
  const when = formatTaskWhen(
    task.finishedAt ?? task.settledAt ?? task.startedAt ?? task.createdAt,
    now,
  );

  const { primary, more } = (() => {
    const more: CardActionItem[] = [];
    let primary: CardActionItem | null = null;
    if (archived) {
      primary = { icon: Archive, label: t("tasks.actionUnarchive"), onClick: onArchive };
      return { primary, more };
    }
    switch (task.status) {
      case "todo":
        primary = { icon: Play, label: t("tasks.actionStart"), onClick: onStart };
        more.push({ icon: PencilSimpleLine, label: t("tasks.actionEdit"), onClick: onEdit });
        break;
      case "queued":
      case "preparing":
      case "running":
      case "awaiting_input":
        primary = { icon: Prohibit, label: t("tasks.actionCancel"), onClick: onCancel };
        break;
      case "review":
        primary = { icon: GitMerge, label: t("tasks.actionMerge"), onClick: onMerge };
        break;
      case "merging":
        break;
      case "failed":
        primary = { icon: ArrowClockwise, label: t("tasks.actionRetry"), onClick: onRetry };
        more.push({ icon: PencilSimpleLine, label: t("tasks.actionEdit"), onClick: onEdit });
        more.push({ icon: Archive, label: t("tasks.actionArchive"), onClick: onArchive });
        break;
      case "done":
        primary = { icon: Archive, label: t("tasks.actionArchive"), onClick: onArchive };
        break;
      case "canceled":
        primary = { icon: ArrowUUpLeft, label: t("tasks.actionRequeue"), onClick: onRequeue };
        more.push({ icon: Archive, label: t("tasks.actionArchive"), onClick: onArchive });
        break;
    }
    return { primary, more };
  })();

  const secondaries = [...more];
  if (task.conversationId != null) {
    secondaries.push({
      icon: ListChecks,
      label: t("tasks.actionViewSession"),
      onClick: onViewSession,
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        borderRadius: 12,
        border: "1px solid color-mix(in srgb, var(--border) 85%, transparent)",
        background: "var(--bg-panel)",
        padding: 12,
        textAlign: "left",
        transition: "border-color 0.12s",
        opacity: archived ? 0.6 : 1,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
      className="task-card-hover"
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--border) 85%, transparent)"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ minWidth: 0, overflowWrap: "break-word", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
          {task.title}
        </span>
        <StatusChip task={task} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 6px", marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
        {folderName ? <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folderName}</span> : null}
        {folderName && task.workBranch ? <span style={{ opacity: 0.5 }}>/</span> : null}
        {task.workBranch ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{task.workBranch}</span>
        ) : null}
        {(folderName || task.workBranch) && (stat || when) ? <span style={{ opacity: 0.5 }}>·</span> : null}
        {stat}
        {stat && when ? <span style={{ opacity: 0.5 }}>·</span> : null}
        {when ? <span style={{ flexShrink: 0 }}>{when}</span> : null}
        <PreflightChip task={task} />
      </div>

      {task.lastError && (task.status === "failed" || task.status === "review") ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, borderRadius: 8, background: "rgba(239,68,68,0.08)", padding: "6px 8px", fontSize: 11, color: "#dc2626" }}>
          <WarningCircle size={13} style={{ flexShrink: 0 }} aria-hidden="true" />
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.lastError}</span>
          <button
            type="button"
            style={{ flexShrink: 0, fontWeight: 600, background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 11, textDecoration: "underline" }}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
          >
            {t("tasks.errorView")}
          </button>
        </div>
      ) : null}
      {task.status === "review" && task.resultSummary ? (
        <p style={{ margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)" }}>
          {task.resultSummary}
        </p>
      ) : null}
      {live && task.latestProgress ? (
        <p style={{ margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", fontStyle: "italic" }}>
          {task.latestProgress}
        </p>
      ) : null}

      {primary || secondaries.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {primary ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); primary.onClick(); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 7,
                background: "var(--accent)", color: "#fff",
                border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
              }}
            >
              <primary.icon size={12} weight="bold" aria-hidden="true" />
              {primary.label}
            </button>
          ) : null}
          <div style={{ flex: 1 }} />
          {secondaries.map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.label}
              aria-label={item.label}
              onClick={(e) => { e.stopPropagation(); item.onClick(); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, borderRadius: 999,
                background: "none", border: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer",
                opacity: 0, transition: "opacity 0.12s, background 0.12s, color 0.12s",
              }}
              className="task-card-secondary"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <item.icon size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
