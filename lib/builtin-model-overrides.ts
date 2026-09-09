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
  "input",
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
  /** Input modalities the model accepts, e.g. ["text","image"]. */
  input?: string[];
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
    if (!next) continue;
    // Models added through the discovery flow have no initial draft yet —
    // treat a missing initial as an empty baseline so their first edits
    // still produce patches (previously the whole save was silently dropped).
    const before = initial[id] ?? {};
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
 * Marker written onto models[] entries this UI created as new model ids.
 *
 * `applyBuiltinOverridePatches` prunes a legacy entry once every field except
 * `id` has moved into modelOverrides — correct for a leftover builtin override
 * shell, but it would delete a user-defined model (whose only defining field IS
 * its id) the moment the user edits one of its overrides. The marker keeps
 * those entries alive and lets the editor label them as custom.
 *
 * The SDK ignores unknown model fields (verified against ModelRuntime), so this
 * round-trips through pi untouched.
 */
export const CUSTOM_MODEL_MARKER = "piWebCustom";

export function isCustomBuiltinModel(entry: Record<string, unknown>): boolean {
  return entry[CUSTOM_MODEL_MARKER] === true;
}

/**
 * Apply sparse patches to a provider's modelOverrides. Null removes one field.
 * Existing models[] entries remain untouched for backward compatibility.
 *
 * `builtinModelIds` — ids the SDK's base registry already provides. Only those
 * entries may be pruned once their fields have moved into modelOverrides: a
 * `{ id }`-only entry for a builtin model is a redundant shell (the SDK rebuilds
 * it from its own defaults), but the same shape for a user-created model IS the
 * model, so pruning it would delete it. Callers that cannot tell the two apart
 * should omit the set — nothing is pruned then, which is the safe direction.
 */
export function applyBuiltinOverridePatches(
  provider: ProviderConfig | undefined,
  patches: OverridePatches,
  options: { builtinModelIds?: ReadonlySet<string> } = {},
): ProviderConfig {
  const nextProvider = cloneRecord(provider);
  const overrides = getModelOverrides(provider);
  const legacyModels = Array.isArray(provider?.models)
    ? (provider.models as unknown[]).filter(isRecord).map((item) => ({ ...item }))
    : [];
  const builtinModelIds = options.builtinModelIds;

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
    if (legacy
      && !isCustomBuiltinModel(legacy)
      && builtinModelIds?.has(id) === true
      && Object.keys(legacy).every((key) => key === "id")) {
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

/** One entry accepted by the `models` field of the builtin PATCH endpoint. */
export interface BuiltinModelUpsert {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
}

/**
 * Upsert model definitions into a provider's `models[]` by id.
 *
 * This is the only way to introduce a NEW model id under a builtin provider:
 * `modelOverrides` is field-level only (the SDK's override schema has no `id`),
 * so renaming an override changes the label while the request keeps using the
 * builtin id. `applyModelsJson` in the SDK replaces on an id match and appends
 * otherwise, so we mirror that here.
 *
 * Existing entries are preserved field-by-field; `undefined` in an upsert never
 * clears a field it does not mention.
 */
export function upsertBuiltinModels(
  provider: ProviderConfig | undefined,
  upserts: readonly BuiltinModelUpsert[],
): ProviderConfig {
  const nextProvider = cloneRecord(provider);
  const models = Array.isArray(provider?.models)
    ? (provider.models as unknown[]).filter(isRecord).map((item) => ({ ...item }))
    : [];

  for (const upsert of upserts) {
    const index = models.findIndex((item) => item.id === upsert.id);
    const merged: Record<string, unknown> = index >= 0 ? { ...models[index] } : { id: upsert.id };
    for (const [key, value] of Object.entries(upsert)) {
      if (value === undefined) continue;
      merged[key] = value;
    }
    // Tag entries this UI created so the override pruner never deletes them and
    // the editor can label them as custom. Existing entries keep their shape.
    if (index < 0) merged[CUSTOM_MODEL_MARKER] = true;
    if (index >= 0) models[index] = merged;
    else models.push(merged);
  }

  if (models.length > 0) nextProvider.models = models;
  else delete nextProvider.models;
  return nextProvider;
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
        if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
          entry[field] = value as Record<string, string | null>;
        }
      } else if (field === "name") {
        if (typeof value === "string" && value.length > 0) entry[field] = value;
      } else if (field === "input") {
        if (Array.isArray(value) && value.length > 0) entry[field] = value;
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
