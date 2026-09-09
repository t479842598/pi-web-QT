import { NextResponse } from "next/server";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveVisibleModels } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import {
  applyBuiltinOverridePatches,
  getEffectiveOverrides,
  upsertBuiltinModels,
  type BuiltinModelUpsert,
  type OverridePatch,
  type OverridePatches,
} from "@/lib/builtin-model-overrides";
import { mutateModelsConfig, readModelsConfig } from "@/lib/models-config-store";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

interface BuiltinModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  /** True when models[] defines this id and the SDK registry does not. */
  custom?: boolean;
}

const ALLOWED_FIELDS = new Set(["name", "reasoning", "contextWindow", "maxTokens", "thinkingLevelMap", "hidden", "input"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** Input modalities the SDK accepts in `input`. */
const INPUT_MODALITIES = new Set(["text", "image"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateThinkingMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => THINKING_LEVELS.has(key) && (entry === null || typeof entry === "string"));
}

function validateInputList(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && INPUT_MODALITIES.has(entry));
}

function validatePatchValue(field: string, value: unknown): boolean {
  if (value === null) return true;
  if (field === "name") return typeof value === "string" && value.trim().length > 0;
  if (field === "reasoning" || field === "hidden") return typeof value === "boolean";
  if (field === "contextWindow" || field === "maxTokens") {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
  if (field === "thinkingLevelMap") return validateThinkingMap(value);
  if (field === "input") return validateInputList(value);
  return false;
}

function parsePatches(value: unknown): OverridePatches {
  if (!isRecord(value)) throw new Error("patches must be an object");
  const patches: OverridePatches = {};
  for (const [modelId, rawPatch] of Object.entries(value)) {
    if (!modelId || !isRecord(rawPatch)) throw new Error(`Invalid patch for model ${modelId}`);
    const patch: OverridePatch = {};
    for (const [field, fieldValue] of Object.entries(rawPatch)) {
      if (!ALLOWED_FIELDS.has(field)) throw new Error(`Unknown override field: ${field}`);
      if (!validatePatchValue(field, fieldValue)) throw new Error(`Invalid value for ${modelId}.${field}`);
      patch[field as keyof OverridePatch] = fieldValue;
    }
    if (Object.keys(patch).length > 0) patches[modelId] = patch;
  }
  return patches;
}

/** Ids the SDK's own registry provides for this provider, ignoring models.json.
 *  Only these entries may be pruned from models[] as redundant override shells;
 *  anything else there was created by the user. */
async function getBuiltinModelIds(providerId: string): Promise<string[]> {
  try {
    const runtime = await ModelRuntime.create({ modelsPath: join(tmpdir(), "pi-web-builtin-registry.json") });
    const providers = await runtime.getProviders();
    const provider = providers.find((entry) => entry.id === providerId);
    return (provider?.getModels() ?? []).map((model) => model.id);
  } catch {
    // If the registry cannot be read we must NOT prune anything: keeping an
    // extra entry is harmless, deleting a user's model is not.
    return [];
  }
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const url = new URL(req.url);
  const providerId = url.searchParams.get("provider")?.trim();
  if (!providerId) {
    return NextResponse.json({ error: "provider query parameter required" }, { status: 400 });
  }
  const cwd = resolve(url.searchParams.get("cwd") || process.cwd());

  try {
    const agentDir = getAgentDir();
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const settings: SettingsManager = services.settingsManager;
    // Hidden models remain editable here even though they are absent from normal selectors.
    const scope = await resolveVisibleModels(services.modelRuntime, settings.getEnabledModels(), { includeHidden: true });

    const models: BuiltinModelInfo[] = scope.visible
      .filter((model) => model.provider === providerId)
      .map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const modelsJson = readModelsConfig();
    const providers = isRecord(modelsJson.providers) ? modelsJson.providers : {};
    const provider = isRecord(providers[providerId]) ? providers[providerId] : undefined;
    const overrides = getEffectiveOverrides(provider);

    // Mark ids that only exist because models[] defines them, so the editor can
    // tell a user-added model from a builtin one with a builtin's name.
    const builtinIds = new Set(await getBuiltinModelIds(providerId));
    const customIds = new Set<string>();
    if (Array.isArray(provider?.models)) {
      for (const entry of provider.models) {
        if (isRecord(entry) && typeof entry.id === "string" && !builtinIds.has(entry.id)) {
          customIds.add(entry.id);
        }
      }
    }
    for (const model of models) {
      if (customIds.has(model.id)) model.custom = true;
    }

    return NextResponse.json({
      provider: providerId,
      models,
      overrides,
      configured: provider !== undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { provider?: unknown; patches?: unknown; models?: unknown };
    const providerId = typeof body.provider === "string" ? body.provider.trim() : "";
    if (!providerId) return NextResponse.json({ error: "provider is required" }, { status: 400 });
    const patches = parsePatches(body.patches ?? {});

    // models: optional upsert list keyed by id. Used by "fetch new models"
    // (which sends the whole upstream list) AND by the manual "add model" form
    // (which sends a single new id). Upsert — not replace — so a manual add can
    // never drop the other models the user configured.
    let parsedModels: BuiltinModelUpsert[] | undefined;
    if (body.models !== undefined) {
      if (!Array.isArray(body.models)) {
        return NextResponse.json({ error: "models must be an array of { id, name? }" }, { status: 400 });
      }
      const parsed: BuiltinModelUpsert[] = [];
      for (const entry of body.models) {
        if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) {
          return NextResponse.json({ error: "models must be an array of { id, name? }" }, { status: 400 });
        }
        const upsert: BuiltinModelUpsert = { id: entry.id.trim() };
        if (typeof entry.name === "string" && entry.name.trim()) upsert.name = entry.name.trim();
        if (typeof entry.reasoning === "boolean") upsert.reasoning = entry.reasoning;
        if (entry.input !== undefined) {
          if (!validateInputList(entry.input)) {
            return NextResponse.json({ error: `Invalid input for model ${upsert.id}` }, { status: 400 });
          }
          upsert.input = entry.input as string[];
        }
        if (entry.contextWindow !== undefined) {
          if (!validatePatchValue("contextWindow", entry.contextWindow)) {
            return NextResponse.json({ error: `Invalid contextWindow for model ${upsert.id}` }, { status: 400 });
          }
          upsert.contextWindow = entry.contextWindow as number;
        }
        if (entry.maxTokens !== undefined) {
          if (!validatePatchValue("maxTokens", entry.maxTokens)) {
            return NextResponse.json({ error: `Invalid maxTokens for model ${upsert.id}` }, { status: 400 });
          }
          upsert.maxTokens = entry.maxTokens as number;
        }
        if (entry.thinkingLevelMap !== undefined) {
          if (!validateThinkingMap(entry.thinkingLevelMap)) {
            return NextResponse.json({ error: `Invalid thinkingLevelMap for model ${upsert.id}` }, { status: 400 });
          }
          upsert.thinkingLevelMap = entry.thinkingLevelMap as Record<string, string | null>;
        }
        parsed.push(upsert);
      }
      parsedModels = parsed;
    }

    // Ids the SDK's base registry provides. Only these may be pruned as
    // redundant override shells; anything else in models[] is user-created.
    const builtinModelIds = new Set(
      (await getBuiltinModelIds(providerId)),
    );

    const result = await mutateModelsConfig((current) => {
      const providers = isRecord(current.providers) ? current.providers : {};
      const existingProvider = isRecord(providers[providerId]) ? providers[providerId] : undefined;
      let nextProvider = applyBuiltinOverridePatches(existingProvider, patches, { builtinModelIds });
      if (parsedModels) {
        nextProvider = upsertBuiltinModels(nextProvider, parsedModels);
      }
      const nextProviders = { ...providers };
      if (Object.keys(nextProvider).length > 0) nextProviders[providerId] = nextProvider;
      else delete nextProviders[providerId];
      const next = { ...current, providers: nextProviders };
      return {
        data: next,
        result: {
          provider: Object.keys(nextProvider).length > 0 ? nextProvider : null,
          config: next,
        },
      };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /required|invalid|unknown|must be|Content-Type/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
