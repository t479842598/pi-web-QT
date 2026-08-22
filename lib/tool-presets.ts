export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

// Upstream names the analysis-only preset "read-only"; this fork exposes the
// same toolset as "plan" for plan mode — one concept, fork-side name wins.
export const TOOL_PRESET_VALUES = ["none", "default", "full", "plan"] as const;
export type ToolPreset = typeof TOOL_PRESET_VALUES[number];

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ["read", "grep", "find", "ls"];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];
/** Read-only preset for plan mode — analysis only, no file mutation. */
export const PRESET_PLAN: string[] = ["read", "grep", "find", "ls"];

const BUILTIN_TOOL_NAMES = new Set(PRESET_FULL);

export function isToolPreset(value: unknown): value is ToolPreset {
  return typeof value === "string" && (TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const activeTools = tools.filter((t) => t.active);
  if (activeTools.length === 0) return "none";

  const active = activeTools
    .map((t) => t.name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_READ_ONLY].sort().join(",")) return "plan";
  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

export function getToolNamesForPreset(preset: ToolPreset): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "full") return [...PRESET_FULL];
  if (preset === "plan") return [...PRESET_PLAN];
  return [...PRESET_DEFAULT];
}
