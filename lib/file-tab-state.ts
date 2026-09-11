/**
 * Persistence for the right-panel file/terminal tab strip.
 *
 * The tabs used to live only in AppShell state, so a page refresh discarded
 * every open file. This module is the client-side (de)serializer: it validates
 * everything it reads back, because the stored value is user-editable
 * localStorage that may also come from an older build.
 */

import type { Tab } from "@/components/TabBar";

export const FILE_TABS_KEY = "pi-web:file-tabs";

interface StoredFileTabs {
  tabs: Tab[];
  activeId: string | null;
  open: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize the tab strip. `open` mirrors whether the right panel is visible. */
export function serializeFileTabs(tabs: Tab[], activeId: string | null, open: boolean): string {
  return JSON.stringify({
    tabs: tabs
      // A tab mid-close is transient UI state; never persist it.
      .filter((tab) => !tab.closing)
      .map((tab) => ({
        id: tab.id,
        label: tab.label,
        filePath: tab.filePath,
        ...(tab.kind ? { kind: tab.kind } : {}),
        ...(tab.sessionId ? { sessionId: tab.sessionId } : {}),
        ...(tab.sourceSessionId ? { sourceSessionId: tab.sourceSessionId } : {}),
        ...(tab.initialDisplayMode ? { initialDisplayMode: tab.initialDisplayMode } : {}),
      })),
    activeId,
    open,
  });
}

/**
 * Restore the tab strip. Anything malformed is dropped rather than surfaced:
 * a stale tab whose file no longer exists is handled by the viewer itself
 * (it shows its own error), which is less surprising than silently losing the
 * whole strip.
 */
export function restoreFileTabs(raw: string | null): StoredFileTabs {
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!isRecord(saved)) return { tabs: [], activeId: null, open: false };

    const tabs: Tab[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(saved.tabs) ? saved.tabs : []) {
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === "string" ? entry.id : "";
      const filePath = typeof entry.filePath === "string" ? entry.filePath : "";
      const label = typeof entry.label === "string" ? entry.label : "";
      const isSubagent = entry.kind === "subagent";
      const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
      // A subagent tab is anchored to its session id, not a file path; every
      // other tab still requires a file path.
      if (!id || !label || seen.has(id)) continue;
      if (isSubagent ? !sessionId : !filePath) continue;
      seen.add(id);
      tabs.push({
        id,
        label,
        filePath,
        ...(entry.kind === "terminal" ? { kind: "terminal" as const } : {}),
        ...(isSubagent ? { kind: "subagent" as const, sessionId } : {}),
        ...(typeof entry.sourceSessionId === "string" ? { sourceSessionId: entry.sourceSessionId } : {}),
        ...(entry.initialDisplayMode === "diff" ? { initialDisplayMode: "diff" as const } : {}),
      });
    }

    const activeId = typeof saved.activeId === "string" && tabs.some((tab) => tab.id === saved.activeId)
      ? saved.activeId
      : tabs[tabs.length - 1]?.id ?? null;

    return { tabs, activeId, open: saved.open === true && tabs.length > 0 };
  } catch {
    return { tabs: [], activeId: null, open: false };
  }
}
