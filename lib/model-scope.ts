import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { readModelsJson } from "./settings-title-model";
import { getEffectiveOverrides } from "./builtin-model-overrides";

// ─── Model list cache ──────────────────────────────────────────────────────
// modelRuntime.getAvailable() may hit the network (a provider's model listing)
// and take seconds. Every RPC session startup resolves it, so a cold wrapper
// recreation can stall message send / SSE connect by 20s+. Cache the raw list
// briefly (same TTL as /api/models); models are read back from the registry
// per call, so a stale entry only delays seeing brand-new upstream models.
const AVAILABLE_MODELS_TTL_MS = 60_000;
let availableModelsCache: { data: readonly Model<Api>[]; at: number } | null = null;

async function getAvailableModels(
  modelRuntime: ModelRuntime,
  signal?: AbortSignal,
): Promise<readonly Model<Api>[]> {
  const now = Date.now();
  if (availableModelsCache && now - availableModelsCache.at < AVAILABLE_MODELS_TTL_MS) {
    return availableModelsCache.data;
  }
  // getAvailable() accepts AuthOperationOptions.signal so a caller can cancel
  // a slow network model-catalog refresh (the known "发消息卡死" hang source).
  const data = await modelRuntime.getAvailable(undefined, signal ? { signal } : undefined);
  availableModelsCache = { data, at: now };
  return data;
}

/** Drop the model-list cache (called when models.json changes). */
export function invalidateAvailableModelsCache(): void {
  availableModelsCache = null;
}


/**
 * Uses pi's resolver so pi-web accepts the same enabledModels globs, fuzzy
 * references, and thinking pins as the CLI rather than maintaining a second
 * matcher with subtly different behavior.
 */
export interface ModelScopeResult {
  visible: readonly Model<Api>[];
  scopedModels: readonly ScopedModel[];
  thinkingLevelPins: Record<string, string>;
  warnings: string[];
}

export interface InitialModelScopeOptions {
  requestedModel?: { provider: string; modelId: string };
  defaultModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface InitialModelScopeResult {
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  scopedModels: ScopedModel[];
}

function matchesModel(
  model: { provider: string; id: string },
  reference: { provider: string; modelId: string },
): boolean {
  return model.provider === reference.provider && model.id === reference.modelId;
}

export async function resolveVisibleModels(
  modelRuntime: ModelRuntime,
  patterns: string[] | undefined,
  options: { includeHidden?: boolean; signal?: AbortSignal } = {},
): Promise<ModelScopeResult> {
  const modelsJson = readModelsJson();
  const providers = (modelsJson.providers ?? {}) as Record<string, { models?: unknown }>;
  const hiddenSet = new Set<string>();
  for (const [pid, rawEntry] of Object.entries(providers)) {
    const entry = rawEntry as Record<string, unknown>;
    const effective = getEffectiveOverrides(entry);
    for (const [modelId, override] of Object.entries(effective)) {
      if (override.hidden === true) hiddenSet.add(`${pid}/${modelId}`);
    }
  }

  const cleanedPatterns = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  let visible: readonly Model<Api>[] = [];
  let scopedModels: readonly ScopedModel[] = [];
  const thinkingLevelPins: Record<string, string> = {};
  const warnings: string[] = [];

  if (cleanedPatterns.length === 0) {
    visible = await getAvailableModels(modelRuntime, options.signal);
  } else {
    const result = await resolveModelScopeWithDiagnostics(cleanedPatterns, modelRuntime);
    scopedModels = result.scopedModels;
    visible = result.scopedModels.length > 0
      ? result.scopedModels.map((s) => s.model)
      : await getAvailableModels(modelRuntime, options.signal);
    warnings.push(...result.diagnostics.map((d) => d.message));
    for (const scopedModel of scopedModels) {
      if (scopedModel.thinkingLevel) {
        thinkingLevelPins[`${scopedModel.model.provider}/${scopedModel.model.id}`] = scopedModel.thinkingLevel;
      }
    }
  }

  if (!options.includeHidden) {
    visible = visible.filter((model) => !hiddenSet.has(`${model.provider}/${model.id}`));
  }

  return {
    visible,
    scopedModels: options.includeHidden || visible.length === scopedModels.length ? scopedModels : scopedModels.filter(
      (s) => !hiddenSet.has(`${s.model.provider}/${s.model.id}`),
    ),
    thinkingLevelPins,
    warnings,
  };
}

export function selectInitialModelScope(
  scope: ModelScopeResult,
  options: InitialModelScopeOptions = {},
): InitialModelScopeResult {
  const requested = options.requestedModel
    ? scope.visible.find((model) => matchesModel(model, options.requestedModel!))
    : undefined;
  if (options.requestedModel && !requested) {
    throw new Error(
      `Model is not available in the enabled scope: ${options.requestedModel.provider}/${options.requestedModel.modelId}`,
    );
  }

  const requestedScoped = requested
    ? scope.scopedModels.find((scopedModel) => matchesModel(scopedModel.model, {
      provider: requested.provider,
      modelId: requested.id,
    }))
    : undefined;
  const defaultScoped = !requested && options.defaultModel
    ? scope.scopedModels.find((scopedModel) => matchesModel(scopedModel.model, options.defaultModel!))
    : undefined;
  const fallbackScoped = !requested ? (defaultScoped ?? scope.scopedModels[0]) : undefined;
  const defaultVisible = !requested && !fallbackScoped && options.defaultModel
    ? scope.visible.find((model) => matchesModel(model, options.defaultModel!))
    : undefined;
  const model = requested ?? fallbackScoped?.model ?? defaultVisible;
  const scopedSelection = requestedScoped ?? fallbackScoped;
  const thinkingLevel = options.thinkingLevel ?? scopedSelection?.thinkingLevel;

  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    scopedModels: [...scope.scopedModels],
  };
}
