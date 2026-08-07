import {
  mutateSettingsJson,
  readSettingsJsonUnlocked,
} from "./settings-lock";

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


function readSettingsJson(): Record<string, unknown> {
  return readSettingsJsonUnlocked();
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

/** Persist feature toggles into ~/.pi/agent/settings.json (locked atomic write). */
export async function writeFeaturesConfig(config: FeaturesConfig): Promise<void> {
  await mutateSettingsJson((settings) => {
    settings[FEATURES_KEY] = config;
    return { settings };
  });
}
