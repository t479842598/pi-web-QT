import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface FeaturesConfig {
  /** Whether the Tasks board (Beta) is enabled and shown in the app. */
  tasksBoard: boolean;
}

const FEATURES_KEY = "features";

function defaultFeaturesConfig(): FeaturesConfig {
  return {
    tasksBoard: true,
  };
}

function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function readSettingsJson(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Feature toggles from ~/.pi/agent/settings.json (`features` key). */
export function readFeaturesConfig(): FeaturesConfig {
  const raw = readSettingsJson()[FEATURES_KEY] as Record<string, unknown> | undefined;
  const defaults = defaultFeaturesConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  return {
    tasksBoard: typeof raw.tasksBoard === "boolean" ? raw.tasksBoard : defaults.tasksBoard,
  };
}

/** Persist feature toggles into ~/.pi/agent/settings.json (atomic write). */
export function writeFeaturesConfig(config: FeaturesConfig): void {
  const settings = readSettingsJson();
  settings[FEATURES_KEY] = config;
  writePrivateFileAtomicSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}
