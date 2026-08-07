import { NextResponse } from "next/server";
import { EventEmitter } from "node:events";
import { readProxyConfig, buildProxyUrl } from "@/lib/proxy-config";
import * as undici from "undici";

export const dynamic = "force-dynamic";

const TEST_TIMEOUT_MS = 10000;
const TEST_URL = "https://api.github.com";

export async function POST() {
  const config = readProxyConfig();

  if (!config.enabled) {
    return NextResponse.json(
      { success: false, error: "Proxy is disabled" },
      { status: 400 },
    );
  }

  const proxyUrl = buildProxyUrl(config);
  if (!proxyUrl) {
    return NextResponse.json(
      { success: false, error: "Proxy URL is invalid (missing host or port)" },
      { status: 400 },
    );
  }

  const start = Date.now();

  try {
    // Create a temporary dispatcher for this test only.
    // EnvHttpProxyAgent reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY at
    // construction time, which applyProxyEnv() has just set.
    const dispatcher: undici.Dispatcher = new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: TEST_TIMEOUT_MS,
      headersTimeout: TEST_TIMEOUT_MS,
    });
    if (dispatcher instanceof EventEmitter) {
      EventEmitter.prototype.on.call(dispatcher, "error", () => {});
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const { statusCode, body } = await undici.request(TEST_URL, {
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "pi-web-proxy-test",
        },
      });
      const responseText = await body.text();

      if (statusCode >= 400) {
        const errorText = responseText.slice(0, 200);
        return NextResponse.json({
          success: false,
          error: `HTTP ${statusCode}${errorText ? ": " + errorText : ""}`,
          latencyMs: Date.now() - start,
        });
      }

      const latencyMs = Date.now() - start;

      return NextResponse.json({
        success: true,
        latencyMs,
        status: statusCode,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (error instanceof DOMException && error.name === "TimeoutError") {
      message = "Test timed out after " + TEST_TIMEOUT_MS + "ms";
    }
    return NextResponse.json({
      success: false,
      error: message,
      latencyMs: Date.now() - start,
    });
  }
}
