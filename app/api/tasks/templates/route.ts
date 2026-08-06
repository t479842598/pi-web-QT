import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { deleteTemplateRow, listTemplates, saveTemplate } from "@/lib/task-store";
import type { WorkTaskTemplate } from "@/lib/task-types";

function nextTemplateId(templates: WorkTaskTemplate[]): number {
  return templates.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}

// GET /api/tasks/templates
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return NextResponse.json({ templates: listTemplates() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/tasks/templates  body: { name, title, config }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  try {
    const body = (await req.json()) as { name?: unknown; title?: unknown; config?: unknown };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const config = (body.config ?? {}) as { prompt?: unknown };
    const templates = listTemplates();
    const now = new Date().toISOString();
    const existing = templates.find((t) => t.name === body.name);
    const template: WorkTaskTemplate = {
      id: existing?.id ?? nextTemplateId(templates),
      name: body.name.trim(),
      title: body.title.trim(),
      config: { prompt: typeof config.prompt === "string" ? config.prompt : "" },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveTemplate(template);
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/tasks/templates?id=
export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    deleteTemplateRow(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
