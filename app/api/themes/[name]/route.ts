import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { resolveTheme, type ThemeVariant } from "@/lib/theme";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;
    const mode = (searchParams.get("mode") || "dark") as ThemeVariant;

    // resolveTheme joins `name` into theme-directory paths and also tries it
    // as a direct filesystem path, so a name carrying separators would probe
    // arbitrary files; restrict it to a bare theme name.
    const decodedName = decodeURIComponent(name);
    if (!decodedName || decodedName !== decodedName.trim()
      || /[/\\]/.test(decodedName) || decodedName.includes("..")) {
      return NextResponse.json({ error: "Invalid theme name" }, { status: 400 });
    }
    // `cwd` selects project themes; it must stay inside the same allowed roots
    // the file browser enforces.
    if (cwd) {
      const allowedRoots = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Untrusted theme project directory" }, { status: 403 });
      }
    }

    const resolved = resolveTheme(
      decodedName,
      mode === "light" ? "light" : "dark",
      cwd,
    );

    if (!resolved) {
      return NextResponse.json(
        { error: `Theme "${name}" variant "${mode}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved);
  } catch (error) {
    console.error("Failed to resolve theme:", error);
    return NextResponse.json(
      { error: "Failed to resolve theme" },
      { status: 500 },
    );
  }
}
