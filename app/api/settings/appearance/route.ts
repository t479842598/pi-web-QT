import { NextResponse } from "next/server";
import { readAppearanceConfig, writeFontScale } from "@/lib/appearance-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readAppearanceConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const raw = body.fontScale;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return NextResponse.json({ error: "fontScale must be a number" }, { status: 400 });
    }
    const appearance = await writeFontScale(raw);
    return NextResponse.json({ success: true, appearance });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
