import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Global "title generation model" setting (titleModel in ~/.pi/agent/settings.json).
 *
 * Storage decision (verified by probe on 2026-08-04):
 * - SDK SettingsManager DROPS unknown fields passed via applyOverrides() —
 *   they never reach settings.json.
 * - SDK KEEPS unknown fields already present in settings.json on load and
 *   preserves them across flush() (it only persists fields it manages).
 * Therefore we write the field directly with an atomic read-merge-write and
 * read it straight from the file. This coexists safely with SettingsManager.
 */

const TITLE_MODEL_KEY = "titleModel";

export interface TitleModelOption {
  provider: string;
  id: string;
  reasoning: boolean;
  label: string;
  name?: string;
}

export interface TitleModelData {
  value: string | null;
  models: TitleModelOption[];
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

/** Current global title model (`provider/modelId`) or null when unset. */
export function getTitleModel(): string | null {
  const value = readSettingsJson()[TITLE_MODEL_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Set (or clear with null) the global title model. */
export function setTitleModel(value: string | null): void {
  const settings = readSettingsJson();
  if (value === null || value === "") {
    delete settings[TITLE_MODEL_KEY];
  } else {
    settings[TITLE_MODEL_KEY] = value;
  }
  writePrivateFileAtomicSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

export function readModelsJson(): Record<string, unknown> {
  const path = join(getAgentDir(), "models.json");
  if (!existsSync(path)) return { providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

interface ProviderEntry {
  models?: Array<{ id?: unknown; reasoning?: unknown }>;
}

/**
 * Flatten models.json providers into `provider/modelId` options, matching the
 * model list the ModelsConfig UI works with. Note: models.json only holds
 * custom providers — API-key/OAuth providers' models come from the SDK model
 * registry (see loadTitleModels in the route).
 */
export function flattenModels(modelsJson: Record<string, unknown>): TitleModelOption[] {
  const providers = modelsJson.providers;
  if (!providers || typeof providers !== "object") return [];
  const options: TitleModelOption[] = [];
  for (const [provider, entry] of Object.entries(providers as Record<string, unknown>)) {
    const models = (entry as ProviderEntry | undefined)?.models;
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (typeof model?.id !== "string" || model.id.length === 0) continue;
      options.push({
        provider,
        id: model.id,
        reasoning: model.reasoning === true,
        label: `${provider}/${model.id}`,
      });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Full data payload for the settings UI. */
export function getTitleModelData(): TitleModelData {
  return {
    value: getTitleModel(),
    models: flattenModels(readModelsJson()),
  };
}

/** True when value is null or matches one of the imported models. */
export function isKnownTitleModel(value: string, models: TitleModelOption[]): boolean {
  return models.some((model) => model.label === value);
}
