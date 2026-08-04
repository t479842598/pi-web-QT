import { NextResponse } from "next/server";
import { createBackupZip } from "@/lib/backup";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as { includeSecrets?: boolean; includeSessions?: boolean };
    const buffer = createBackupZip({
      includeSecrets: body.includeSecrets !== false,
      includeSessions: body.includeSessions === true,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="pi-backup-${ts}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
