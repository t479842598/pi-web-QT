/**
 * Pure helpers for builtin-provider model overlays in models.json.
 *
 * New edits live in provider.modelOverrides, which pi applies field-by-field over
 * builtins. Historical provider.models entries are intentionally retained: they
 * can also define custom models or transport metadata that cannot be migrated
 * without knowing the user's intent.
 */

export const BUILTIN_OVERRIDE_FIELDS = [
  "name",
  "reasoning",
  "contextWindow",
  "maxTokens",
  "thinkingLevelMap",
  "hidden",
] as const;

export type BuiltinOverrideField = typeof BUILTIN_OVERRIDE_FIELDS[number];

export interface OverrideDraft {
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
  /** Pi ignores this extension field; pi-web uses it to filter the selector. */
  hidden?: boolean;
}

export type OverrideEntry = Record<string, unknown> & OverrideDraft & { id: string };
export type OverridePatch = Partial<Record<BuiltinOverrideField, unknown>>;
export type OverridePatches = Record<string, OverridePatch>;

type ProviderConfig = Record<string, unknown>;
type ProvidersConfig = Record<string, ProviderConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? { ...value } : {};
}

function hasMeaningfulOverride(entry: Record<string, unknown>): boolean {
  // Preserve future SDK fields that this UI does not know about.
  return Object.keys(entry).length > 0;
}

/** Read one provider's legacy models[] overlays, indexed by model id. */
export function getLegacyOverrides(provider: ProviderConfig | undefined): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const models = provider?.models;
  if (!Array.isArray(models)) return result;
  for (const item of models) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue;
    result[item.id] = { ...item };
  }
  return result;
}

/** Read one provider's current field-level modelOverrides, indexed by model id. */
export function getModelOverrides(provider: ProviderConfig | undefined): Record<string, Record<string, unknown>> {
  const raw = provider?.modelOverrides;
  if (!isRecord(raw)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, override] of Object.entries(raw)) {
    if (isRecord(override)) result[id] = { ...override };
  }
  return result;
}

/**
 * Return display values using the same precedence as the SDK: historical
 * models[] replacement first, then field-level modelOverrides.
 */
export function getEffectiveOverrides(provider: ProviderConfig | undefined): Record<string, Record<string, unknown>> {
  const legacy = getLegacyOverrides(provider);
  const current = getModelOverrides(provider);
  const ids = new Set([...Object.keys(legacy), ...Object.keys(current)]);
  const result: Record<string, Record<string, unknown>> = {};
  for (const id of ids) {
    result[id] = { ...(legacy[id] ?? {}), ...(current[id] ?? {}) };
  }
  return result;
}

/** Build sparse per-model patches from dirty drafts against their initial values. */
export function buildOverridePatches(
  dirtyIds: Iterable<string>,
  drafts: Record<string, OverrideDraft>,
  initial: Record<string, OverrideDraft>,
): OverridePatches {
  const patches: OverridePatches = {};
  for (const id of dirtyIds) {
    const next = drafts[id];
    const before = initial[id];
    if (!next || !before) continue;
    const patch: OverridePatch = {};
    for (const field of BUILTIN_OVERRIDE_FIELDS) {
      const nextValue = next[field];
      const beforeValue = before[field];
      if (JSON.stringify(nextValue) === JSON.stringify(beforeValue)) continue;
      // null is an explicit deletion marker on the PATCH wire format.
      patch[field] = nextValue === undefined ? null : nextValue;
    }
    if (Object.keys(patch).length > 0) patches[id] = patch;
  }
  return patches;
}

/**
 * Apply sparse patches to a provider's modelOverrides. Null removes one field.
 * Existing models[] entries remain untouched for backward compatibility.
 */
