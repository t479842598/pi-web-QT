/**
 * Pure helpers for the global default model (`defaultProvider` + `defaultModel`
 * in settings.json).
 *
 * WHY this is not a plain "read the setting and show it":
 *
 * `defaultModel` is a single global value that outlives the catalog it was
 * chosen from. A provider can be removed, a model can be renamed, and the
 * stored pair stays exactly where it was — pi only reads the pair at session
 * start and silently falls back to the first available model when it no longer
 * resolves. Rendering the raw pair therefore asserts a pairing that does not
 * exist: the settings page would name a model the user cannot pick, cannot
 * switch away from, and would not get if they started a session right now.
 *
 * So the API and the UI carry two values separately:
 * - `stored`   — what settings.json literally says (may point at nothing),
 * - `resolved` — what can safely be presented as the default, or null.
 *
 * Nothing here imports the SDK or touches the filesystem, so the matching rules
 * are unit-testable without a model runtime.
 */

export interface DefaultModelRef {
  provider: string;
  modelId: string;
}

export interface DefaultModelAvailability {
  provider: string;
  modelId: string;
  /** 该 provider 是否存在且提供该 modelId（大小写不敏感，id 里的斜杠保留） */
  available: boolean;
}

export interface DefaultModelView {
  /** settings 里存的原始值，可能指向已不存在的模型 */
  stored: DefaultModelRef | null;
  /** 实际可安全展示给用户的默认模型；stored 不可用时为 null */
  resolved: DefaultModelRef | null;
  scope: "global" | "project";
  path: string;
  editable: boolean;
}

/** Anything that can name a model: SDK `Model` uses `id`, settings use `modelId`. */
export interface ModelRefLike {
  provider?: string | null;
  id?: string | null;
  modelId?: string | null;
}

/** Trimmed, lowercased key for comparison only — never for output. */
function comparisonKey(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): { provider: string; modelId: string } | null {
  const cleanProvider = typeof provider === "string" ? provider.trim() : "";
  const cleanModelId = typeof modelId === "string" ? modelId.trim() : "";
  if (!cleanProvider || !cleanModelId) return null;
  // Model ids may contain slashes (openrouter's `sakana/fugu-ultra`); the whole
  // id is one opaque token here, so it is never split on "/".
  return { provider: cleanProvider.toLowerCase(), modelId: cleanModelId.toLowerCase() };
}

/**
 * Resolve a stored default against the models the runtime actually offers.
 *
 * `resolved` deliberately returns the caller's own `stored` object instead of a
 * normalized copy: this value travels back into settings.json on the next save,
 * and rewriting the user's casing ("Anthropic" → "anthropic") would turn a
 * read into a silent write.
 */
export function resolveDefaultModel(
  stored: DefaultModelRef | null,
  availableModels: readonly { provider: string; id: string }[],
): { resolved: DefaultModelRef | null; available: boolean } {
  if (!stored) return { resolved: null, available: false };
  const wanted = comparisonKey(stored.provider, stored.modelId);
  if (!wanted) return { resolved: null, available: false };

  const match = availableModels.some((model) => {
    const candidate = comparisonKey(model.provider, model.id);
    return candidate !== null
      && candidate.provider === wanted.provider
      && candidate.modelId === wanted.modelId;
  });

  return match ? { resolved: stored, available: true } : { resolved: null, available: false };
}

/**
 * Compare a settings-side reference with an SDK-side one.
 *
 * Callers hold one or the other: `Model` objects expose `id`, settings entries
 * expose `modelId`. Two absent references do not name the same model, so a
 * nullish side (or an empty provider/model id) is never a match.
 */
export function sameModelRef(
  a: ModelRefLike | null | undefined,
  b: DefaultModelRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  const left = comparisonKey(a.provider, a.modelId ?? a.id);
  const right = comparisonKey(b.provider, b.modelId);
  if (!left || !right) return false;
  return left.provider === right.provider && left.modelId === right.modelId;
}
