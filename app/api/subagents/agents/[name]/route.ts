import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Agent names map to <agentDir>/agents/<name>.md. Reject anything that
 *  could escape that directory (path traversal or absolute paths). */
function safeAgentPath(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name === ".") return null;
  return path.join(getAgentDir(), "agents", `${name}.md`);
}

/**
 * Update the `model` frontmatter key of an agent markdown file.
 * PATCH /api/subagents/agents/[name] { model: string | null }
 * - model: "provider/modelId" (or any value pi accepts) — writes/replaces the
 *   model: line.
 * - model: null — removes the model: line (agent falls back to the default).
 * The rest of the frontmatter and the body are preserved byte-for-byte
 * (surgical line edit, mirroring app/api/skills/route.ts).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const { name } = await params;
    const agentPath = safeAgentPath(name);
    if (!agentPath || !existsSync(agentPath)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = (await req.json()) as { model?: unknown };
    if (body.model !== undefined && body.model !== null && typeof body.model !== "string") {
      return NextResponse.json({ error: "model must be a string or null" }, { status: 400 });
    }
    const nextModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;

    const content = readFileSync(agentPath, "utf8");
    const key = "model";
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    const currentModel = typeof frontmatter[key] === "string" ? frontmatter[key] : null;

    let updated = content;
    if (nextModel === null) {
      if (currentModel !== null) {
        // Remove the model line entirely, preserving everything else.
        updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
      }
    } else if (currentModel !== null) {
      // Replace the existing model line.
      updated = content.replace(new RegExp(`^${key}\\s*:.*$`, "m"), `${key}: ${nextModel}`);
    } else if (/^---\r?\n/.test(content)) {
      // Frontmatter exists but no model line — insert right after the opening ---.
      updated = content.replace(/^---\r?\n/, `---\n${key}: ${nextModel}\n`);
    } else {
      // No frontmatter at all — create one.
      updated = `---\n${key}: ${nextModel}\n---\n${content}`;
    }

    writePrivateFileAtomicSync(agentPath, updated);
    return NextResponse.json({ success: true, agent: name, model: nextModel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}