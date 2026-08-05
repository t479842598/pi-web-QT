import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getImportJob } from "@/lib/import-executor";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = getImportJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    done: job.done,
    total: job.total,
    imported: job.imported,
    skipped: job.skipped,
    errors: job.errors,
    currentFile: job.currentFile,
    sessionIds: job.done ? job.sessionIds : undefined,
  });
}
