import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { startReasonixImport } from "@/lib/import-executor";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      source?: string;
      projects?: string[];
    };

    if (!body.source || !body.projects || body.projects.length === 0) {
      return NextResponse.json(
        { error: "Missing source or projects" },
        { status: 400 },
      );
    }

    if (body.source === "reasonix") {
      const { jobId } = startReasonixImport(body.projects);
      return NextResponse.json({ jobId });
    }

    return NextResponse.json(
      { error: `Unsupported source: ${body.source}` },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
