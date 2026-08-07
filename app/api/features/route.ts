import { NextResponse } from "next/server";
import { readFeaturesConfig, writeFeaturesConfig, type FeaturesConfig } from "@/lib/features-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readFeaturesConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const current = readFeaturesConfig();
    const next: FeaturesConfig = {
      tasksBoard: typeof body.tasksBoard === "boolean" ? body.tasksBoard : current.tasksBoard,
    };
    await writeFeaturesConfig(next);
    return NextResponse.json({ success: true, features: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
