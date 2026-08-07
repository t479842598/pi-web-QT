// ============================================================================
// Mode & permission settings persistence (~/.pi/agent/settings.json `modes`).
// Shared by the RPC wrapper (server-side defaults) and the web UI (client).
// Mirrors the existing features-config read/write pattern.
// ============================================================================

import {
  mutateSettingsJson,
  readSettingsJsonUnlocked,
} from "./settings-lock";
import {
  normalizeCollaborationMode,
  normalizeTokenMode,
  normalizeToolApprovalMode,
  type ModeSettings,
  defaultModeSettings,
} from "./modes";
import { policyFromStrings, policyToStrings, type Policy } from "./permission";

export type { ModeSettings };

export { defaultModeSettings };

const MODES_KEY = "modes";


function readSettingsJson(): Record<string, unknown> {
  return readSettingsJsonUnlocked();
}

/** Mode & permission settings from ~/.pi/agent/settings.json (`modes` key). */
export function readModeSettings(): ModeSettings {
  const defaults = defaultModeSettings();
  const raw = readSettingsJson()[MODES_KEY] as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const rulesRaw = raw.permissionRules as
    | { allow?: string[]; ask?: string[]; deny?: string[] }
    | undefined;
  const rules = policyToStrings(policyFromStrings(rulesRaw));
  return {
    collaborationMode: normalizeCollaborationMode(raw.collaborationMode),
    tokenMode: normalizeTokenMode(raw.tokenMode),
    toolApprovalMode: normalizeToolApprovalMode(raw.toolApprovalMode),
    permissionRules: {
      allow: Array.isArray(rules.allow) ? rules.allow : [],
      ask: Array.isArray(rules.ask) ? rules.ask : [],
      deny: Array.isArray(rules.deny) ? rules.deny : [],
    },
  };
}

/** Persist mode & permission settings into settings.json (locked atomic write). */
export async function writeModeSettings(settings: ModeSettings): Promise<void> {
  await mutateSettingsJson((file) => {
    file[MODES_KEY] = {
      collaborationMode: normalizeCollaborationMode(settings.collaborationMode),
      tokenMode: normalizeTokenMode(settings.tokenMode),
      toolApprovalMode: normalizeToolApprovalMode(settings.toolApprovalMode),
      permissionRules: settings.permissionRules,
    };
    return { settings: file };
  });
}

export { type Policy };
