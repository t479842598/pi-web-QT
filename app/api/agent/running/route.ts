import { getRunningRpcSessionIds, getRunningRpcSessionSnapshots } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { runningSessionIds: getRunningRpcSessionIds(), sessions: getRunningRpcSessionSnapshots() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
