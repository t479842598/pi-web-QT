import { NextResponse } from "next/server";
import { readProxyConfig, writeProxyConfig, applyProxyEnv, type ProxyConfig } from "@/lib/proxy-config";
import { reconfigureHttpDispatcher } from "@/lib/http-dispatcher";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = readProxyConfig();
  // Return config without password; frontend stores its own password state
  const { password, ...safe } = config;
  return NextResponse.json({
    ...safe,
    hasPassword: !!password,
  });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const current = readProxyConfig();

    // Pick known fields only (drop hasPassword and any other junk the
    // frontend may send). The frontend omits `password` entirely when the
    // user did not touch the masked field; an explicit "" clears it.
    const next = {
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      protocol: (["http", "https", "socks5"].includes(body.protocol as string)
        ? body.protocol
        : current.protocol) as ProxyConfig["protocol"],
      host: typeof body.host === "string" ? body.host : current.host,
      port: typeof body.port === "number" ? body.port : current.port,
      username: typeof body.username === "string" ? body.username : current.username,
      password:
        typeof body.password === "string" ? body.password : current.password,
      noProxy: typeof body.noProxy === "string" ? body.noProxy : current.noProxy,
    };

    // Validate required fields if enabled
    if (next.enabled) {
      if (!next.host || !next.host.trim()) {
        return NextResponse.json(
          { error: "Host is required when proxy is enabled" },
          { status: 400 },
        );
      }
      if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
        return NextResponse.json(
          { error: "Port must be between 1 and 65535" },
          { status: 400 },
        );
      }
      if (!["http", "https", "socks5"].includes(next.protocol)) {
        return NextResponse.json(
          { error: "Protocol must be http, https, or socks5" },
          { status: 400 },
        );
      }
    }

    writeProxyConfig(next);
    applyProxyEnv(next);
    reconfigureHttpDispatcher();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Disable the proxy but keep the entered host/port/credentials so re-enabling
    // does not require re-entering them.
    const current = readProxyConfig();
    const config = {
      ...current,
      enabled: false,
    };
    writeProxyConfig(config);
    applyProxyEnv(config);
    reconfigureHttpDispatcher();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
