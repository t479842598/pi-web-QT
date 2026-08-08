import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createOpenCodeZenFetch, readOpenCodeZenConfig } from "./opencode-zen";
import { recordErrorLog } from "./error-log";

/**
 * OpenAI-compatible local gateway for the OpenCode Zen account pool.
 *
 * External tools (Cline, Roo Code, Open WebUI, scripts, ...) point their
 * baseURL at http://127.0.0.1:<port>/v1 with `Authorization: Bearer <key>`
 * where <key> is a user-configured external access key (NOT a Zen account
 * key). Every request is replayed through createOpenCodeZenFetch() so the
 * account/proxy pool, 429 auto-switch and cooldown logic apply unchanged.
 *
 * Only /v1/* paths are proxied; GET /v1/models is filtered to free models
 * (id ends with "-free"). The server binds 127.0.0.1 by default and never
 * logs or echoes the external key.
 */

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** Cap on buffered request bodies — the gateway must never let a remote
 *  client allocate unbounded memory. */
export const MAX_EXTERNAL_BODY_BYTES = 64 * 1024 * 1024;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type ExternalServerHandle = {
  server: ReturnType<typeof createServer>;
  zenFetch: typeof globalThis.fetch;
  /** Signature of the config this server was started with; restart() no-ops when unchanged. */
  configSignature: string;
  externalApiKey: string;
};

declare global {
  var __piOpenCodeZenExternalServer: ExternalServerHandle | undefined;
}

function configSignature(enabled: boolean, port: number, apiKey: string): string {
  return `${enabled}|${port}|${apiKey}`;
}

function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function openAiError(status: number, message: string, code?: string): { status: number; body: string } {
  return {
    status,
    body: JSON.stringify({ error: { message, type: "invalid_request_error", ...(code ? { code } : {}) } }),
  };
}

/**
 * OpenAI-style 429 for external clients: the server-side pool already marks
 * the account cooling and advances to the next one, so the client should
 * simply retry — the retry lands on a different account.
 */
export function openAiRateLimitError(retryAfter?: string | null): { status: number; body: string; headers: Record<string, string> } {
  return {
    status: 429,
    body: JSON.stringify({ error: { message: "当前账号已限额，请重新请求", type: "rate_limit_error", code: "rate_limit_exceeded" } }),
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    },
  };
}

function setStatus(running: boolean, port?: number, error?: string): void {
  globalThis.__piOpenCodeZenExternalStatus = {
    running,
    ...(port !== undefined ? { port } : {}),
    ...(error ? { error } : {}),
  };
}

/** Read and bound a request body; throws when it exceeds maxBytes. */
export async function readBody(req: IncomingMessage, maxBytes = MAX_EXTERNAL_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Filter a /v1/models payload down to free models (id ends with "-free"). */
export function filterFreeModels(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || !("data" in payload)) return payload;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return payload;
  return {
    ...payload,
    data: data.filter(
      (item): item is { id: string } =>
        item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && (item as { id: string }).id.endsWith("-free"),
    ),
  };
}

