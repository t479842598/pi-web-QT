import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRelayClient } from "@/lib/relay-runtime";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";

/** One-shot tokens are for QR scans; the saved link uses 0 (= no expiry). */
const QR_TTL_MS = 10 * 60 * 1000;

/** Sidecar holding the current saved link, so it survives restarts. */
const STORE_PATH = join(homedir(), ".pi", "agent", "web-pairing.json");

interface SavedLink {
  /** Raw token. Kept here so the panel can show the same link every time. */
  token: string;
  createdAt: number;
  label: string;
}

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
      error: "未配置中继（PI_WEB_RELAY_URL），无法生成配对链接",
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

function readLink(): SavedLink | null {
  if (!existsSync(STORE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Partial<SavedLink>;
    if (!parsed || typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    return { token: parsed.token, createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0, label: parsed.label ?? "" };
  } catch {
    return null;
  }
}

function writeLink(link: SavedLink): void {
  const directory = dirname(STORE_PATH);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writePrivateFileAtomicSync(STORE_PATH, `${JSON.stringify(link, null, 2)}\n`);
}

/**
 * Build the phone-facing URL.
 *
 * The phone needs both the token (path) and the device id (query) to address
 * this desktop on the relay.
 */
function linkUrl(token: string, mid: string): string {
  const base = publicBaseUrl();
  const query = `mid=${encodeURIComponent(mid)}`;
  return base
    ? `${base}/r/${encodeURIComponent(token)}?${query}`
    : `#pair=${encodeURIComponent(token)}&${query}`;
}

// GET /api/pair — relay status, the saved link, and the connected-device list.
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const client = getRelayClient();
  if (!client) {
    return NextResponse.json({ relayConfigured: false, relayUrl: publicBaseUrl() || null, link: null, devices: [] });
  }
  const reply = await client.request({ type: "pair_list", timeoutMs: 8_000 });
  const pairs = Array.isArray(reply.pairs) ? reply.pairs : [];
  const saved = readLink();
  return NextResponse.json({
    relayConfigured: true,
    relayUrl: publicBaseUrl() || null,
    relayState: client.getState().state,
    // A saved link is permanent, so the panel only needs its URL.
    link: saved ? { url: linkUrl(saved.token, client.deviceMid), createdAt: saved.createdAt, label: saved.label } : null,
    devices: pairs.map((pair) => {
      const record = pair as {
        label?: string; createdAt?: number; expiresAt?: number | null;
        reusable?: boolean; used?: boolean; revoked?: boolean; connections?: number; expired?: boolean;
      };
      return {
        label: record.label ?? "",
        createdAt: record.createdAt ?? 0,
        expiresAt: record.expiresAt ?? null,
        reusable: record.reusable === true,
        connections: record.connections ?? 0,
        state: record.revoked ? "revoked" : record.expired ? "expired" : record.used ? "used" : "live",
      };
    }),
  });
}

// POST /api/pair — { action: "create" | "regenerate" | "revoke" | "qr", token? }
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

    if (action === "get") {
      const saved = readLink();
      if (!saved) return NextResponse.json({ ok: false, code: "sessionNotFound" });
      return NextResponse.json({ ok: true, url: linkUrl(saved.token, client.deviceMid) });
    }

    // A permanent, reusable link: no expiry, redeemable from any number of
    // devices. Reused until the user explicitly regenerates it, so every device
    // can share one URL.
    if (action === "create" || action === "regenerate") {
      const existing = readLink();
      if (existing && action === "create") {
        return NextResponse.json({ ok: true, url: linkUrl(existing.token, client.deviceMid), reusable: true, expiresAt: null, reused: true });
      }

      const label = typeof body.label === "string" ? body.label.slice(0, 64) : "";
      const reply = await client.request({ type: "pair_register", label, scope: "remote", ttlMs: 0, reusable: true });
      if (reply.ok !== true || typeof reply.token !== "string") {
        return NextResponse.json({ error: "中继拒绝了配对请求", code: reply.code ?? "unsupportedAction" }, { status: 502 });
      }
      // Regenerating replaces the old link: revoke it so the previous URL stops
      // working rather than lingering as a second permanent key.
      if (existing) await client.request({ type: "pair_revoke", token: existing.token }).catch(() => {});
      writeLink({ token: reply.token, createdAt: Date.now(), label });
      return NextResponse.json({ ok: true, url: linkUrl(reply.token, client.deviceMid), reusable: true, expiresAt: null });
    }

    // Short-lived single-use QR, for a one-off pairing on a borrowed phone.
    if (action === "qr") {
      const label = typeof body.label === "string" ? body.label.slice(0, 64) : "";
      const reply = await client.request({ type: "pair_register", label, scope: "remote", ttlMs: QR_TTL_MS });
      if (reply.ok !== true || typeof reply.token !== "string") {
        return NextResponse.json({ error: "中继拒绝了配对请求", code: reply.code ?? "unsupportedAction" }, { status: 502 });
      }
      const url = linkUrl(reply.token, client.deviceMid);
      const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
      return NextResponse.json({ ok: true, url, qrSvg, expiresInMs: QR_TTL_MS });
    }

    // Render the permanent link as a QR for scanning off the desktop screen.
    if (action === "qr-link") {
      const saved = readLink();
      if (!saved) return NextResponse.json({ error: "尚无配对链接" }, { status: 404 });
      const url = linkUrl(saved.token, client.deviceMid);
      const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
      return NextResponse.json({ ok: true, url, qrSvg, reusable: true });
    }

    if (action === "revoke") {
      const token = typeof body.token === "string" ? body.token : "";
      if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
      const reply = await client.request({ type: "pair_revoke", token });
      // Revoking the saved link clears it, so the next create mints a fresh one.
      const saved = readLink();
      if (saved && saved.token === token) writeLink({ ...saved, token: "", createdAt: 0, label: "" });
      return NextResponse.json({ ok: reply.ok === true, code: reply.code ?? null });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
