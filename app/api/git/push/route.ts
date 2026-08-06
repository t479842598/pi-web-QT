import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { isApiRequestAllowed } from "@/lib/request-security";
import { gitPush } from "@/lib/git-ops";

export const dynamic = "force-dynamic";

/** POST /api/git/push?cwd= — push the current branch of the given directory. */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    if (!cwd || !existsSync(cwd)) {
      return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
    }
    const result = await gitPush(cwd);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.output, branch: result.branch }, { status: 502 });
    }
    return NextResponse.json({ ok: true, output: result.output, branch: result.branch });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
