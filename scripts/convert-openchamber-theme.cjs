#!/usr/bin/env node
/**
 * Convert OpenChamber themes (metadata+colors layered JSON) into pi-web's
 * built-in theme format (BuiltinThemeSet: displayName + light/dark variant
 * with the ~17 semantic fields pi-web maps to CSS variables).
 *
 * Input : scripts/vendor/openchamber-themes/<id>-<variant>.json (vendored)
 * Output: lib/theme/openchamber/<name>.json  (paired dark+light per theme)
 *
 * Mapping (OpenChamber color group -> pi-web semantic field):
 *   surface.background        -> bg
 *   surface.elevated          -> panel        (elevated surface)
 *   surface.muted             -> hover        (muted surface ~ hover tint)
 *   surface.subtle            -> selected / subtle
 *   interactive.border        -> border
 *   surface.foreground        -> text
 *   surface.mutedForeground   -> muted / dim
 *   primary.base              -> accent
 *   primary.hover             -> accentHover
 *   chat.userMessageBackground-> userBg
 *   chat.assistantMessageBackground -> assistantBg
 *   tools.background          -> toolBg
 *   status.error/success/warning -> red / green / orange
 *
 * Missing fields fall back through the chain and finally to the background
 * color so every generated theme stays renderable. Run once; outputs are
 * committed so the runtime has zero conversion cost.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "vendor", "openchamber-themes");
const OUT_DIR = path.join(__dirname, "..", "lib", "theme", "openchamber");

// ─── small color helpers ───────────────────────────────────────────────────

function isHex(value) {
  return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

/** Strip alpha to a solid hex (fallback chain target). */
function opaque(value) {
  if (!isHex(value)) return null;
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  if (hex.length === 8) hex = hex.slice(0, 6);
  return `#${hex.toLowerCase()}`;
}

/** Blend a translucent color over a background and return an opaque hex. */
function blendOver(fg, bg) {
  if (!isHex(fg) || !isHex(bg)) return null;
  const parse = (h) => {
    let s = h.slice(1);
    if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
    if (s.length === 8) {
      const a = parseInt(s.slice(6, 8), 16) / 255;
      s = s.slice(0, 6);
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a };
    }
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  };
  const f = parse(fg);
  const b = parse(bg);
  const mix = (fv, bv) => Math.round(fv * f.a + bv * (1 - f.a));
  const r = mix(f.r, b.r), g = mix(f.g, b.g), bl = mix(f.b, b.b);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function pick(theme, group, key, ...fallbacks) {
  const value = theme?.colors?.[group]?.[key];
  if (isHex(value)) return opaque(value);
  for (const fb of fallbacks) {
    const resolved = fb();
    if (resolved) return resolved;
  }
  return null;
}

// ─── conversion ────────────────────────────────────────────────────────────

function convertVariant(raw, fallbackBg) {
  const c = raw.colors || {};
  const surface = c.surface || {};
  const interactive = c.interactive || {};
  const primary = c.primary || {};
  const status = c.status || {};
  const chat = c.chat || {};
  const tools = c.tools || {};

  const bg = opaque(surface.background) || fallbackBg;
  const bgRef = () => bg;

  const variant = {
    bg,
    panel: pick(raw, "surface", "elevated", () => opaque(surface.muted), bgRef),
    hover: pick(raw, "surface", "muted", () => opaque(surface.subtle), () => blendOver(surface.muted, bg), bgRef),
    selected: pick(raw, "surface", "subtle", () => opaque(surface.muted), () => blendOver(surface.muted, bg), bgRef),
    border: pick(raw, "interactive", "border", () => opaque(interactive.borderFocus), () => "#404040", bgRef),
    text: pick(raw, "surface", "foreground", () => "#cccccc"),
    muted: pick(raw, "surface", "mutedForeground", () => opaque(surface.foreground), () => "#888888"),
    dim: pick(raw, "surface", "mutedForeground", () => "#777777"),
    accent: pick(raw, "primary", "base", () => "#0d9488"),
    accentHover: pick(raw, "primary", "hover", () => opaque(primary.base), () => "#0f766e"),
    userBg: pick(raw, "chat", "userMessageBackground", () => opaque(primary.muted), () => blendOver(primary.muted, bg), () => blendOver(surface.muted, bg), bgRef),
    assistantBg: pick(raw, "chat", "assistantMessageBackground", () => opaque(surface.elevated), () => bgRef()),
    toolBg: pick(raw, "tools", "background", () => opaque(surface.subtle), () => blendOver(surface.muted, bg), bgRef),
    subtle: pick(raw, "surface", "subtle", () => blendOver(surface.muted, bg), () => "rgba(0,0,0,0.04)"),
    red: pick(raw, "status", "error", () => "#dc2626"),
    green: pick(raw, "status", "success", () => "#16a34a"),
    orange: pick(raw, "status", "warning", () => "#d97706"),
  };

  // Normalize: subtle may keep an alpha form for dark backgrounds; for the
  // built-in set it must be a solid-ish color the CSS layer can use.
  if (typeof variant.subtle === "string" && variant.subtle.startsWith("rgba")) {
    // keep — resolveBuiltinTheme only forwards the string
  }
  return variant;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Vendored OpenChamber themes not found at ${SRC_DIR}`);
    console.error("Run: git clone --depth 1 --sparse https://github.com/openchamber/openchamber.git && cd openchamber && git sparse-checkout set packages/ui/src/lib/theme/themes, then copy the *.json here.");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"));
  const byName = new Map();
  let skipped = 0;

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
    } catch {
      console.warn(`  skip (parse) ${file}`);
      skipped++;
      continue;
    }
    const variant = raw?.metadata?.variant;
    if (variant !== "light" && variant !== "dark") {
      console.warn(`  skip (no variant) ${file}`);
      skipped++;
      continue;
    }
    const metaName = raw.metadata?.name || raw.metadata?.id || file.replace(/\.json$/, "");
    // Pair key from the display name ("Flexoki" dark+light both -> "flexoki";
    // "Vitesse Dark"/"Vitesse Light" stay separate single-variant themes).
    const key = metaName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || file.replace(/\.json$/, "");
    if (!byName.has(key)) byName.set(key, { displayName: metaName, light: null, dark: null });
    const entry = byName.get(key);
    if (!entry.displayName || entry.displayName === key) entry.displayName = metaName;
    entry[variant] = raw;
  }

  let written = 0;
  for (const [key, entry] of byName) {
    const bg = entry.dark?.colors?.surface?.background || entry.light?.colors?.surface?.background || "#1a1a1a";
    const out = {
      displayName: entry.displayName || key,
      dark: entry.dark ? convertVariant(entry.dark, bg) : null,
      light: entry.light ? convertVariant(entry.light, bg) : null,
    };
    const outPath = path.join(OUT_DIR, `${key}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    written++;
  }

  console.log(`Converted ${written} themes -> ${OUT_DIR} (skipped ${skipped} files)`);
}

main();
