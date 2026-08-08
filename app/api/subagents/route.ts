import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type { SubagentsConfig, SubagentsConfigResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

/** Whitelist of fields pi-subagents reads from subagents.json. Unknown keys
 *  are dropped on write so the UI can never corrupt unrelated state. */
const FIELD_WHITELIST: Array<{ key: keyof SubagentsConfig; kind: "number" | "boolean" | "string" }> = [
  { key: "maxConcurrent", kind: "number" },
  { key: "defaultMaxTurns", kind: "number" },
  { key: "graceTurns", kind: "number" },
  { key: "defaultJoinMode", kind: "string" },
  { key: "schedulingEnabled", kind: "boolean" },
  { key: "scopeModels", kind: "boolean" },
  { key: "disableDefaultAgents", kind: "boolean" },
  { key: "toolDescriptionMode", kind: "string" },
  { key: "fleetView", kind: "boolean" },
  { key: "widgetMode", kind: "string" },
  { key: "outputTranscript", kind: "boolean" },
];

const JOIN_MODES = new Set(["async", "group", "smart"]);
const TOOL_MODES = new Set(["full", "compact", "custom"]);
const WIDGET_MODES = new Set(["all", "background", "off"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subagentsFilePath(): string {
  return path.join(getAgentDir(), "subagents.json");
}

function readConfig(): SubagentsConfig {
  const filePath = subagentsFilePath();
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed as SubagentsConfig : {};
  } catch {
    return {};
  }
}

function sanitizeField(key: keyof SubagentsConfig, kind: "number" | "boolean" | "string", value: unknown): unknown {
  switch (kind) {
    case "number": {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        const parsed = Number(value);
        return parsed >= 0 ? parsed : undefined;
      }
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "string": {
      if (typeof value !== "string") return undefined;
      if (key === "defaultJoinMode" && !JOIN_MODES.has(value)) return undefined;
      if (key === "toolDescriptionMode" && !TOOL_MODES.has(value)) return undefined;
      if (key === "widgetMode" && !WIDGET_MODES.has(value)) return undefined;
      return value;
    }
  }
}

/** Filter an incoming body down to the whitelisted fields. */
export function sanitizeSubagentsConfig(body: unknown): SubagentsConfig {
  const out: SubagentsConfig = {};
  if (!isRecord(body)) return out;
  for (const { key, kind } of FIELD_WHITELIST) {
    if (body[key] === undefined || body[key] === null) continue;
    const cleaned = sanitizeField(key, kind, body[key]);
    if (cleaned !== undefined) (out as Record<string, unknown>)[key] = cleaned;
  }
  return out;
}

function discoverAgents(): SubagentsConfigResponse["agents"] {
  const agentsDir = path.join(getAgentDir(), "agents");
  if (!existsSync(agentsDir)) return [];
  const agents: SubagentsConfigResponse["agents"] = [];
  for (const entry of readdirSync(agentsDir)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(agentsDir, entry);
    const base = { name: entry.replace(/\.md$/, "") };
    try {
      const content = readFileSync(filePath, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      if (isRecord(frontmatter)) {
        agents.push({
          ...base,
          displayName: typeof frontmatter.display_name === "string" ? frontmatter.display_name : undefined,
          description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
          model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
        });
        continue;
      }
    } catch {
      // parseFrontmatter rejects some compact YAML (e.g. a `:` inside an
      // unquoted description like "src/**/*.ts"). Fall back to a lenient
      // line scan below so the agent still shows up in the list.
    }
    // Lenient fallback: grab simple `key: value` lines from the frontmatter block.
    const agent: SubagentsConfigResponse["agents"][number] = { ...base };
    try {
      const heading = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(filePath, "utf8"))?.[1] ?? "";
      for (const line of heading.split(/\r?\n/)) {
        const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
        if (!match) continue;
        const value = match[2].replace(/^["']|["']$/g, "");
        if (match[1] === "display_name" && agent.displayName === undefined) agent.displayName = value;
        else if (match[1] === "description" && agent.description === undefined) agent.description = value;
        else if (match[1] === "model" && agent.model === undefined) agent.model = value;
      }
    } catch {
      // Unreadable agent file — keep the bare name entry.
    }
    agents.push(agent);
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      config: readConfig(),
      filePath: subagentsFilePath(),
      agents: discoverAgents(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** Merge incoming whitelisted fields over the current config. */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as unknown;
    const next = sanitizeSubagentsConfig(body);
    writePrivateFileAtomicSync(subagentsFilePath(), `${JSON.stringify(next, null, 2)}\n`);
    return NextResponse.json({ success: true, filePath: subagentsFilePath(), config: next });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}