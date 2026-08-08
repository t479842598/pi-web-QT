import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type { McpServerConfig } from "@/lib/api-types";

export const dynamic = "force-dynamic";

const SERVER_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const TRANSPORTS = new Set(["stdio", "sse", "http"]);
const LIFECYCLES = new Set(["eager", "lazy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mcpFilePath(): string {
  return path.join(getAgentDir(), "mcp.json");
}

function readMcpServers(): Record<string, McpServerConfig> {
  const filePath = mcpFilePath();
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { mcpServers?: unknown };
    return isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers as Record<string, McpServerConfig> : {};
  } catch {
    return {};
  }
}

/** Validate one server entry against the mcp.json contract. Unknown fields
 *  (env / requestTimeoutMs / cwd / ...) are passed through untouched. */
function validateServer(name: string, value: unknown): string | null {
  if (!SERVER_NAME_RE.test(name)) return `Invalid server name "${name}" (allowed: letters, digits, _ and -)`;
  if (!isRecord(value)) return `Server "${name}" must be an object`;
  if (typeof value.command !== "string" || !value.command.trim()) {
    return `Server "${name}" requires a string command`;
  }
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
      return `Server "${name}" args must be an array of strings`;
    }
  }
  if (value.transport !== undefined && !TRANSPORTS.has(value.transport as string)) {
    return `Server "${name}" transport must be one of stdio, sse, http`;
  }
  if (value.lifecycle !== undefined && !LIFECYCLES.has(value.lifecycle as string)) {
    return `Server "${name}" lifecycle must be one of eager, lazy`;
  }
  return null;
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
      { status: 500 },
    );
  }
}

/** Full replacement of the `mcpServers` map. */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as { mcpServers?: unknown };
    if (!isRecord(body) || !isRecord(body.mcpServers)) {
      return NextResponse.json({ error: "mcpServers must be an object" }, { status: 400 });
    }

    const servers = body.mcpServers;
    for (const [name, value] of Object.entries(servers)) {
      const problem = validateServer(name, value);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    writePrivateFileAtomicSync(mcpFilePath(), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
    return NextResponse.json({ success: true, filePath: mcpFilePath() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}