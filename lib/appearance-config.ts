import { mutateSettingsJson, readSettingsJsonUnlocked } from "./settings-lock";
import { DEFAULT_FONT_SCALE, normalizeFontScale, resolveFontScale } from "./font-scale";

/**
 * Appearance settings that live in ~/.pi/agent/settings.json — currently the
 * global UI font scale. The chat content font size stays a browser-local
 * preference (see hooks/useChatAppearance.ts); this one scales all chrome.
 */
export interface AppearanceConfig {
  /** Global UI type scale; 1 is the product default (see lib/font-scale.ts). */
  fontScale: number;
}

function readSettingsJson(): Record<string, unknown> {
  return readSettingsJsonUnlocked();
}

/** Appearance config from ~/.pi/agent/settings.json. */
export function readAppearanceConfig(): AppearanceConfig {
  const raw = readSettingsJson();
  return {
    fontScale: resolveFontScale({
      fontScale: raw.fontScale,
      fontSize: raw.fontSize,
    }),
  };
}

/** Persist the global font scale into settings.json (locked atomic write). */
export async function writeFontScale(value: number): Promise<AppearanceConfig> {
  const fontScale = normalizeFontScale(value);
  await mutateSettingsJson((settings) => {
    settings.fontScale = fontScale;
    return { settings };
  });
  return { fontScale: fontScale || DEFAULT_FONT_SCALE };
}
