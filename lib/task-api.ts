/**
 * Client-side helpers for the /api/tasks* routes.
 *
 * Every route returns { ... } on success or { error: string } on failure;
 * these helpers collapse the fetch + error handling into one line per call.
 */

import type {
  WorkTask,
  WorkTaskEvent,
  WorkTaskFolderSettings,
  WorkTaskTemplate,
} from "./task-types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || (body as { error?: string }).error) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body;
}

export async function listTasks(projectRoot: string): Promise<WorkTask[]> {
  const data = await request<{ tasks: WorkTask[] }>(
    `/api/tasks?projectRoot=${encodeURIComponent(projectRoot)}`,
  );
  return data.tasks;
}

/** All project roots that currently have tasks. */
export async function listTaskProjectsApi(): Promise<string[]> {
  const data = await request<{ projects: string[] }>("/api/tasks/projects");
  return data.projects;
}

export async function createTaskApi(draft: {
  projectRoot: string;
  title: string;
  config: WorkTask["config"];
}): Promise<WorkTask> {
  const data = await request<{ task: WorkTask }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(draft),
  });
  return data.task;
}

export async function updateTaskApi(
  id: number,
  projectRoot: string,
  draft: { title: string; config: WorkTask["config"] },
): Promise<WorkTask> {
  const data = await request<{ task: WorkTask }>(
    `/api/tasks/${id}?projectRoot=${encodeURIComponent(projectRoot)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ projectRoot, ...draft }),
    },
  );
  return data.task;
}

export async function deleteTaskApi(id: number, projectRoot: string, deleteWorktree = false): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}?projectRoot=${encodeURIComponent(projectRoot)}&deleteWorktree=${deleteWorktree ? 1 : 0}`,
    { method: "DELETE" },
  );
}

/** start | cancel | retry | requeue */
export async function taskAction(
  id: number,
  projectRoot: string,
  action: "start" | "cancel" | "retry" | "requeue",
  extras?: { reason?: string | null; note?: string | null },
): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}/${action}?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "POST", body: JSON.stringify({ ...extras }) },
  );
}

/** return — reviewed task back to the agent with feedback. */
export async function taskReturn(id: number, projectRoot: string, feedback: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}/return?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "POST", body: JSON.stringify({ feedback }) },
  );
}

/** merge — accept a reviewed task. */
export async function taskMerge(id: number, projectRoot: string, message: string | null, deleteWorktree: boolean): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}/merge?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "POST", body: JSON.stringify({ message, deleteWorktree }) },
  );
}

/** complete — accept a reviewed task that changed nothing (no merge). */
export async function taskComplete(id: number, projectRoot: string, deleteWorktree: boolean): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}/complete?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "POST", body: JSON.stringify({ deleteWorktree }) },
  );
}

/** archive — toggle archived state. */
export async function taskArchive(id: number, projectRoot: string, archived: boolean): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/${id}/archive?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "POST", body: JSON.stringify({ archived }) },
  );
}

/** reorder — persist the todo column's drag order. */
export async function taskReorder(projectRoot: string, orderedIds: number[]): Promise<void> {
  await request<{ ok: boolean }>("/api/tasks/batch?mode=reorder", {
    method: "POST",
    body: JSON.stringify({ projectRoot, orderedIds }),
  });
}

/** start-all — queue every todo of the project (null = all projects). */
export async function taskStartAll(projectRoot: string | null): Promise<number> {
  const data = await request<{ claimed: number }>("/api/tasks/batch?mode=start-all", {
    method: "POST",
    body: JSON.stringify({ projectRoot }),
  });
  return data.claimed;
}

export async function listTaskEvents(projectRoot: string, taskId: number, limit = 500): Promise<WorkTaskEvent[]> {
  const data = await request<{ events: WorkTaskEvent[] }>(
    `/api/tasks/${taskId}/events?projectRoot=${encodeURIComponent(projectRoot)}&limit=${limit}`,
  );
  return data.events;
}

export async function listTaskChangedFiles(projectRoot: string, taskId: number): Promise<{ files: Array<{ file: string; additions: number; deletions: number }>; additions: number; deletions: number }> {
  return request(`/api/tasks/${taskId}/changed-files?projectRoot=${encodeURIComponent(projectRoot)}`);
}

export async function getTaskDiff(projectRoot: string, taskId: number, file: string): Promise<{ supported: boolean; patch?: string; status?: string }> {
  return request(`/api/tasks/${taskId}/diff?projectRoot=${encodeURIComponent(projectRoot)}&file=${encodeURIComponent(file)}`);
}

/** Effective settings after the project → global → built-in fallback. */
export async function getTaskSettingsEffective(projectRoot: string): Promise<WorkTaskFolderSettings> {
  const data = await request<{ settings: WorkTaskFolderSettings }>(
    `/api/tasks/settings?projectRoot=${encodeURIComponent(projectRoot)}`,
  );
  return data.settings;
}

/** The project's own settings row, or null when it follows the global
 *  defaults — how the settings dialog tells the two apart. */
export async function getTaskSettingsOwn(projectRoot: string): Promise<WorkTaskFolderSettings | null> {
  const data = await request<{ settings: WorkTaskFolderSettings | null }>(
    `/api/tasks/settings?projectRoot=${encodeURIComponent(projectRoot)}&own=1`,
  );
  return data.settings;
}

export async function saveTaskSettings(projectRoot: string, settings: WorkTaskFolderSettings): Promise<void> {
  await request<{ ok: boolean }>("/api/tasks/settings", {
    method: "PUT",
    body: JSON.stringify({ projectRoot, settings }),
  });
}

export async function deleteTaskSettings(projectRoot: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/tasks/settings?projectRoot=${encodeURIComponent(projectRoot)}`,
    { method: "DELETE" },
  );
}

export async function listTaskTemplates(): Promise<WorkTaskTemplate[]> {
  const data = await request<{ templates: WorkTaskTemplate[] }>("/api/tasks/templates");
  return data.templates;
}

export async function saveTaskTemplate(draft: { name: string; title: string; config: WorkTask["config"] }): Promise<WorkTaskTemplate> {
  const data = await request<{ template: WorkTaskTemplate }>("/api/tasks/templates", {
    method: "POST",
    body: JSON.stringify(draft),
  });
  return data.template;
}

export async function deleteTaskTemplate(id: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/tasks/templates?id=${id}`, { method: "DELETE" });
}