export function applyBuiltinOverridePatches(
  provider: ProviderConfig | undefined,
  patches: OverridePatches,
): ProviderConfig {
  const nextProvider = cloneRecord(provider);
  const overrides = getModelOverrides(provider);
  const legacyModels = Array.isArray(provider?.models)
    ? (provider.models as unknown[]).filter(isRecord).map((item) => ({ ...item }))
    : [];

  for (const [id, patch] of Object.entries(patches)) {
    const current = { ...(overrides[id] ?? {}) };
    const legacyIndex = legacyModels.findIndex((item) => item.id === id);
    const legacy = legacyIndex >= 0 ? legacyModels[legacyIndex] : undefined;
    for (const [field, rawValue] of Object.entries(patch)) {
      if (!BUILTIN_OVERRIDE_FIELDS.includes(field as BuiltinOverrideField)) continue;
      // Fields managed by this editor move to modelOverrides. Keep unrelated
      // transport/custom-model fields in a historical models[] entry.
      if (legacy) delete legacy[field];
      const value = field === "thinkingLevelMap"
        && isRecord(rawValue) && Object.keys(rawValue).length === 0
        ? null
        : rawValue;
      if (value === null) delete current[field];
      else current[field] = value;
    }
    if (legacy && Object.keys(legacy).every((key) => key === "id")) {
      legacyModels.splice(legacyIndex, 1);
    }
    if (hasMeaningfulOverride(current)) overrides[id] = current;
    else delete overrides[id];
  }

  if (legacyModels.length > 0) nextProvider.models = legacyModels;
  else if (Array.isArray(provider?.models)) delete nextProvider.models;
  if (Object.keys(overrides).length > 0) nextProvider.modelOverrides = overrides;
  else delete nextProvider.modelOverrides;
  return nextProvider;
}

/** Merge an updated provider into a models.json providers map. */
export function mergeProviderIntoProviders(
  providers: ProvidersConfig | undefined,
  providerId: string,
  provider: ProviderConfig,
): ProvidersConfig {
  const next = { ...(providers ?? {}) };
  if (Object.keys(provider).length > 0) next[providerId] = provider;
  else delete next[providerId];
  return next;
}

// Backward-compatible exports for existing callers/tests. New code should use
// buildOverridePatches/applyBuiltinOverridePatches instead.
export function buildOverrideEntries(
  dirtyIds: string[],
  drafts: Record<string, OverrideDraft>,
): OverrideEntry[] {
  const entries: OverrideEntry[] = [];
  for (const id of dirtyIds) {
    const draft = drafts[id];
    if (!draft) continue;
    const entry: OverrideEntry = { id };
    for (const field of BUILTIN_OVERRIDE_FIELDS) {
      const value = draft[field];
      if (field === "contextWindow" || field === "maxTokens") {
        if (typeof value === "number" && value > 0) entry[field] = value;
      } else if (field === "thinkingLevelMap") {
        if (value && typeof value === "object" && Object.keys(value).length > 0) entry[field] = value;
      } else if (field === "name") {
        if (typeof value === "string" && value.length > 0) entry[field] = value;
      } else if (value !== undefined) {
        (entry as Record<string, unknown>)[field] = value;
      }
    }
    entries.push(entry);
  }
  return entries;
}

export function mergeIntoProviders(
  providers: ProvidersConfig | undefined,
  providerId: string,
  entries: OverrideEntry[],
): ProvidersConfig {
  const next = { ...(providers ?? {}) };
  const existing = next[providerId] ? { ...next[providerId] } : {};
  const existingModels = Array.isArray(existing.models)
    ? (existing.models as Array<Record<string, unknown>>)
    : [];
  const dirtyIds = new Set(entries.map((entry) => entry.id));
  const kept = existingModels.filter((item) => !dirtyIds.has(String(item.id)));
  const merged = [
    ...kept,
    ...entries.filter((entry) => Object.keys(entry).length > 1),
  ];

  if (merged.length > 0) existing.models = merged;
  else delete existing.models;
  if (Object.keys(existing).length > 0) next[providerId] = existing;
  else delete next[providerId];
  return next;
}
