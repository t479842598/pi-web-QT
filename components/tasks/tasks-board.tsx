"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import {
  FunnelSimple,
  Gear as GearIcon,
  Play,
  Plus,
  SquaresFour,
} from "@phosphor-icons/react";
import {
  groupTasksByColumn,
  type WorkTask,
} from "@/lib/task-types";
import { COLUMN_META, columnLabelKey, emptyLabelKey, BOARD_COLUMN_IDS } from "./board-columns";
import { StatusChip, TaskCard } from "./task-card";
import { TaskDetailSheet } from "./task-detail-sheet";
import { TaskEditorDialog } from "./task-editor-dialog";
import { TaskMergeDialog } from "./task-merge-dialog";
import { TaskSettingsDialog } from "./task-settings-dialog";
import { TaskTranscriptDialog } from "./task-transcript-dialog";
import {
  taskAction,
  taskArchive,
  taskReorder,
  taskStartAll,
} from "@/lib/task-api";

const ALL_FOLDERS = "__all__";

/** localStorage key for the board filter (show canceled / archived). */
const FILTER_STORAGE_KEY = "pi-tasks-board-filter";

interface BoardFilter {
  showCanceled: boolean;
  showArchived: boolean;
}

const DEFAULT_FILTER: BoardFilter = { showCanceled: false, showArchived: false };

function loadFilter(): BoardFilter {
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BoardFilter>;
      return {
        showCanceled: parsed.showCanceled ?? false,
        showArchived: parsed.showArchived ?? false,
      };
    }
  } catch {
    // fall through
  }
  return DEFAULT_FILTER;
}

/** Fired by the chrome-strip settings button; the board owns the dialog. */
export const OPEN_TASK_SETTINGS_EVENT = "pi:open-task-settings";

/** Page title band: Beta badge + attention count + settings entry. Rendered
 *  above the board, matching the 36px chrome-strip language. */
export function TasksBoardTitle() {
  const { t } = useI18n();
  const { attentionCount } = useTasksView();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36, flexShrink: 0, padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
      <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
        <SquaresFour size={15} color="var(--text-muted)" aria-hidden="true" />
        {t("tasks.title")}
        {/* Untranslated on purpose: "Beta" reads as-is in every locale. */}
        <span style={{ borderRadius: 999, background: "rgba(37,99,235,0.12)", color: "var(--accent)", padding: "1px 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Beta
        </span>
      </h1>
      {attentionCount > 0 ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, background: "rgba(239,68,68,0.12)", color: "#dc2626", padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
          {attentionCount} {t("tasks.attentionBadge")}
        </span>
      ) : null}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_TASK_SETTINGS_EVENT))}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          height: 26, padding: "0 10px", borderRadius: 7,
          background: "none", border: "none",
          color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
        }}
        title={t("tasks.settingsTitle")}
      >
        <GearIcon size={13} aria-hidden="true" />
        {t("tasks.settingsTitle")}
      </button>
    </div>
  );
}

interface TasksBoardProps {
  /** Current project root from the app (for the "new task" project picker
   *  even when the project has no tasks yet). */
  activeProject?: string;
}

