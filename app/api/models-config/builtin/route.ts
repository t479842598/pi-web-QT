import { NextResponse } from "next/server";
import { resolve } from "path";
import {
  createAgentSessionServices,
  getAgentDir,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveVisibleModels } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import {
  applyBuiltinOverridePatches,
  getEffectiveOverrides,
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
}

const ALLOWED_FIELDS = new Set(["name", "reasoning", "contextWindow", "maxTokens", "thinkingLevelMap", "hidden"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateThinkingMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => THINKING_LEVELS.has(key) && (entry === null || typeof entry === "string"));
}

function validatePatchValue(field: string, value: unknown): boolean {
  if (value === null) return true;
  if (field === "name") return typeof value === "string" && value.trim().length > 0;
  if (field === "reasoning" || field === "hidden") return typeof value === "boolean";
  if (field === "contextWindow" || field === "maxTokens") {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
  if (field === "thinkingLevelMap") return validateThinkingMap(value);
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
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const modelsJson = readModelsConfig();
    const providers = isRecord(modelsJson.providers) ? modelsJson.providers : {};
    const provider = isRecord(providers[providerId]) ? providers[providerId] : undefined;
    const overrides = getEffectiveOverrides(provider);

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

    // models: 可选，写入该提供商的完整模型列表（「获取新模型」用）。
    // 写完整上游列表而非仅新增项，避免任何合并语义下丢模型。
    let parsedModels: Array<{ id: string; name?: string }> | undefined;
    if (body.models !== undefined) {
      if (!Array.isArray(body.models) || !body.models.every((m) => isRecord(m) && typeof m.id === "string" && m.id.trim())) {
        return NextResponse.json({ error: "models must be an array of { id, name? }" }, { status: 400 });
      }
      parsedModels = body.models.map((m) => ({
        id: (m as { id: string }).id.trim(),
        ...(typeof (m as { name?: unknown }).name === "string" && (m as { name: string }).name.trim()
          ? { name: (m as { name: string }).name.trim() }
          : {}),
      }));
    }

    const result = await mutateModelsConfig((current) => {
      const providers = isRecord(current.providers) ? current.providers : {};
      const existingProvider = isRecord(providers[providerId]) ? providers[providerId] : undefined;
      let nextProvider = applyBuiltinOverridePatches(existingProvider, patches);
      if (parsedModels) {
        nextProvider = { ...nextProvider, models: parsedModels };
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
