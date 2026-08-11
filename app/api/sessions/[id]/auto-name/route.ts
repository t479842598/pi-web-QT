import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelLike } from "@/lib/pi-types";
import { generateSessionTitle } from "@/lib/session-title";
import { stripModeInstructionBlocks } from "@/lib/modes";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getTitleModel } from "@/lib/settings-title-model";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

/** Resolve the globally configured title model; falls back to the session model. */
function resolveTitleModelOverride(
  session: { modelRuntime: { getModel: (provider: string, modelId: string) => ModelLike | undefined } },
): ModelLike | undefined {
  const titleModel = getTitleModel();
  if (!titleModel) return undefined;
  const slash = titleModel.indexOf("/");
  if (slash <= 0 || slash === titleModel.length - 1) return undefined;
  const provider = titleModel.slice(0, slash);
  const modelId = titleModel.slice(slash + 1);
  return session.modelRuntime.getModel(provider, modelId);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined);

    const modelOverride = resolveTitleModelOverride(session.inner) as unknown as
      | Model<Api>
      | undefined;
    const result = await generateSessionTitle(
      session.inner as unknown as AgentSession,
      modelOverride,
    );

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    session.inner.setSessionName(stripModeInstructionBlocks(result.title));
    invalidateSessionListCache();
    return NextResponse.json({ title: stripModeInstructionBlocks(result.title), usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
