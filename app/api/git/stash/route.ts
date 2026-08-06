import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { listStashes, stashPush, stashDrop, stashPop, type StashEntry } from "@/lib/git-ops";

export const dynamic = "force-dynamic";

function readCwd(req: Request): string | null {
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd");
  return cwd && existsSync(cwd) ? cwd : null;
}

/** GET /api/git/stash?cwd= — list stash entries. */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const cwd = readCwd(req);
  if (!cwd) return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
  try {
    const entries: StashEntry[] = await listStashes(cwd);
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/git/stash?cwd=
 * body: { action: "push" | "drop" | "pop", message?, ref? }
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  const cwd = readCwd(req);
  if (!cwd) return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
  try {
    const body = await req.json() as { action?: string; message?: string; ref?: string };
    const action = body.action;
    if (action === "push") {
      const output = await stashPush(cwd, body.message);
      return NextResponse.json({ ok: true, output });
    }
    if (action === "drop") {
      if (!body.ref) return NextResponse.json({ error: "ref is required" }, { status: 400 });
      const output = await stashDrop(cwd, body.ref);
      return NextResponse.json({ ok: true, output });
    }
    if (action === "pop") {
      if (!body.ref) return NextResponse.json({ error: "ref is required" }, { status: 400 });
      const output = await stashPop(cwd, body.ref);
      return NextResponse.json({ ok: true, output });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
