import { NextResponse } from "next/server";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ThemeSetInfo {
  name: string;
  variants: Array<{ variant: "dark" | "light" | "base"; file: string }>;
}

/**
 * List custom PI-TUI theme JSON files from the agent themes directory
 * (~/.pi/agent/themes/). Groups files into theme sets by base name using the
 * `-dark.json` / `-light.json` suffix convention. Returns an empty list when
 * the directory does not exist.
 */
export async function GET() {
  const themesDir = join(getAgentDir(), "themes");
  if (!existsSync(themesDir)) {
    return NextResponse.json({ themeSets: [] });
  }

  const themeSets = new Map<string, ThemeSetInfo>();
  for (const file of readdirSync(themesDir)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const base = file.replace(/\.json$/i, "");
    let name = base;
    let variant: "dark" | "light" | "base" = "base";
    const darkMatch = base.match(/^(.*)-dark$/i);
    const lightMatch = base.match(/^(.*)-light$/i);
    if (darkMatch) {
      name = darkMatch[1];
      variant = "dark";
    } else if (lightMatch) {
      name = lightMatch[1];
      variant = "light";
    }
    const set = themeSets.get(name) ?? { name, variants: [] };
    set.variants.push({ variant, file });
    themeSets.set(name, set);
  }

  const themeSetsArray = [...themeSets.values()];
  // Sort base (single-file) sets first, then by name.
  themeSetsArray.sort((a, b) => {
    const aSingle = a.variants.length === 1 && a.variants[0].variant === "base" ? 0 : 1;
    const bSingle = b.variants.length === 1 && b.variants[0].variant === "base" ? 0 : 1;
    if (aSingle !== bSingle) return aSingle - bSingle;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ themeSets: themeSetsArray });
}
