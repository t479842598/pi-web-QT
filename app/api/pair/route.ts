import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRelayClient } from "@/lib/relay-runtime";

const PAIR_TTL_MS = 10 * 60 * 1000;

/**
 * Public base URL for pairing links.
 *
 * This is the **HTTP(S)** origin the phone opens — not the WebSocket URL the
 * desktop dials. They are separate settings and must not be conflated: using
 * the `wss://…/ws` relay URL here produced an unopenable QR link.
 */
function publicBaseUrl(): string {
  const configured = process.env.PI_WEB_RELAY_PUBLIC_URL?.trim()
    || process.env.PI_WEB_PUBLIC_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : "";
}

/** The relay must be connected: it is the only place pairing tokens live. */
function relayError(): NextResponse | null {
  const client = getRelayClient();
  if (!client) {
    return NextResponse.json({
      error: "未配置中继（PI_WEB_RELAY_URL），无法生成配对二维码",
      code: "relayUnavailable",
    }, { status: 503 });
  }
  if (client.getState().state !== "registered") {
    return NextResponse.json({
      error: "中继尚未连接，请稍后重试",
      code: "relayUnavailable",
    }, { status: 503 });
  }
  return null;
}

// GET /api/pair — relay status plus the current pairing list.
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const base = publicBaseUrl();
  const client = getRelayClient();
  if (!client) {
    return NextResponse.json({ relayConfigured: false, relayUrl: base || null, devices: [] });
  }
  const reply = await client.request({ type: "pair_list" });
  const pairs = Array.isArray(reply.pairs) ? reply.pairs : [];
  return NextResponse.json({
    relayConfigured: true,
    relayUrl: base || null,
    relayState: client.getState().state,
    devices: pairs.map((pair) => {
      const record = pair as { label?: string; createdAt?: number; expiresAt?: number | null; used?: boolean; revoked?: boolean };
      return {
        label: record.label ?? "",
        createdAt: record.createdAt ?? 0,
        expiresAt: record.expiresAt ?? null,
        state: record.revoked ? "revoked" : record.used ? "used" : "live",
      };
    }),
  });
}

// POST /api/pair — { action: "create" | "revoke", token?, label? }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const unavailable = relayError();
  if (unavailable) return unavailable;
  const client = getRelayClient()!;

  try {
    const body = await req.json() as { action?: unknown; label?: unknown; token?: unknown };
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "create") {
      const label = typeof body.label === "string" ? body.label.slice(0, 64) : "";
      const reply = await client.request({ type: "pair_register", label, scope: "remote" });
      if (reply.ok !== true || typeof reply.token !== "string") {
        return NextResponse.json({ error: "中继拒绝了配对请求", code: reply.code ?? "unsupportedAction" }, { status: 502 });
      }
      const base = publicBaseUrl();
      // The phone needs both the token (path) and the device id (query) to
      // address this desktop on the relay.
      const qs = `mid=${encodeURIComponent(client.deviceMid)}`;
      const url = base ? `${base}/r/${encodeURIComponent(reply.token)}?${qs}` : `#pair=${encodeURIComponent(reply.token)}&${qs}`;
      const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
      return NextResponse.json({
        ok: true,
        url,
        qrSvg,
        expiresInMs: typeof reply.expiresInMs === "number" ? reply.expiresInMs : PAIR_TTL_MS,
        relayReady: base.length > 0,
      });
    }

    if (action === "revoke") {
      const token = typeof body.token === "string" ? body.token : "";
      if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
      const reply = await client.request({ type: "pair_revoke", token });
      return NextResponse.json({ ok: reply.ok === true, code: reply.code ?? null });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
