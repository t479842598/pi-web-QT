import { NextResponse } from "next/server";
import { resolve } from "path";
import {
  createAgentSessionServices,
  getAgentDir,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  flattenModels,
  getTitleModel,
  isKnownTitleModel,
  readModelsJson,
  setTitleModel,
  type TitleModelOption,
} from "@/lib/settings-title-model";
import { resolveVisibleModels } from "@/lib/model-scope";
import { isApiRequestAllowed } from "@/lib/request-security";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

/**
 * Full imported-model list: API-key/OAuth providers (SDK model registry) plus
 * custom providers from models.json. Same source as GET /api/models.
 */
async function loadTitleModels(cwd: string): Promise<TitleModelOption[]> {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  const settings: SettingsManager = services.settingsManager;
  const scope = await resolveVisibleModels(services.modelRuntime, settings.getEnabledModels());
  return scope.visible
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      label: `${model.provider}/${model.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function resolveCwd(req: Request): string {
  const requested = new URL(req.url).searchParams.get("cwd") || process.cwd();
  return resolve(requested);
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const value = getTitleModel();
  const cwd = resolveCwd(req);
  try {
    const models = await loadTitleModels(cwd);
    return NextResponse.json({ value, models });
  } catch {
    // Fallback: models.json only (custom providers).
    return NextResponse.json({ value, models: flattenModels(readModelsJson()) });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as { value?: unknown };
    const value = body.value;
    if (value !== null && typeof value !== "string") {
      return NextResponse.json({ error: "value must be a string or null" }, { status: 400 });
    }

    if (value !== null) {
      const cwd = resolveCwd(req);
      let models: TitleModelOption[];
      try {
        models = await loadTitleModels(cwd);
      } catch {
        models = flattenModels(readModelsJson());
      }
      if (!isKnownTitleModel(value, models)) {
        return NextResponse.json({ error: `Unknown model: ${value}` }, { status: 400 });
      }
    }

    setTitleModel(value);
    return NextResponse.json({ value: value ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
