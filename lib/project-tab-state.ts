import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Project tab bar + leading-dropdown state (顶部项目 tab / 下拉选中项目),
 * shared across every device/window that talks to this pi-web server.
 *
 * Stored in a dedicated JSON file inside the agent dir (like project-aliases.json)
 * so pi's settings.json rewrites can never clobber it. The web UI keeps a
 * localStorage mirror for instant first paint, but the server file is the
 * source of truth for cross-device sync.
 */

export interface ProjectTabState {
  /** Absolute project-root paths, in display order, capped at MAX_PROJECT_TABS. */
  tabs: string[];
  /** Project pinned by the leading dropdown (the "selected project" area). */
  pinnedProject: string | null;
}

export const MAX_PROJECT_TABS = 4;

export function getProjectTabStatePath(agentDir: string): string {
  return join(agentDir, "project-tab-state.json");
}

const EMPTY: ProjectTabState = { tabs: [], pinnedProject: null };

function readRaw(agentDir: string): ProjectTabState {
  const path = getProjectTabStatePath(agentDir);
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY };
    const raw = parsed as Record<string, unknown>;
    return {
      tabs: Array.isArray(raw.tabs) ? raw.tabs.filter((p): p is string => typeof p === "string") : [],
      pinnedProject: typeof raw.pinnedProject === "string" && raw.pinnedProject !== "" ? raw.pinnedProject : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Drop tabs whose directory no longer exists (volume unmounted, project
 *  moved) and cap the list — stale paths would otherwise surface a
 *  "Directory does not exist" project-trust error when clicked. */
function sanitize(state: ProjectTabState): ProjectTabState {
  const seen = new Set<string>();
  const tabs: string[] = [];
  for (const p of state.tabs) {
    const key = resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    if (tabs.length >= MAX_PROJECT_TABS) break;
    try {
      if (existsSync(key)) tabs.push(key);
    } catch {
      // unresolvable path — skip
    }
  }
  let pinnedProject = state.pinnedProject;
  if (pinnedProject) {
    try {
      if (!existsSync(resolve(pinnedProject))) pinnedProject = null;
    } catch {
      pinnedProject = null;
    }
  }
  return { tabs, pinnedProject };
}

/** Read the current validated state. */
export function getProjectTabState(agentDir: string): ProjectTabState {
  return sanitize(readRaw(agentDir));
}

/** Apply a partial update (only the provided fields are overwritten, so two
 *  devices updating different fields never clobber each other), persist
 *  atomically and return the resulting validated state. */
export function updateProjectTabState(
  agentDir: string,
  patch: Partial<ProjectTabState>,
): ProjectTabState {
  const current = readRaw(agentDir);
  const next: ProjectTabState = {
    tabs: patch.tabs !== undefined ? patch.tabs : current.tabs,
    pinnedProject: patch.pinnedProject !== undefined ? patch.pinnedProject : current.pinnedProject,
  };
  const sanitized = sanitize(next);
  writePrivateFileAtomicSync(getProjectTabStatePath(agentDir), JSON.stringify(sanitized, null, 2));
  return sanitized;
}