async function handleRequest(handle: ExternalServerHandle, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { zenFetch } = handle;

  // CORS preflight: browsers send OPTIONS without an Authorization value.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return;
  }

  const rawUrl = req.url ?? "/";
  if (!rawUrl.startsWith("/v1")) {
    const error = openAiError(404, "Not found. Only /v1/* endpoints are proxied.");
    res.writeHead(error.status, { "Content-Type": "application/json" });
    res.end(error.body);
    return;
  }

  // Authorization: Bearer <external key>
  const authorization = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!handle.externalApiKey || !match || !safeEqual(match[1], handle.externalApiKey)) {
    const error = openAiError(401, "Invalid API key", "invalid_api_key");
    res.writeHead(error.status, { "Content-Type": "application/json" });
    res.end(error.body);
    return;
  }

  // Buffer the request body (JSON payloads) so the pool can replay it on 429.
  // Oversized bodies get an early 413; stream errors fall back to an empty body.
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "request body too large") {
      const tooLarge = openAiError(413, "Request body too large");
      res.writeHead(tooLarge.status, { "Content-Type": "application/json" });
      res.end(tooLarge.body);
      return;
    }
    body = Buffer.alloc(0);
  }

  const headers = new Headers();
  for (const [key, rawValue] of Object.entries(req.headers)) {
    if (!rawValue) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "authorization" || lower === "content-length" || lower === "content-encoding") continue;
    if (Array.isArray(rawValue)) for (const value of rawValue) headers.append(key, value);
    else headers.append(key, rawValue);
  }

  const target = `${ZEN_BASE_URL}${rawUrl.slice(3)}`;
  let response: Response;
  try {
    response = await zenFetch(target, {
      method: req.method ?? "GET",
      headers,
      ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
    });
  } catch (error) {
    recordErrorLog({
      level: "error",
      source: "opencode-zen-external",
      provider: "opencode",
      message: `外部调用网关转发失败：${error instanceof Error ? error.message : String(error)}`,
    });
    const failure = openAiError(502, "Upstream request failed");
    res.writeHead(failure.status, { "Content-Type": "application/json" });
    res.end(failure.body);
    return;
  }

  // GET /v1/models: filter to free models only.
  if (req.method === "GET" && (rawUrl === "/v1/models" || rawUrl.startsWith("/v1/models?"))) {
    const text = await response.text().catch(() => "");
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const filtered = filterFreeModels(payload);
    const out = Buffer.from(filtered === null ? text : JSON.stringify(filtered), "utf8");
    res.writeHead(response.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(out);
    return;
  }

  // Upstream 429: the pool has already cooled the account down and moved to
  // the next one — surface a friendly OpenAI-style 429 so the external client
  // knows to retry (the retry will use a different account).
  if (response.status === 429) {
    const rateLimit = openAiRateLimitError(response.headers.get("retry-after"));
    res.writeHead(rateLimit.status, {
      ...rateLimit.headers,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(rateLimit.body);
    return;
  }

  // Passthrough (streaming SSE included): pipe the upstream body.
  // Set headers BEFORE writeHead — appendHeader() throws ERR_HTTP_HEADERS_SENT
  // once writeHead has materialized the header block.
  for (const [key, value] of response.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-length" || lower === "content-encoding" || lower === "access-control-allow-origin") continue;
    if (lower === "set-cookie") {
      for (const cookie of response.headers.getSetCookie()) res.appendHeader("set-cookie", cookie);
      continue;
    }
    res.setHeader(key, value);
  }
  res.writeHead(response.status, { "Access-Control-Allow-Origin": "*" });
  const upstreamBody = response.body;
  if (upstreamBody) {
    Readable.fromWeb(upstreamBody as import("node:stream/web").ReadableStream).pipe(res);
  } else {
    res.end();
  }
}

export async function startExternalAccessServer(): Promise<void> {
  const external = readOpenCodeZenConfig().externalAccess;
  if (!external.enabled || !external.apiKey) {
    // Not configured: make sure nothing is left running.
    await stopExternalAccessServer();
    return;
  }
  const signature = configSignature(true, external.port, external.apiKey);
  const existing = globalThis.__piOpenCodeZenExternalServer;
  if (existing && existing.configSignature === signature) return; // already running with this config

  await stopExternalAccessServer();

  const zenFetch = createOpenCodeZenFetch(globalThis.fetch.bind(globalThis));
  const server = createServer((req, res) => {
    const handle: ExternalServerHandle = { server, zenFetch, configSignature: signature, externalApiKey: external.apiKey };
    void handleRequest(handle, req, res);
  });

  await new Promise<void>((resolve) => {
    server.once("error", (error: Error & { code?: string }) => {
      const message = error.code === "EADDRINUSE" ? `端口 ${external.port} 已被占用` : error.message;
      setStatus(false, external.port, message);
      recordErrorLog({
        level: "error",
        source: "opencode-zen-external",
        provider: "opencode",
        message: `外部调用网关启动失败：${message}`,
      });
      resolve();
    });
    server.listen(external.port, "127.0.0.1", () => {
      setStatus(true, external.port);
      globalThis.__piOpenCodeZenExternalServer = { server, zenFetch, configSignature: signature, externalApiKey: external.apiKey };
      resolve();
    });
  });
}

export async function stopExternalAccessServer(): Promise<void> {
  const existing = globalThis.__piOpenCodeZenExternalServer;
  if (existing) {
    globalThis.__piOpenCodeZenExternalServer = undefined;
    await new Promise<void>((resolve) => {
      existing.server.close(() => resolve());
      // close() waits for active connections; never hang on a stuck stream.
      setTimeout(resolve, 1500).unref();
    });
  }
  setStatus(false);
}

/** Restart the gateway when its config signature changed; no-op otherwise. */
export async function restartExternalAccessServer(): Promise<void> {
  const external = readOpenCodeZenConfig().externalAccess;
  const signature = configSignature(external.enabled, external.port, external.apiKey);
  const existing = globalThis.__piOpenCodeZenExternalServer;
  if (existing && existing.configSignature === signature) return;
  await startExternalAccessServer();
}

/** Best-effort boot hook for instrumentation.ts; never throws. */
export async function ensureExternalAccessServer(): Promise<void> {
  try {
    await startExternalAccessServer();
  } catch (error) {
    recordErrorLog({
      level: "warning",
      source: "opencode-zen-external",
      provider: "opencode",
      message: `外部调用网关启动失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
