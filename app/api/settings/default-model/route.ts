import { stat } from "fs/promises";
import { join, resolve } from "path";
import { getAgentDir, SettingsManager, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateAvailableModelsCache } from "@/lib/model-scope";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { mutateSettingsJson } from "@/lib/settings-lock";
import { resolveDefaultModel, type DefaultModelRef } from "@/lib/settings-default-model";

export const dynamic = "force-dynamic";

/** Same cap as the settings UI's model list — a provider catalog can be huge. */
const MAX_AVAILABLE_MODELS = 2000;

interface RequestContext {
  modelRuntime: ModelRuntime;
  models: readonly Model<Api>[];
  settingsManager: SettingsManager;
  paths: { cwd: string; agentDir: string };
}

async function loadContext(cwd: string): Promise<RequestContext> {
  const modelRuntime = await createModelRuntimeWithExtensions();
  const agentDir = getAgentDir();
  return {
    modelRuntime,
    models: await modelRuntime.getAvailable(),
    settingsManager: SettingsManager.create(cwd, agentDir),
    paths: { cwd, agentDir },
  };
}

function globalSettingsPath(context: RequestContext): string {
  return join(context.paths.agentDir, "settings.json");
}

function projectSettingsPath(context: RequestContext): string {
  return join(context.paths.cwd, ".pi", "settings.json");
}

/**
 * Where the value comes from, and whether this route may write it.
 *
 * A project `settings.json` replaces the global one for the fields it names
 * (`SettingsManager` deep-merges project over global and the setter only ever
 * writes the global file), so a project-level `defaultModel` makes every write
 * from here a silent no-op. Report that instead of pretending to save.
 */
function readDefaultModelSettings(context: RequestContext): { scope: "global" | "project"; path: string } {
  const project = context.settingsManager.getProjectSettings();
  const overridden = project.defaultModel !== undefined || project.defaultProvider !== undefined;
  return overridden
    ? { scope: "project", path: projectSettingsPath(context) }
    : { scope: "global", path: globalSettingsPath(context) };
}

/**
 * The pair pi will actually use: `getDefaultProvider()`/`getDefaultModel()`
 * read the merged settings, which is the project value when one is defined.
 */
function readStoredDefault(context: RequestContext): DefaultModelRef | null {
  const provider = context.settingsManager.getDefaultProvider();
  const modelId = context.settingsManager.getDefaultModel();
  if (typeof provider !== "string" || typeof modelId !== "string") return null;
  if (!provider.trim() || !modelId.trim()) return null;
  return { provider, modelId };
}

interface AvailableModelOption {
  provider: string;
  modelId: string;
  name: string;
}

function availableModelOptions(models: readonly Model<Api>[]): AvailableModelOption[] {
  return [...models]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
    .slice(0, MAX_AVAILABLE_MODELS)
    .map((model) => ({ provider: model.provider, modelId: model.id, name: model.name }));
}

/**
 * Resolve the cwd whose project settings decide whether the global value is
 * shadowed. It points at a settings file, so it goes through the same
 * allow-list as `/api/files`.
 */
async function resolveCwd(raw: string | null): Promise<{ cwd: string } | { error: Response }> {
  if (!raw) return { cwd: process.cwd() };
  const cwd = resolve(raw);
  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return { error: Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 }) };
  }
  if (!cwdStat.isDirectory()) {
    return { error: Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 }) };
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { error: Response.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  const resolvedCwd = await resolveCwd(new URL(req.url).searchParams.get("cwd"));
  if ("error" in resolvedCwd) return resolvedCwd.error;

  try {
    const context = await loadContext(resolvedCwd.cwd);
    const { scope, path } = readDefaultModelSettings(context);
    const stored = readStoredDefault(context);
    const availability = resolveDefaultModel(stored, context.models);
    return Response.json({
      stored,
      resolved: availability.resolved,
      availableModels: availableModelOptions(context.models),
      scope,
      path,
      editable: scope === "global",
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

interface DefaultModelRequest {
  cwd?: unknown;
  provider?: unknown;
  modelId?: unknown;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : null;
}

/**
 * Clear the pair by deleting the two keys.
 *
 * `setDefaultModelAndProvider("", "")` is NOT a clear: probed against the SDK
 * (settings-manager.js `setDefaultModelAndProvider`), it writes the empty
 * strings into settings.json, and every later `getDefaultProvider()` /
 * `getDefaultModel()` reports `""` instead of `undefined`. pi's resolver reads
 * the pair as truthy (`if (defaultProvider && defaultModelId)`), so an empty
 * pair does behave like an unset one, but leaving `"defaultModel": ""` on disk
 * is dirty state the settings page would then have to special-case. The SDK
 * exposes no delete API (`setDefaultModel` / `setDefaultProvider` only assign),
 * so the deletion goes through this repo's locked settings writer, which
 * read-merges under the same file lock the SDK uses and preserves every field
 * it did not touch.
 */
async function clearDefaultModel(): Promise<void> {
  await mutateSettingsJson((settings) => {
    const hadDefault = "defaultProvider" in settings || "defaultModel" in settings;
    delete settings.defaultProvider;
    delete settings.defaultModel;
    return { settings, changed: hadDefault };
  });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: DefaultModelRequest;
  try {
    body = (await req.json()) as DefaultModelRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawCwd = optionalString(body.cwd);
  const provider = optionalString(body.provider);
  const modelId = optionalString(body.modelId);
  if (rawCwd === null || provider === null || modelId === null) {
    return Response.json({ error: "cwd, provider and modelId must be strings" }, { status: 400 });
  }

  const resolvedCwd = await resolveCwd(rawCwd ?? null);
  if ("error" in resolvedCwd) return resolvedCwd.error;

  const hasProvider = typeof provider === "string" && provider.trim() !== "";
  const hasModelId = typeof modelId === "string" && modelId.trim() !== "";
  if (hasProvider !== hasModelId) {
    return Response.json(
      { error: "provider and modelId must be provided together" },
      { status: 400 },
    );
  }

  try {
    const context = await loadContext(resolvedCwd.cwd);
    const { scope, path } = readDefaultModelSettings(context);
    if (scope === "project") {
      return Response.json(
        { error: "Project settings override the default model", reason: "project-scope", path },
        { status: 409 },
      );
    }

    if (!hasProvider && !hasModelId) {
      await clearDefaultModel();
      invalidateModelsCache();
      invalidateAvailableModelsCache();
      return Response.json({ success: true, resolved: null });
    }

    const next: DefaultModelRef = { provider: provider as string, modelId: modelId as string };
    const availability = resolveDefaultModel(next, context.models);
    if (!availability.available) {
      return Response.json({ error: "Unknown model", reason: "unknown-model" }, { status: 400 });
    }

    // `SettingsManager` skips the write when it could not load the file and it
    // collects storage failures instead of throwing, so drain both sides: a
    // save that did not reach disk must not report success.
    const loadErrors = context.settingsManager.drainErrors();
    const globalLoadError = loadErrors.find((entry) => entry.scope === "global");
    if (globalLoadError) throw globalLoadError.error;

    context.settingsManager.setDefaultModelAndProvider(next.provider, next.modelId);
    await context.settingsManager.flush();
    const writeErrors = context.settingsManager.drainErrors();
    if (writeErrors.length > 0) throw writeErrors[0].error;

    invalidateModelsCache();
    invalidateAvailableModelsCache();
    return Response.json({ success: true, resolved: next });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
