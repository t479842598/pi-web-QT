/**
 * JSONL storage layer for the Task Board feature.
 *
 * Layout under `~/.pi/agent/tasks/`:
 *   <encoded-project-root>/tasks.jsonl    — one JSON object per line (a WorkTask)
 *   <encoded-project-root>/events.jsonl   — one JSON object per line (a WorkTaskEvent)
 *   settings.json                          — per-project task settings
 *   templates.jsonl                        — saved task templates (global)
 *
 * Tasks are small (<1000 per project), so mutations read the whole file,
 * apply the change in memory, and atomically rewrite it (tmp+rename via
 * `writePrivateFileAtomicSync`). Events are pure append.
 *
 * A single engine process owns the writes (the task engine holds the only
 * writer role); readers tolerate a briefly-inconsistent file.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { normalizeFilePathSlashes } from "./file-paths";
import {
  defaultTaskSettings,
  type WorkTask,
  type WorkTaskEvent,
  type WorkTaskFolderSettings,
  type WorkTaskTemplate,
} from "./task-types";

// ─── Path helpers ───────────────────────────────────────────────────────────

/** Sanitize an absolute project root into a safe directory name. */
export function encodeProjectDir(projectRoot: string): string {
  const normalized = normalizeFilePathSlashes(projectRoot).replace(/^\/+/, "");
  const encoded = normalized
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("--");
  return encoded || "root";
}

export function getTasksRootDir(): string {
  return join(getAgentDir(), "tasks");
}

export function getProjectTasksDir(projectRoot: string): string {
  return join(getTasksRootDir(), encodeProjectDir(projectRoot));
}

export function getTasksFile(projectRoot: string): string {
  return join(getProjectTasksDir(projectRoot), "tasks.jsonl");
}

export function getEventsFile(projectRoot: string): string {
  return join(getProjectTasksDir(projectRoot), "events.jsonl");
}

export function getSettingsFile(): string {
  return join(getTasksRootDir(), "settings.json");
}

export function getTemplatesFile(): string {
  return join(getTasksRootDir(), "templates.jsonl");
}

/** All project roots that currently have a tasks directory. */
export function listTaskProjects(): string[] {
  const root = getTasksRootDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "__engine__")
    .map((e) => decodeProjectDir(e.name));
}

function decodeProjectDir(name: string): string {
  // Reverses encodeProjectDir's "segments joined by --".
  return "/" + name.split("--").map((seg) => decodeURIComponent(seg)).join("/");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── JSONL read/write helpers ───────────────────────────────────────────────

function readJsonLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip corrupt lines; a full corruption is handled by the caller via
      // loadTasks() returning what survived.
    }
  }
  return rows;
}

function writeJsonLines<T>(file: string, rows: T[]): void {
  ensureDir(file.substring(0, file.lastIndexOf("/")));
  const contents = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writePrivateFileAtomicSync(file, contents);
}

function appendJsonLine<T>(file: string, row: T): void {
  ensureDir(file.substring(0, file.lastIndexOf("/")));
  // Append is not atomic by itself, but a torn tail line is skipped by the
  // reader; the engine is the only writer.
  writeFileSync(file, JSON.stringify(row) + "\n", {
    encoding: "utf8",
    flag: "a",
    mode: 0o600,
  });
}

// ─── Task CRUD ──────────────────────────────────────────────────────────────

const GLOBAL_TASKS_KEY = "__piTaskStore";

interface TaskStoreState {
  nextId: number;
}

function getState(): TaskStoreState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_TASKS_KEY]) {
    g[GLOBAL_TASKS_KEY] = { nextId: 1 };
  }
  return g[GLOBAL_TASKS_KEY] as TaskStoreState;
}

/** Highest id seen across all projects (persisted across restarts by
 *  scanning files at boot). Called lazily; cheap enough. */
function computeNextId(): number {
  const root = getTasksRootDir();
  if (!existsSync(root)) return 1;
  let max = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "tasks.jsonl");
    if (!existsSync(file)) continue;
    for (const task of readJsonLines<WorkTask>(file)) {
      if (task.id > max) max = task.id;
    }
  }
  return max + 1;
}

function nextTaskId(): number {
  const state = getState();
  if (state.nextId <= 1) state.nextId = computeNextId();
  return state.nextId++;
}

