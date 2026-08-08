import { deleteSnippet, updateSnippet } from "@/lib/snippet-store";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// PUT /api/snippets/[id] { name?, content? } → { snippet }
// DELETE /api/snippets/[id] → { deleted: true }
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return new Response("Access denied", { status: 403 });
  const { id } = await params;
  try {
    const body = await req.json() as unknown;
    if (!isRecord(body)) return Response.json({ error: "Invalid body" }, { status: 400 });
    const patch: { name?: string; content?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") return Response.json({ error: "name must be a string" }, { status: 400 });
      patch.name = body.name;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== "string") return Response.json({ error: "content must be a string" }, { status: 400 });
      patch.content = body.content;
    }
    const snippet = updateSnippet(id, patch);
    if (!snippet) return Response.json({ error: "Snippet not found" }, { status: 404 });
    return Response.json({ snippet });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return new Response("Access denied", { status: 403 });
  const { id } = await params;
  const deleted = deleteSnippet(id);
  if (!deleted) return Response.json({ error: "Snippet not found" }, { status: 404 });
  return Response.json({ deleted: true });
}
