import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Project display aliases (项目备注) — a user-defined name per project root.
 *
 * Stored in a dedicated JSON file inside the agent dir (like trust.json) so
 * the pi SDK's settings.json rewrites can never clobber them. Keys are
 * resolved absolute project-root paths; values are trimmed single-line names.
 * An empty/missing value removes the entry (project falls back to its folder
 * name in the UI).
 */

export type ProjectAliases = Record<string, string>;

export function getProjectAliasesPath(agentDir: string): string {
  return join(agentDir, "project-aliases.json");
}

function readProjectAliases(agentDir: string): ProjectAliases {
  const path = getProjectAliasesPath(agentDir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const aliases: ProjectAliases = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim() !== "") aliases[key] = value.trim();
    }
    return aliases;
  } catch {
    return {};
  }
}

export function getProjectAliases(agentDir: string): ProjectAliases {
  return readProjectAliases(agentDir);
}

/** Set (non-empty) or remove (empty) the alias for a project root. Returns
 *  the resulting alias map. */
export function setProjectAlias(agentDir: string, cwd: string, alias: string): ProjectAliases {
  const key = resolve(cwd);
  const aliases = readProjectAliases(agentDir);
  const trimmed = alias.trim();
  if (trimmed) aliases[key] = trimmed;
  else delete aliases[key];
  writePrivateFileAtomicSync(getProjectAliasesPath(agentDir), JSON.stringify(aliases, null, 2));
  return aliases;
}