export function TasksBoard({ activeProject }: TasksBoardProps) {
  const { t } = useI18n();
  const { tasks, projects, refetch } = useTasksView();

  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<BoardFilter>(() => loadFilter());
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(boardFilter));
    } catch {
      // storage may be unavailable
    }
  }, [boardFilter]);

  // Drag state (T-006): pointer-based with a portalled fixed preview.
  const [drag, setDrag] = useState<{ task: WorkTask; width: number } | null>(null);
  const [dropArmed, setDropArmed] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number; width: number } | null>(null);
  const pointRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const inProgressColRef = useRef<HTMLDivElement | null>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const dragOrderRef = useRef<number[] | null>(null);
  dragOrderRef.current = dragOrder;
  const draggedRef = useRef(false);
  const abortRef = useRef(false);

  // One shared timestamp per render tick keeps every card's relative-time
  // label consistent.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTask, setEditorTask] = useState<WorkTask | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);
  const [mergeTask, setMergeTask] = useState<WorkTask | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionTaskId, setSessionTaskId] = useState<number | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  // Settings entry from the title bar (window event).
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener(OPEN_TASK_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_TASK_SETTINGS_EVENT, open);
  }, []);

  const visibleTasks = useMemo(
    () =>
      folderFilter == null
        ? tasks
        : tasks.filter((task) => task.projectRoot === folderFilter),
    [tasks, folderFilter],
  );
  const columns = useMemo(
    () => groupTasksByColumn(visibleTasks, boardFilter.showCanceled, boardFilter.showArchived),
    [visibleTasks, boardFilter],
  );

  // Optimistic order while a drag is live; server order otherwise.
  const todoTasks = useMemo(() => {
    const base = columns.todo;
    if (dragOrder == null) return base;
    const byId = new Map(base.map((task) => [task.id, task]));
    const ordered = dragOrder.flatMap((id) => byId.get(id) ?? []);
    for (const task of base) {
      if (!dragOrder.includes(task.id)) ordered.push(task);
    }
    return ordered;
  }, [columns.todo, dragOrder]);

  const detailTask = useMemo(
    () => tasks.find((task) => task.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  );
  const sessionTask = useMemo(
    () => tasks.find((task) => task.id === sessionTaskId) ?? null,
    [tasks, sessionTaskId],
  );

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        console.error("task action failed", error);
      } finally {
        void refetch();
      }
    },
    [refetch],
  );

  const openSession = useCallback((task: WorkTask) => {
    if (task.conversationId == null) return;
    setSessionTaskId(task.id);
    setSessionOpen(true);
  }, [setSessionTaskId, setSessionOpen]);

  const openMerge = useCallback((task: WorkTask) => {
    setMergeTask(task);
    setMergeOpen(true);
  }, [setMergeTask, setMergeOpen]);

  const openNewTask = useCallback(() => {
    setEditorTask(null);
    setEditorOpen(true);
  }, [setEditorTask, setEditorOpen]);

  // ── Drag handlers (T-006) ──────────────────────────────────────────────

  const positionGhost = useCallback((x: number, y: number) => {
    const el = ghostRef.current;
    const g = dragRef.current;
    if (!el || !g) return;
    el.style.transform = `translate3d(${x - g.dx}px, ${y - g.dy}px, 0)`;
  }, []);

  const pointerOverInProgress = (x: number, y: number) => {
    const rect = inProgressColRef.current?.getBoundingClientRect();
    return (
      rect != null &&
      x >= rect.left && x <= rect.right &&
      y >= rect.top && y <= rect.bottom
    );
  };

  const handleTodoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, width: rect.width };
  };

  const handleTodoDragStart = (task: WorkTask, x: number, y: number) => {
    draggedRef.current = true;
    abortRef.current = false;
    pointRef.current = { x, y };
    setDrag({ task, width: dragRef.current?.width ?? 280 });
  };

  const handleTodoDragMove = (x: number, y: number) => {
    pointRef.current = { x, y };
    positionGhost(x, y);
    const over = pointerOverInProgress(x, y);
    if (over !== dropArmed) setDropArmed(over);
  };

  const clearDrag = useCallback((latchNow: boolean) => {
    setDrag(null);
    setDropArmed(false);
    if (latchNow) {
      draggedRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      draggedRef.current = false;
    });
  }, [setDrag, setDropArmed]);

  const abortDrag = useCallback(() => {
    abortRef.current = true;
    setDragOrder(null);
    clearDrag(true);
  }, [clearDrag, setDragOrder]);

  useEffect(() => {
    if (!drag) return;
    const onVisibility = () => {
      if (document.hidden) abortDrag();
    };
    window.addEventListener("blur", abortDrag);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", abortDrag);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [drag, abortDrag]);

  // The dragged card left the pending column under us.
  useEffect(() => {
    if (drag && !todoTasks.some((task) => task.id === drag.task.id)) {
      abortDrag();
    }
  }, [drag, todoTasks, abortDrag]);

  const handleTodoDragEnd = useCallback(
    (task: WorkTask, x: number, y: number) => {
      if (abortRef.current) {
        clearDrag(true);
        setDragOrder(null);
        return;
      }
      const rect = inProgressColRef.current?.getBoundingClientRect();
      const droppedOnInProgress =
        rect != null &&
        x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom;
      clearDrag(false);
      if (droppedOnInProgress) {
        setDragOrder(null);
        // The row may have advanced during the drag; only start when still todo.
        const live = tasks.find((row) => row.id === task.id);
        if (live?.status === "todo" && folderFilter != null) {
          void act(() => taskAction(task.id, task.projectRoot, "start"));
        }
        return;
      }
      const order = dragOrderRef.current;
      if (folderFilter != null && order != null) {
        void (async () => {
          try {
            await taskReorder(folderFilter, order);
          } catch (error) {
            console.error("reorder failed", error);
          }
          await refetch();
          setDragOrder(null);
        })();
      }
    },
    [act, clearDrag, folderFilter, refetch, tasks],
  );

  const startAll = useCallback(() => {
    void act(async () => {
      const claimed = await taskStartAll(folderFilter);
      if (claimed > 0) console.log(`started ${claimed} tasks`);
    });
  }, [act, folderFilter]);

  const archiveAllDone = useCallback(() => {
    const targets = columns.done.filter((task) => task.archivedAt == null);
    if (targets.length === 0) return;
    void act(() =>
      Promise.all(targets.map((task) => taskArchive(task.id, task.projectRoot, true))),
    );
  }, [act, columns.done]);

  const activeFilters =
    (boardFilter.showCanceled === DEFAULT_FILTER.showCanceled ? 0 : 1) +
    (boardFilter.showArchived === DEFAULT_FILTER.showArchived ? 0 : 1);
  const hasAnyTask = tasks.length > 0;

  // Projects selectable in the board: those with tasks + the active project.
  const allProjects = useMemo(() => {
    const set = new Set<string>(projects);
    if (activeProject) set.add(activeProject);
    return [...set].sort();
  }, [projects, activeProject]);

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProjects) {
      map.set(p, p.split("/").filter(Boolean).pop() ?? p);
    }
    return map;
  }, [allProjects]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      {hasAnyTask && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "14px 16px 8px" }}>
          {/* Project filter */}
          <select
            value={folderFilter ?? ALL_FOLDERS}
            onChange={(e) => setFolderFilter(e.target.value === ALL_FOLDERS ? null : e.target.value)}
            style={{
              height: 30, borderRadius: 999, padding: "0 10px",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 12, fontWeight: 500, cursor: "pointer",
              maxWidth: "14rem",
            }}
            aria-label={t("tasks.allFolders")}
          >
            <option value={ALL_FOLDERS}>{t("tasks.allFolders")}</option>
            {allProjects.map((p) => (
              <option key={p} value={p}>{projectNames.get(p) ?? p}</option>
            ))}
          </select>

          {/* Filter popover (inline) */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 30, borderRadius: 999, padding: "0 12px",
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >
              <FunnelSimple size={13} aria-hidden="true" />
              {t("tasks.filter")}
              {activeFilters > 0 ? (
                <span style={{ borderRadius: 999, background: "rgba(37,99,235,0.12)", color: "var(--accent)", padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                  {activeFilters}
                </span>
              ) : null}
            </button>
            {filterOpen && (
              <div
                style={{
                  position: "absolute", top: 34, left: 0, zIndex: 50,
                  width: 200, borderRadius: 12, padding: 6,
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
                }}
              >
                {(
                  [
                    ["showCanceled", t("tasks.showCanceled")],
                    ["showArchived", t("tasks.showArchived")],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={boardFilter[key]}
                      onChange={(e) => setBoardFilter((f) => ({ ...f, [key]: e.target.checked }))}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={startAll}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              height: 30, borderRadius: 999, padding: "0 12px",
              background: "none", border: "none", color: "var(--text)",
              fontSize: 12, cursor: "pointer",
            }}
            title={t("tasks.startAll")}
          >
            <Play size={13} aria-hidden="true" />
            {t("tasks.startAll")}
          </button>
          <button
            type="button"
            onClick={openNewTask}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              height: 30, borderRadius: 999, padding: "0 14px",
              background: "var(--accent)", color: "#fff",
              border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Plus size={13} weight="bold" aria-hidden="true" />
            {t("tasks.new")}
          </button>
        </div>
      )}

      {/* Board */}
      {!hasAnyTask ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, textAlign: "center" }}>
          <SquaresFour size={40} color="var(--text-dim)" opacity={0.4} aria-hidden="true" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{t("tasks.empty")}</p>
            <p style={{ maxWidth: 320, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("tasks.emptyHint")}</p>
          </div>
          <button
            type="button"
            onClick={openNewTask}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: "var(--accent)", color: "#fff",
              border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Plus size={13} weight="bold" aria-hidden="true" />
            {t("tasks.new")}
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, minWidth: "56rem", height: "100%", padding: "4px 16px 16px" }}>
            {BOARD_COLUMN_IDS.map((col) => {
              const colTasks = col === "todo" ? todoTasks : columns[col];
              const meta = COLUMN_META[col];
              const cardFor = (task: WorkTask) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  folderName={task.projectRoot ? (projectNames.get(task.projectRoot) ?? null) : null}
                  now={now}
                  onOpen={() => {
                    if (draggedRef.current) return;
                    setDetailTaskId(task.id);
                  }}
                  onStart={() => void act(() => taskAction(task.id, task.projectRoot, "start"))}
                  onCancel={() => void act(() => taskAction(task.id, task.projectRoot, "cancel"))}
                  onRetry={() => void act(() => taskAction(task.id, task.projectRoot, "retry"))}
                  onRequeue={() => void act(() => taskAction(task.id, task.projectRoot, "requeue"))}
                  onViewSession={() => openSession(task)}
                  onMerge={() => openMerge(task)}
                  onArchive={() => void act(() => taskArchive(task.id, task.projectRoot, task.archivedAt == null))}
                  onEdit={() => {
                    setEditorTask(task);
                    setEditorOpen(true);
                  }}
                />
              );
              return (
                <div
                  key={col}
                  ref={col === "inProgress" ? inProgressColRef : undefined}
                  style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 8 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24, flexShrink: 0, padding: "0 2px" }}>
                    <span style={{ width: 3, height: 14, borderRadius: 999, background: meta.marker, flexShrink: 0 }} aria-hidden="true" />
                    <h2 style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {t(columnLabelKey(col))}
                    </h2>
                    <span style={{ borderRadius: 999, background: "var(--bg-hover)", padding: "1px 8px", fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>
                      {colTasks.length}
                    </span>
                    <div style={{ flex: 1 }} />
                    {col === "done" && columns.done.some((task) => task.archivedAt == null) ? (
                      <button
                        type="button"
                        onClick={archiveAllDone}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-muted)", padding: "2px 6px", borderRadius: 6 }}
                      >
                        {t("tasks.archiveAllDone")}
                      </button>
                    ) : null}
                  </div>
                  {colTasks.length === 0 ? (
                    <div
                      style={{
                        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        gap: 4, borderRadius: 12, border: "1px dashed var(--border)",
                        padding: 16, textAlign: "center",
                        ...(col === "inProgress" && drag
                          ? dropArmed
                            ? { borderColor: "var(--accent)", background: "rgba(37,99,235,0.08)" }
                            : { borderColor: "var(--accent)" }
                          : {}),
                      }}
                    >
                      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t(emptyLabelKey(col))}</p>
                    </div>
                  ) : (
                    <div
                      style={{
                        flex: 1, minHeight: 0, overflowY: "auto", borderRadius: 12,
                        transition: "background 0.15s, box-shadow 0.15s",
                        ...(col === "inProgress" && drag
                          ? dropArmed
                            ? { background: "rgba(37,99,235,0.06)", boxShadow: "inset 0 0 0 2px var(--accent)" }
                            : { boxShadow: "inset 0 0 0 1px rgba(37,99,235,0.25)" }
                          : {}),
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
                        {colTasks.map((task) =>
                          col === "todo" ? (
                            <div
                              key={task.id}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                handleTodoDragStart(task, e.clientX, e.clientY);
                              }}
                              onDrag={(e) => handleTodoDragMove(e.clientX, e.clientY)}
                              onDragEnd={(e) => handleTodoDragEnd(task, e.clientX, e.clientY)}
                              onPointerDown={handleTodoPointerDown}
                              style={{ cursor: "grab", opacity: drag?.task.id === task.id ? 0.4 : 1 }}
                            >
                              {cardFor(task)}
                            </div>
                          ) : (
                            <div key={task.id}>{cardFor(task)}</div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <TaskEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editorTask}
        defaultProject={folderFilter ?? activeProject ?? null}
        projects={allProjects}
        onSubmit={async (projectRoot, title, config) => {
          await act(async () => {
            const { createTaskApi } = await import("@/lib/task-api");
            const { updateTaskApi } = await import("@/lib/task-api");
            if (editorTask) await updateTaskApi(editorTask.id, projectRoot, { title, config });
            else await createTaskApi({ projectRoot, title, config });
          });
          setEditorOpen(false);
        }}
      />
      <TaskDetailSheet
        open={detailTaskId != null}
        onOpenChange={(o) => { if (!o) setDetailTaskId(null); }}
        task={detailTask}
        onViewSession={openSession}
        onMerge={openMerge}
        onEdit={(task) => {
          setEditorTask(task);
          setEditorOpen(true);
        }}
      />
      <TaskMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        task={mergeTask}
      />
      <TaskTranscriptDialog
        open={sessionOpen && sessionTask != null}
        onOpenChange={setSessionOpen}
        task={sessionTask}
      />
      <TaskSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectRoot={folderFilter}
      />

      {/* Drag preview */}
      {drag
        ? createPortal(
            <div
              ref={ghostRef}
              style={{
                position: "fixed", left: 0, top: 0, zIndex: 999, pointerEvents: "none",
                width: drag.width, willChange: "transform",
              }}
              aria-hidden="true"
            >
              <div style={{
                display: "flex", flexDirection: "column", gap: 8,
                borderRadius: 12, border: dropArmed ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: "var(--bg-panel)", padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                transform: "rotate(-1deg)",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ minWidth: 0, overflowWrap: "break-word", fontSize: 13, fontWeight: 500 }}>
                    {drag.task.title}
                  </span>
                  <StatusChip task={drag.task} />
                </div>
                {dropArmed ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>
                    <Play size={11} weight="bold" aria-hidden="true" />
                    {t("tasks.dropToStart")}
                  </span>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
