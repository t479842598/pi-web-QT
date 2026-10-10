import { NextResponse } from "next/server";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  applyModelConfigImports,
  modelConfigImportKey,
  publicModelConfigCandidate,
  scanModelConfigSources,
  type ModelConfigImportDraft,
  type ModelConfigImportSource,
} from "@/lib/model-config-import";
import {
  ModelsConfigReadError,
  mutateModelsConfig,
  readModelsConfigOrEmpty,
  type ModelsConfigData,
} from "@/lib/models-config-store";
import { pruneRemovedEnabledModels } from "@/lib/enabled-model-pruning";
import { invalidateAvailableModelsCache } from "@/lib/model-scope";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** GET: scan local agents and return secret-free import candidates. */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const drafts = scanModelConfigSources();
    return NextResponse.json(
      { candidates: drafts.map(publicModelConfigCandidate) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST: import the selected candidates. The client sends only keys
 * (`source:externalId`); the server re-scans so secret values never round-trip
 * through the browser and the import reflects the file's current contents.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json().catch(() => null);
    const keys = isRecord(body) && Array.isArray(body.keys)
      ? body.keys.filter((k): k is string => typeof k === "string")
      : [];
    if (keys.length === 0) {
      return NextResponse.json({ error: "keys must be a non-empty string array" }, { status: 400 });
    }
    const wanted = new Set(keys);

    const drafts: ModelConfigImportDraft[] = scanModelConfigSources().filter((draft) =>
      wanted.has(modelConfigImportKey(draft.source as ModelConfigImportSource, draft.externalId)),
    );
    if (drafts.length === 0) {
      return NextResponse.json({ success: true, imported: 0, skipped: 0, config: readModelsConfigOrEmpty() });
    }

    let previousConfig: ModelsConfigData | null = null;
    let imported = 0;
    let skipped = 0;
    const persisted = await mutateModelsConfig((current) => {
      previousConfig = current;
      const result = applyModelConfigImports(
        current as { providers?: Record<string, Record<string, unknown>> },
        drafts,
      );
      imported = result.imported;
      skipped = result.skipped;
      return { data: result.config as ModelsConfigData, result: result.config as ModelsConfigData };
    });

    // An import can add providers/models; it never removes any, so pruning is a
    // no-op here but keeps behaviour identical to the full-save route.
    if (previousConfig) {
      const settings = SettingsManager.create(process.cwd(), getAgentDir());
      const pruned = await pruneRemovedEnabledModels(
        settings,
        previousConfig as unknown as Record<string, unknown>,
        persisted as unknown as Record<string, unknown>,
      );
      if (pruned > 0) invalidateAvailableModelsCache();
    }

    return NextResponse.json({ success: true, imported, skipped, config: persisted });
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
