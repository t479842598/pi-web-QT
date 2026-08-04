import { NextResponse } from "next/server";
import { resolve } from "path";
import {
  createAgentSessionServices,
  getAgentDir,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveVisibleModels } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { readModelsJson } from "@/lib/settings-title-model";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

interface BuiltinModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const url = new URL(req.url);
  const providerId = url.searchParams.get("provider");
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
    const scope = await resolveVisibleModels(services.modelRuntime, settings.getEnabledModels());

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

    // Existing overlay entries from models.json
    const modelsJson = readModelsJson();
    const providers = (modelsJson.providers ?? {}) as Record<string, { models?: unknown }>;
    const entry = providers[providerId];
    const overrides: Record<string, Record<string, unknown>> = {};
    if (Array.isArray(entry?.models)) {
      for (const item of entry.models as Array<Record<string, unknown>>) {
        if (item && typeof item.id === "string") overrides[item.id] = item;
      }
    }

    return NextResponse.json({
      provider: providerId,
      models,
      overrides,
      configured: entry !== undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
