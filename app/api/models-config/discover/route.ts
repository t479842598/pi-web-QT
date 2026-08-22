import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveModelDiscoveryAuth } from "@/lib/model-discovery-auth";
import { buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

/**
 * 从 SDK 内置注册表解析提供商的 baseUrl（deepseek、anthropic 等未在
 * models.json 配置 baseUrl 的提供商）。用临时配置建 ModelRuntime，读取
 * getProvider 的定义；解析失败返回 null。模型列表 URL 走 openai-completions
 * 约定（baseUrl/models），api 参数保持路由默认值。
 */
async function resolveBuiltinProviderDef(
  providerName: string,
): Promise<{ baseUrl: string } | null> {
  let tempDir: string | undefined;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-def-"));
    const modelsPath = join(tempDir, "models.json");
    writeFileSync(modelsPath, JSON.stringify({ providers: { [providerName]: { models: [] } } }), "utf8");
    const runtime = await ModelRuntime.create({ modelsPath });
    const provider = runtime.getProvider(providerName);
    if (!provider?.baseUrl) return null;
    return { baseUrl: provider.baseUrl };
  } catch {
    return null;
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

export async function POST(req: Request) {
  try {
    if (!isApiRequestAllowed(req)) {
      return NextResponse.json({ error: "Request not allowed" }, { status: 403 });
    }
    if (!hasJsonContentType(req)) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    const body = await req.json() as { providerName?: unknown; provider?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ error: "provider is required" }, { status: 400 });

    let baseUrl = typeof body.provider.baseUrl === "string" ? body.provider.baseUrl.trim() : "";
    let api = typeof body.provider.api === "string" && body.provider.api
      ? body.provider.api
      : "openai-completions";
    if (!baseUrl) {
      // SDK 内置提供商（deepseek 等）未在 models.json 配置 baseUrl：
      // 从 SDK 注册表解析，让「获取新模型」对内置模型同样可用。
      const def = await resolveBuiltinProviderDef(providerName);
      if (def) {
        baseUrl = def.baseUrl;
      }
    }
    if (!baseUrl) return NextResponse.json({ error: "Base URL is required" }, { status: 400 });

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid" }, { status: 400 });
    }
    // Protocol guard: allow http/https base URLs (local LLMs like Ollama/LM Studio
    // are http-only). See ADR-0004: the route is already guarded by isApiRequestAllowed
    // (local request + Host whitelist), so the SSRF exposure is limited to local callers.
    if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
      return NextResponse.json({ error: "Only http:// and https:// base URLs are allowed" }, { status: 400 });
    }

    const auth = await resolveModelDiscoveryAuth(providerName, body.provider);
    if (typeof body.provider.apiKey === "string" && body.provider.apiKey.trim() && !auth.apiKey) {
      return NextResponse.json({ error: `No API key found for "${providerName}"` }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: response.status,
      }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "Upstream model list was not valid JSON" }, { status: 502 });
    }
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ models, endpoint: endpoint.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
