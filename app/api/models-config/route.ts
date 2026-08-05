import { NextResponse } from "next/server";
import { assertModelsConfigBody, mutateModelsConfig, readModelsConfig } from "@/lib/models-config-store";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import type { ModelsConfigData } from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The built-in model editor owns modelOverrides through its PATCH endpoint.
 * A full provider save must therefore never replay a stale modelOverrides
 * snapshot from the form and undo a newer local edit.
 */
function mergeFullSaveWithCurrent(
  current: ModelsConfigData,
  incoming: ModelsConfigData,
): ModelsConfigData {
  const currentProviders = isRecord(current.providers) ? current.providers : {};
  const incomingProviders = isRecord(incoming.providers) ? incoming.providers : {};
  const providers: Record<string, unknown> = { ...incomingProviders };

  for (const [providerId, incomingValue] of Object.entries(incomingProviders)) {
    if (!isRecord(incomingValue)) continue;
    const currentValue = currentProviders[providerId];
    const nextProvider = { ...incomingValue };
    // modelOverrides has a dedicated PATCH contract. Never replay a stale
    // client copy; preserve the current disk value or remove the stale field.
    if (isRecord(currentValue) && currentValue.modelOverrides !== undefined) {
      nextProvider.modelOverrides = currentValue.modelOverrides;
    } else {
      delete nextProvider.modelOverrides;
    }
    providers[providerId] = nextProvider;
  }

  return { ...incoming, providers };
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return NextResponse.json(readModelsConfig());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as unknown;
    assertModelsConfigBody(body);
    const persisted = await mutateModelsConfig((current) => {
      const next = mergeFullSaveWithCurrent(current, body);
      return { data: next, result: next };
    });
    return NextResponse.json({ success: true, config: persisted });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
