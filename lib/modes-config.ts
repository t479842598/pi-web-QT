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
const MODES_PER_SESSION_KEY = "modesPerSession";


function readSettingsJson(): Record<string, unknown> {
  return readSettingsJsonUnlocked();
}

/** Normalize a raw `modes`-shaped record into a validated ModeSettings. */
function normalizeModeRecord(raw: Record<string, unknown> | undefined): ModeSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
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

/**
 * Mode & permission settings from ~/.pi/agent/settings.json.
 *
 * Without a sessionId: the global `modes` key (new-session defaults).
 * With a sessionId: that session's override (modesPerSession[sessionId]) when
 * one exists, otherwise the global `modes` record.
 */
export function readModeSettings(sessionId?: string | null): ModeSettings {
  const defaults = defaultModeSettings();
  const settings = readSettingsJson();

  // Per-session override wins for an existing session.
  if (sessionId) {
    const perSession = settings[MODES_PER_SESSION_KEY] as
      | Record<string, unknown>
      | undefined;
    if (perSession && typeof perSession === "object" && !Array.isArray(perSession)) {
      const override = normalizeModeRecord(perSession[sessionId] as Record<string, unknown> | undefined);
      if (override) return override;
    }
  }

  const global = normalizeModeRecord(settings[MODES_KEY] as Record<string, unknown> | undefined);
  return global ?? defaults;
}

/**
 * Persist mode & permission settings into settings.json (locked atomic write).
 *
 * Without a sessionId: writes the global `modes` key (new-session defaults).
 * With a sessionId: writes modesPerSession[sessionId] and leaves global intact.
 */
export async function writeModeSettings(settings: ModeSettings, sessionId?: string | null): Promise<void> {
  const record: Record<string, unknown> = {
    collaborationMode: normalizeCollaborationMode(settings.collaborationMode),
    tokenMode: normalizeTokenMode(settings.tokenMode),
    toolApprovalMode: normalizeToolApprovalMode(settings.toolApprovalMode),
    permissionRules: settings.permissionRules,
  };
  await mutateSettingsJson((file) => {
    if (sessionId) {
      const perSession = (file[MODES_PER_SESSION_KEY] ?? {}) as Record<string, unknown>;
      perSession[sessionId] = record;
      file[MODES_PER_SESSION_KEY] = perSession;
    } else {
      file[MODES_KEY] = record;
    }
    return { settings: file };
  });
}

export { type Policy };
