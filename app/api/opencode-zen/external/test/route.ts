import { NextResponse } from "next/server";
import { createOpenCodeZenFetch, readOpenCodeZenConfig } from "@/lib/opencode-zen";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Test the external-access gateway configuration against the real Zen
 * gateway: builds a temporary pool from the current accounts + the draft
 * externalAccess payload and issues GET /v1/models. The response never
 * contains the API key.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { enabled?: unknown; port?: unknown; apiKey?: unknown };
    const current = readOpenCodeZenConfig();
    const enabled = body.enabled !== false;
    const port = Number(body.port);
    // Draft key wins; empty draft falls back to the saved key (the UI never
    // holds the plaintext of a saved key).
    const draftKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : "";
    const apiKey = draftKey || current.externalAccess.apiKey;
    if (!enabled) {
      return NextResponse.json({ ok: true, skipped: true, message: "外部调用未启用，无需测试" });
    }
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "请先设置外部调用 API Key" }, { status: 400 });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ ok: false, error: "端口必须为 1-65535 的整数" }, { status: 400 });
    }
    // Draft pool: current accounts + draft external config (accounts are what
    // the gateway would actually forward through; the key only gates access).
    const zenFetch = createOpenCodeZenFetch(globalThis.fetch.bind(globalThis), undefined, {
      ...current,
      externalAccess: { enabled, port, apiKey },
    });
    const started = Date.now();
    const response = await zenFetch("https://opencode.ai/zen/v1/models", {
      headers: { Accept: "application/json", "User-Agent": "pi-web-opencode-zen-external-test" },
    });
    const text = await response.text();
    const ok = response.status >= 200 && response.status < 300;
    let modelCount: number | undefined;
    try {
      const parsed = JSON.parse(text) as { data?: unknown };
      modelCount = Array.isArray(parsed.data) ? parsed.data.length : undefined;
    } catch {
      // upstream body is not JSON; report as-is
    }
    return NextResponse.json({
      ok,
      status: response.status,
      latencyMs: Date.now() - started,
      ...(ok && modelCount !== undefined ? { modelCount } : {}),
      ...(!ok ? { error: text.slice(0, 500) } : {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
