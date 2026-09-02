import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelLike } from "@/lib/pi-types";
import { generateSessionTitle } from "@/lib/session-title";
import {
  cancelSessionTitle,
  scheduleSessionTitle,
  SessionTitleTaskError,
} from "@/lib/session-title-coordinator";
import { stripModeInstructionBlocks } from "@/lib/modes";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getTitleModel } from "@/lib/settings-title-model";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

function resolveTitleModelOverride(
  session: { modelRuntime: { getModel: (provider: string, modelId: string) => ModelLike | undefined } },
): ModelLike | undefined {
  const titleModel = getTitleModel();
  if (!titleModel) return undefined;
  const slash = titleModel.indexOf("/");
  if (slash <= 0 || slash === titleModel.length - 1) return undefined;
  return session.modelRuntime.getModel(titleModel.slice(0, slash), titleModel.slice(slash + 1));
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SessionTitleTaskError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "title_queue_full" ? 429 : 409 },
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return NextResponse.json(
      { error: error.message, code: "title_generation_cancelled" },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const { id } = await params;
  const filePath = await resolveSessionPath(id);
  if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const cancelOnDisconnect = () => { cancelSessionTitle(id); };
  req.signal.addEventListener("abort", cancelOnDisconnect, { once: true });
  try {
    const result = await scheduleSessionTitle(id, async (signal) => {
      const existing = getRpcSession(id);
      const started = existing?.isAlive()
        ? { session: existing, created: false }
        : await startRpcSession(id, filePath, undefined);
      const { session, created } = started;
      try {
        const modelOverride = resolveTitleModelOverride(session.inner) as unknown as Model<Api> | undefined;
        const generated = await generateSessionTitle(
          session.inner as unknown as AgentSession,
          modelOverride,
          signal,
        );
        if (!session.isAlive()) {
          throw new Error("The session was closed while its title was being generated. Please try again.");
        }
        const title = stripModeInstructionBlocks(generated.title);
        session.inner.setSessionName(title);
        invalidateSessionListCache();
        return { title, usage: generated.usage ?? null };
      } finally {
        if (created && session.isAlive() && !session.isRunning() && !session.hasSubscribers()) {
          await Promise.race([
            session.shutdown(),
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
          ]).catch(() => {});
          if (session.isAlive()) session.destroy();
        }
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  } finally {
    req.signal.removeEventListener("abort", cancelOnDisconnect);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const { id } = await params;
  return NextResponse.json({ cancelled: cancelSessionTitle(id) });
}
