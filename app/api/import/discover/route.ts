import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { listImportSources, discoverReasonix } from "@/lib/import-sources";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const sources = listImportSources();
    const reasonix = discoverReasonix();

    return NextResponse.json({ sources, reasonix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
