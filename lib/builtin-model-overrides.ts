/**
 * Pure helpers for persisting builtin-provider model overlays into models.json.
 * Only models the user actually modified are written, so the builtin catalog
 * keeps driving everything else (SDK merges config.models over builtins by id).
 */

export interface OverrideDraft {
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
}

export type OverrideEntry = Record<string, unknown> & OverrideDraft & { id: string };

/** Build overlay entries for dirty model ids, dropping empty/undefined values. */
export function buildOverrideEntries(
  dirtyIds: string[],
  drafts: Record<string, OverrideDraft>,
): OverrideEntry[] {
  const entries: OverrideEntry[] = [];
  for (const id of dirtyIds) {
    const draft = drafts[id];
    if (!draft) continue;
    const entry: OverrideEntry = { id };
    if (typeof draft.reasoning === "boolean") entry.reasoning = draft.reasoning;
    if (typeof draft.contextWindow === "number" && draft.contextWindow > 0) {
      entry.contextWindow = draft.contextWindow;
    }
    if (typeof draft.maxTokens === "number" && draft.maxTokens > 0) {
      entry.maxTokens = draft.maxTokens;
    }
    if (
      draft.thinkingLevelMap &&
      typeof draft.thinkingLevelMap === "object" &&
      Object.keys(draft.thinkingLevelMap).length > 0
    ) {
      entry.thinkingLevelMap = draft.thinkingLevelMap;
    }
    // A dirty model with no meaningful values left marks its overlay for removal.
    entries.push(entry);
  }
  return entries;
}

/** Merge overlay entries into a providers map (models.json shape), returning a new map. */
export function mergeIntoProviders(
  providers: Record<string, Record<string, unknown>> | undefined,
  providerId: string,
  entries: OverrideEntry[],
): Record<string, Record<string, unknown>> {
  const next = { ...(providers ?? {}) };
  const existing = next[providerId] ? { ...next[providerId] } : {};
  const existingModels = Array.isArray(existing.models)
    ? (existing.models as Array<Record<string, unknown>>)
    : [];
  const dirtyIds = new Set(entries.map((e) => e.id));

  const kept = existingModels.filter((item) => !dirtyIds.has(String(item.id)));
  const merged: Array<Record<string, unknown>> = [
    ...kept,
    // Only include entries that carry actual override values; bare { id } removes the overlay.
    ...entries.filter((entry) => Object.keys(entry).length > 1),
  ];

  if (merged.length > 0) existing.models = merged;
  else delete existing.models;

  if (Object.keys(existing).length > 0) next[providerId] = existing;
  else delete next[providerId];
  return next;
}
