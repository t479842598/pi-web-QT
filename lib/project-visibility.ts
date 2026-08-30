import { join, resolve } from "node:path";
import { projectIdentityKey } from "./project-identity";
import { readJsonStoreUnlocked, mutateJsonStore } from "./locked-json-store";

/**
 * Project visibility (移除项目) — a server-side blacklist of project roots
 * hidden from the sidebar project panel. Hiding never touches files on disk
 * and never affects direct session URLs or tabs; it only filters the derived
 * project list. Re-adding the folder via the picker, or restoring it from the
 * hidden list, unhides it.
 *
 * Keys are projectIdentityKey(resolved projectRoot) so Windows case
 * differences and trailing separators collapse onto one entry.
 */

export interface HiddenProject {
  path: string;
  name: string;
  hiddenAt: string;
}

export interface ProjectVisibility {
  hidden: Record<string, HiddenProject>;
}

export function getProjectVisibilityPath(agentDir: string): string {
  return join(agentDir, "project-visibility.json");
}

function parseVisibility(raw: unknown): ProjectVisibility {
  const out: ProjectVisibility = { hidden: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const hidden = (raw as { hidden?: unknown }).hidden;
  if (!hidden || typeof hidden !== "object" || Array.isArray(hidden)) return out;
  for (const [key, value] of Object.entries(hidden as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as { path?: unknown; name?: unknown; hiddenAt?: unknown };
    if (typeof entry.path !== "string" || !entry.path) continue;
    out.hidden[key] = {
      path: entry.path,
      name: typeof entry.name === "string" ? entry.name : "",
      hiddenAt: typeof entry.hiddenAt === "string" ? entry.hiddenAt : "",
    };
  }
  return out;
}

export function readProjectVisibility(agentDir: string): ProjectVisibility {
  return readJsonStoreUnlocked(getProjectVisibilityPath(agentDir), parseVisibility);
}

export function listHiddenProjects(agentDir: string): Array<HiddenProject & { key: string }> {
  const visibility = readProjectVisibility(agentDir);
  return Object.entries(visibility.hidden).map(([key, entry]) => ({ key, ...entry }));
}

export async function hideProject(
  agentDir: string,
  projectRoot: string,
  name: string,
): Promise<ProjectVisibility> {
  const key = projectIdentityKey(resolve(projectRoot));
  const { value } = await mutateJsonStore(getProjectVisibilityPath(agentDir), parseVisibility, (current) => {
    if (current.hidden[key]) return { value: current, changed: false };
    return {
      value: {
        hidden: {
          ...current.hidden,
          [key]: { path: resolve(projectRoot), name: name.trim(), hiddenAt: new Date().toISOString() },
        },
      },
    };
  });
  return value;
}

export async function unhideProject(agentDir: string, projectRoot: string): Promise<ProjectVisibility> {
  const key = projectIdentityKey(resolve(projectRoot));
  const { value } = await mutateJsonStore(getProjectVisibilityPath(agentDir), parseVisibility, (current) => {
    if (!(key in current.hidden)) return { value: current, changed: false };
    const hidden = { ...current.hidden };
    delete hidden[key];
    return { value: { hidden } };
  });
  return value;
}
