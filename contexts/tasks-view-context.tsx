"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { listTaskProjectsApi, listTasks } from "@/lib/task-api";
import type { WorkTask } from "@/lib/task-types";

/** Statuses that need the user ("等你处理") — drives the badge. */
const ATTENTION_STATUSES = new Set(["awaiting_input", "review", "failed"]);

interface TasksViewContextValue {
  /** Tasks of every project, in one list (each row carries projectRoot). */
  tasks: WorkTask[];
  /** Projects that have at least one task. */
  projects: string[];
  /** Count of tasks waiting on the user — the badge. */
  attentionCount: number;
  refetch: () => Promise<void>;
}

const TasksViewContext = createContext<TasksViewContextValue | null>(null);

/**
 * Data layer for the Tasks feature: the full task list across projects + a
 * realtime subscription (SSE `/api/tasks/events`), kept always-mounted so the
 * header badge stays live. Single source for both the badge and the Tasks
 * board page.
 */
export function useTasksView(): TasksViewContextValue {
  const ctx = useContext(TasksViewContext);
  if (!ctx) {
    throw new Error("useTasksView must be used within TasksViewProvider");
  }
  return ctx;
}

export function TasksViewProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  // Latest-ref so `refetch` stays referentially stable across locale changes
  // (its identity re-subscribes the SSE channel).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++reqRef.current;
    try {
      const projectList = await listTaskProjectsApi();
      setProjects(projectList);
      const lists = await Promise.all(
        projectList.map((project) => listTasks(project).catch(() => [] as WorkTask[])),
      );
      const all = lists.flat().sort((a, b) => b.id - a.id);
      // Drop stale responses; keep the previous list on transient error rather
      // than blanking the board.
      if (id !== reqRef.current) return;
      setTasks(all);
    } catch {
      // ignore — a later event/refetch recovers
    }
  }, []);

  useEffect(() => {
    // Initial fetch + SSE subscription for engine-pushed nudges.
    void refetch();
    let es: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/tasks/events");
      es.onmessage = () => {
        void refetch();
      };
      es.onerror = () => {
        // EventSource auto-reconnects; refetch once on reconnect to heal any
        // missed change.
        es?.close();
        es = null;
        void refetch();
        // Reconnect with backoff.
        setTimeout(connect, 2000);
      };
    };
    connect();

    // Events fired while the connection was down are dropped; refetch on
    // visibility/online so a task that settled during the gap doesn't leave
    // the board stale.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    const onOnline = () => void refetch();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => void refetch(), 60_000);

    return () => {
      cancelled = true;
      es?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [refetch]);

  const attentionCount = useMemo(
    () =>
      tasks.filter(
        (task) => ATTENTION_STATUSES.has(task.status) && task.archivedAt == null,
      ).length,
    [tasks],
  );

  // System notification when a task flips into review (ready for acceptance)
  // or failed. The engine runs headless, so this fetch-to-fetch diff is the
  // only place that sees the transition; the browser API stays silent while
  // the window is visible.
  const prevRef = useRef<Map<number, WorkTask["status"]> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = new Map(tasks.map((task) => [task.id, task.status]));
    if (!prev || tasks.length === 0) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    for (const task of tasks) {
      if (prev.get(task.id) === task.status) continue;
      if (task.status !== "review" && task.status !== "failed") continue;
      if (task.archivedAt != null) continue;
      if (document.visibilityState === "visible") continue;
      try {
        const label =
          task.status === "review"
            ? t("tasks.notifyReview", { title: task.title })
            : t("tasks.notifyFailed", { title: task.title });
        void sendBrowserNotification("Pi Web Tasks", label);
      } catch {
        // Notification API is best-effort.
      }
    }
  }, [tasks, t]);

  const value = useMemo<TasksViewContextValue>(
    () => ({ tasks, projects, attentionCount, refetch }),
    [tasks, projects, attentionCount, refetch],
  );

  return (
    <TasksViewContext.Provider value={value}>
      {children}
    </TasksViewContext.Provider>
  );
}

/** Browser notification, requesting permission lazily. */
function sendBrowserNotification(title: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("Notification" in window)) {
      resolve();
      return;
    }
    const send = () => {
      try {
        new Notification(title, { body, tag: "pi-tasks" });
      } catch {
        // ignore
      }
      resolve();
    };
    if (Notification.permission === "granted") {
      send();
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") send();
        else resolve();
      });
    } else {
      resolve();
    }
  });
}
