/**
 * Persisted policy for non-builtin ("extension") tools.
 *
 * Background: `withExtensionTools()` force-adds every tool the SDK registry
 * exposes that is not a coding builtin. That keeps extension/MCP tools usable
 * regardless of the composer's tool preset — which is deliberate, because the
 * preset dropdown is about coding tools, not about whether `Agent` or
 * `mcp_lrnev_*` exists. But it also means a read-only preset (plan mode) cannot
 * actually prevent a write-capable extension tool such as `lsp_fix` or
 * `start_supervision` from being called.
 *
 * This module stores the user's explicit exceptions instead of changing the
 * default: with no configuration, behaviour is exactly as before (every
 * extension tool is injected).
 *
 * File: `~/.pi/agent/extension-tools.json`
 *   { "version": 1, "disabled": ["lsp_fix", "start_supervision"] }
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

export const EXTENSION_TOOLS_CONFIG_VERSION = 1;

export interface ExtensionToolSettings {
  /** Extension tool names the user has switched off. */
  disabled: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getExtensionToolsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extension-tools.json");
}

/** Normalize an arbitrary parsed document into validated settings. */
export function normalizeExtensionToolSettings(raw: unknown): ExtensionToolSettings {
  if (!isRecord(raw)) return { disabled: [] };
  const disabled = Array.isArray(raw.disabled)
    ? [...new Set(raw.disabled.filter((name): name is string => typeof name === "string" && name.trim() !== "")
      .map((name) => name.trim()))]
    : [];
  return { disabled };
}

/**
 * Apply the policy to a tool list.
 *
 * Pure and dependency-free so the wrapper can call it on every activation path
 * and tests can exercise it directly. Unknown names in `disabled` are harmless:
 * an uninstalled extension simply never matches.
 */
export function filterDisabledExtensionTools(
  toolNames: readonly string[],
  settings: ExtensionToolSettings,
): string[] {
  if (settings.disabled.length === 0) return [...toolNames];
  const blocked = new Set(settings.disabled);
  return toolNames.filter((name) => !blocked.has(name));
}

export function readExtensionToolSettings(
  path = getExtensionToolsPath(),
): ExtensionToolSettings {
  if (!existsSync(path)) return { disabled: [] };
  try {
    return normalizeExtensionToolSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // A corrupt policy file must not disable every extension tool.
    return { disabled: [] };
  }
}

export async function writeExtensionToolSettings(
  settings: ExtensionToolSettings,
  path = getExtensionToolsPath(),
): Promise<ExtensionToolSettings> {
  const normalized = normalizeExtensionToolSettings(settings);
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, JSON.stringify({ version: EXTENSION_TOOLS_CONFIG_VERSION, disabled: [] }, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    writeFileSync(
      path,
      `${JSON.stringify({ version: EXTENSION_TOOLS_CONFIG_VERSION, disabled: normalized.disabled }, null, 2)}\n`,
      "utf8",
    );
    chmodSync(path, 0o600);
  } finally {
    await release();
  }
  return normalized;
}
