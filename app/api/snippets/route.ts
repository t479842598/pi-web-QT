import { createSnippet, listSnippets } from "@/lib/snippet-store";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// GET /api/snippets → { snippets: SnippetItem[] }
// POST /api/snippets { name, content } → { snippet }
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return new Response("Access denied", { status: 403 });
  return Response.json({ snippets: listSnippets() });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return new Response("Access denied", { status: 403 });
  try {
    const body = await req.json() as unknown;
    if (!isRecord(body) || typeof body.name !== "string" || typeof body.content !== "string") {
      return Response.json({ error: "name and content (strings) are required" }, { status: 400 });
    }
    const name = body.name.trim();
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    const snippet = createSnippet({ name, content: body.content });
    return Response.json({ snippet }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
