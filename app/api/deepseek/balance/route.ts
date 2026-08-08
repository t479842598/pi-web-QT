import { getAgentDir, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 64 * 1024;

/** DeepSeek GET /user/balance response shape (official docs + Reasonix schema). */
interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
}

/**
 * Query the DeepSeek official wallet balance with the stored apiKey.
 * The api key never leaves the server; failures degrade to `available: false`
 * so the UI can silently omit the readout (same policy as the Reasonix
 * billing package). CNY balance is preferred when the account returns
 * multiple currencies.
 */
export async function GET() {
  const credential = readStoredCredential("deepseek", join(getAgentDir(), "auth.json"));
  const apiKey = credential?.type === "api_key" ? credential.key : undefined;
  if (!apiKey) {
    return Response.json({ available: false, reason: "no-credential" });
  }

  let body: string;
  let status: number;
  try {
    const res = await fetch(BALANCE_URL, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    status = res.status;
    const raw = await res.arrayBuffer();
    body = Buffer.from(raw.slice(0, MAX_BODY_BYTES)).toString("utf8");
  } catch (err) {
    console.error("[deepseek/balance] fetch failed:", err instanceof Error ? err.message : String(err));
    return Response.json({ available: false, reason: "fetch-failed" });
  }

  if (status !== 200) {
    console.error(`[deepseek/balance] upstream status ${status}`);
    return Response.json({ available: false, reason: "upstream-status" });
  }

  let parsed: DeepSeekBalanceResponse;
  try {
    parsed = JSON.parse(body) as DeepSeekBalanceResponse;
  } catch {
    console.error("[deepseek/balance] invalid upstream JSON");
    return Response.json({ available: false, reason: "decode-failed" });
  }

  const infos = Array.isArray(parsed.balance_infos) ? parsed.balance_infos : [];
  const pick =
    infos.find((i) => i.currency?.toUpperCase() === "CNY") ??
    infos[0];
  if (!pick || typeof pick.total_balance !== "string") {
    return Response.json({ available: false, reason: "no-balance-info" });
  }

  return Response.json(
    {
      available: parsed.is_available !== false,
      currency: pick.currency,
      totalBalance: pick.total_balance,
      grantedBalance: pick.granted_balance ?? "0.00",
      toppedUpBalance: pick.topped_up_balance ?? "0.00",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}