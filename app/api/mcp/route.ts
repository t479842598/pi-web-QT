import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type { McpServerConfig } from "@/lib/api-types";
import { normalizeMcpServers, validateMcpServers } from "@/lib/mcp-config";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mcpFilePath(): string {
  return path.join(getAgentDir(), "mcp.json");
}

class McpConfigReadError extends Error {
  constructor() {
    super("Cannot read mcp.json: configuration is unreadable or invalid. Repair it before saving.");
  }
}

function readMcpServers(): Record<string, McpServerConfig> {
  return normalizeMcpServers(readMcpDocument().mcpServers);
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      mcpServers: readMcpServers(),
      filePath: mcpFilePath(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof McpConfigReadError ? 422 : 500 },
    );
  }
}

/** Read the whole mcp.json document so a write preserves sibling keys the
 *  editor does not manage (notably the extension's `settings` block). */
function readMcpDocument(): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(mcpFilePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new McpConfigReadError();
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) throw new McpConfigReadError();
    if (parsed.mcpServers !== undefined && (!isRecord(parsed.mcpServers)
      || !Object.values(parsed.mcpServers).every(isRecord))) throw new McpConfigReadError();
    return parsed;
  } catch {
    // Parsing errors can quote credentials; never return their source excerpts.
    throw new McpConfigReadError();
  }
}

/** Full replacement of the `mcpServers` map. Sibling keys are preserved. */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body: unknown = await req.json().catch(() => null);
    if (!isRecord(body) || !isRecord(body.mcpServers)) {
      return NextResponse.json({ error: "mcpServers must be an object" }, { status: 400 });
    }

    // Validate the ENTIRE map before writing anything: a full replacement that
    // rejects one server must not leave the others half-applied, and it must
    // never silently drop a server the UI cannot represent.
    const problem = validateMcpServers(body.mcpServers);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const document = { ...readMcpDocument(), mcpServers: body.mcpServers };
    writePrivateFileAtomicSync(mcpFilePath(), `${JSON.stringify(document, null, 2)}\n`);
    return NextResponse.json({ success: true, filePath: mcpFilePath() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof McpConfigReadError ? 409 : 500 },
    );
  }
}