export function loadTasks(projectRoot: string): WorkTask[] {
  const rows = readJsonLines<WorkTask>(getTasksFile(projectRoot));
  // Sanity: normalize any legacy snake_case rows (future-proofing).
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function loadTask(projectRoot: string, id: number): WorkTask | null {
  return loadTasks(projectRoot).find((t) => t.id === id) ?? null;
}

export function saveTask(task: WorkTask): void {
  const file = getTasksFile(task.projectRoot);
  const tasks = loadTasks(task.projectRoot);
  const idx = tasks.findIndex((t) => t.id === task.id);
  const next = { ...task, updatedAt: new Date().toISOString() };
  if (idx >= 0) tasks[idx] = next;
  else tasks.push(next);
  writeJsonLines(file, tasks);
}

export function deleteTaskRow(projectRoot: string, id: number): void {
  const file = getTasksFile(projectRoot);
  const tasks = loadTasks(projectRoot).filter((t) => t.id !== id);
  writeJsonLines(file, tasks);
}

export function createTaskRow(
  projectRoot: string,
  make: (id: number, now: string) => WorkTask,
): WorkTask {
  const id = nextTaskId();
  const now = new Date().toISOString();
  const task = { ...make(id, now), projectRoot };
  saveTask(task);
  return task;
}

// ─── Events ─────────────────────────────────────────────────────────────────

export function appendTaskEvent(
  projectRoot: string,
  event: Omit<WorkTaskEvent, "id" | "createdAt" | "payload"> & { payload?: Record<string, unknown> | null },
): WorkTaskEvent {
  const file = getEventsFile(projectRoot);
  const prev = readJsonLines<WorkTaskEvent>(file);
  const id = prev.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  const row: WorkTaskEvent = {
    ...event,
    payload: event.payload ?? null,
    id,
    createdAt: new Date().toISOString(),
  };
  appendJsonLine(file, row);
  return row;
}

export function loadTaskEvents(projectRoot: string, taskId: number, limit = 500): WorkTaskEvent[] {
  const rows = readJsonLines<WorkTaskEvent>(getEventsFile(projectRoot));
  const filtered = rows.filter((e) => e.taskId === taskId);
  return filtered.slice(-limit);
}

// ─── Settings ───────────────────────────────────────────────────────────────

interface SettingsFile {
  _global?: WorkTaskFolderSettings;
  [projectRoot: string]: WorkTaskFolderSettings | undefined;
}

export function loadSettingsRow(projectRoot: string): WorkTaskFolderSettings | null {
  const file = getSettingsFile();
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    return data[projectRoot] ?? null;
  } catch {
    return null;
  }
}

export function loadGlobalSettings(): WorkTaskFolderSettings {
  const file = getSettingsFile();
  if (!existsSync(file)) return defaultTaskSettings();
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    return { ...defaultTaskSettings(), ...(data._global ?? {}) };
  } catch {
    return defaultTaskSettings();
  }
}

/** Effective settings after the project → global → built-in fallback. */
export function loadEffectiveSettings(projectRoot: string): WorkTaskFolderSettings {
  const own = loadSettingsRow(projectRoot);
  const global = loadGlobalSettings();
  if (!own) return global;
  return {
    ...global,
    ...own,
    configValues: { ...global.configValues, ...(own.configValues ?? {}) },
  };
}

export function saveSettingsRow(projectRoot: string, settings: WorkTaskFolderSettings): void {
  const file = getSettingsFile();
  let data: SettingsFile = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    } catch {
      data = {};
    }
  }
  data[projectRoot] = settings;
  ensureDir(getTasksRootDir());
  writePrivateFileAtomicSync(file, JSON.stringify(data, null, 2));
}

export function deleteSettingsRow(projectRoot: string): void {
  const file = getSettingsFile();
  if (!existsSync(file)) return;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    delete data[projectRoot];
    writePrivateFileAtomicSync(file, JSON.stringify(data, null, 2));
  } catch {
    // leave as-is
  }
}

export function saveGlobalSettings(settings: WorkTaskFolderSettings): void {
  const file = getSettingsFile();
  let data: SettingsFile = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    } catch {
      data = {};
    }
  }
  data._global = settings;
  ensureDir(getTasksRootDir());
  writePrivateFileAtomicSync(file, JSON.stringify(data, null, 2));
}

// ─── Templates ──────────────────────────────────────────────────────────────

export function listTemplates(): WorkTaskTemplate[] {
  return readJsonLines<WorkTaskTemplate>(getTemplatesFile());
}

export function saveTemplate(template: WorkTaskTemplate): void {
  const rows = listTemplates();
  const idx = rows.findIndex((t) => t.id === template.id);
  if (idx >= 0) rows[idx] = template;
  else rows.push(template);
  writeJsonLines(getTemplatesFile(), rows);
}

export function deleteTemplateRow(id: number): void {
  const rows = listTemplates().filter((t) => t.id !== id);
  writeJsonLines(getTemplatesFile(), rows);
}
