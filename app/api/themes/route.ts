import { NextRequest, NextResponse } from "next/server";
import { getDefaultThemePreview, listThemeSets } from "@/lib/theme";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;
    // The settings UI passes its resolved mode so each card's preview palette
    // matches what selecting that theme would look like right now.
    const preferDark = searchParams.get("mode") !== "light";

    const themeSets = listThemeSets(cwd, preferDark);

    return NextResponse.json({
      themeSets,
      defaultPreview: getDefaultThemePreview(preferDark),
    });
  } catch (error) {
    console.error("Failed to list themes:", error);
    return NextResponse.json(
      { error: "Failed to list themes" },
      { status: 500 },
    );
  }
}
