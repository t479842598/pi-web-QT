/**
 * Theme system for pi-web.
 *
 * Loads pi CLI theme JSON files (from ~/.pi/agent/themes/, .pi/themes/, etc.),
 * resolves `vars` references, and maps the 51 pi CLI color tokens to pi-web's
 * ~23 CSS custom properties.
 *
 * Themes are organized as **sets** — each set pairs a dark and a light variant
 * (e.g. "gruvbox" → gruvbox-dark.json + gruvbox-light.json). A set may also
 * contain only one variant (single-file theme).
 *
 * pi CLI theme format:
 *   { name, vars: { key: hex|number, ... }, colors: { token: hex|number|varRef|"", ... } }
 *
 * Color values can be:
 *   - Hex string: "#ff0000"
 *   - 256-color index: 242
 *   - Variable reference: "primary" (resolved from vars)
 *   - Empty string "": terminal default (we derive from palette)
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PiTheme {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
}

/** Represents a paired theme set (e.g. "gruvbox" with dark + light variants). */
export interface ThemeSetInfo {
  /** Base name (e.g. "gruvbox") — used as the stable identifier. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Whether this set has a dark variant. */
  hasDark: boolean;
  /** Whether this set has a light variant. */
  hasLight: boolean;
  /** True for the built-in default theme (no JSON files). */
  builtin: boolean;
  /** Dark variant accent (primary) color — theme swatch dot. */
  accent?: string;
  /** Light variant accent (primary) color — theme swatch dot. */
  accentLight?: string;
}

/** A resolved, ready-to-use theme (one variant of a set). */
export interface ResolvedTheme {
  /** Base theme-set name. */
  name: string;
  /** Whether this specific variant is dark. */
  isDark: boolean;
  /** CSS variable name → hex value (e.g. "--bg" → "#282828") */
  cssVars: Record<string, string>;
}

export type ThemeVariant = "dark" | "light";


type BuiltinThemeVariant = {
  bg: string;
  panel: string;
  hover: string;
  selected: string;
  border: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  accentHover: string;
  userBg: string;
  assistantBg: string;
  toolBg: string;
  subtle: string;
  red: string;
  green: string;
  orange: string;
};

type BuiltinThemeSet = {
  displayName: string;
  light: BuiltinThemeVariant;
  dark: BuiltinThemeVariant;
};

/** Fixed themes retained from the original QT interface. */
const BUILTIN_THEME_SETS: Record<string, BuiltinThemeSet> = {
  gruvbox: {
    displayName: "Gruvbox",
    light: { bg: "#fbf1c7", panel: "#f2e5bc", hover: "#ebdbb2", selected: "#d5c4a1", border: "#bdae93", text: "#3c3836", muted: "#7c6f64", dim: "#a89984", accent: "#458588", accentHover: "#076678", userBg: "#ebdbb2", assistantBg: "#fbf1c7", toolBg: "#f2e5bc", subtle: "rgba(0,0,0,0.04)", red: "#cc241d", green: "#689d6a", orange: "#d65d0e" },
    dark: { bg: "#1d2021", panel: "#282828", hover: "#3c3836", selected: "#504945", border: "#665c54", text: "#ebdbb2", muted: "#a89984", dim: "#7c6f64", accent: "#83a598", accentHover: "#8ec07c", userBg: "#3c3836", assistantBg: "#282828", toolBg: "#32302f", subtle: "rgba(255,255,255,0.04)", red: "#fb4934", green: "#b8bb26", orange: "#d65d0e" },
  },
  nord: {
    displayName: "Nord",
    light: { bg: "#e5e9f0", panel: "#eceff4", hover: "#d8dee9", selected: "#c8d0dd", border: "#b6c2d2", text: "#2e3440", muted: "#4c566a", dim: "#6c7890", accent: "#5e81ac", accentHover: "#81a1c1", userBg: "#d8dee9", assistantBg: "#e5e9f0", toolBg: "#eceff4", subtle: "rgba(46,52,64,0.05)", red: "#bf616a", green: "#a3be8c", orange: "#d08770" },
    dark: { bg: "#2e3440", panel: "#3b4252", hover: "#434c5e", selected: "#4c566a", border: "#5e6680", text: "#eceff4", muted: "#a0aec4", dim: "#7c88a0", accent: "#88c0d0", accentHover: "#81a1c1", userBg: "#434c5e", assistantBg: "#3b4252", toolBg: "#3a4252", subtle: "rgba(236,239,244,0.05)", red: "#bf616a", green: "#a3be8c", orange: "#d08770" },
  },
  tokyo: {
    displayName: "Tokyo Night",
    light: { bg: "#d5d6db", panel: "#e3e4e9", hover: "#c9cad1", selected: "#b8b9c2", border: "#a6a7b5", text: "#343b59", muted: "#4f5670", dim: "#6f7691", accent: "#565f89", accentHover: "#7aa2f7", userBg: "#c9cad1", assistantBg: "#d5d6db", toolBg: "#e3e4e9", subtle: "rgba(52,59,89,0.05)", red: "#f7768e", green: "#9ece6a", orange: "#e0af68" },
    dark: { bg: "#1a1b26", panel: "#24283b", hover: "#2f3549", selected: "#3b4261", border: "#414868", text: "#c0caf5", muted: "#7c83b3", dim: "#565f89", accent: "#7aa2f7", accentHover: "#89ddff", userBg: "#2f3549", assistantBg: "#24283b", toolBg: "#1f2335", subtle: "rgba(192,202,245,0.05)", red: "#f7768e", green: "#9ece6a", orange: "#e0af68" },
  },
  solarized: {
    displayName: "Solarized",
    light: { bg: "#fdf6e3", panel: "#eee8d5", hover: "#e4ddc7", selected: "#d9d2b8", border: "#c3bda8", text: "#586e75", muted: "#7a8a8a", dim: "#93a1a1", accent: "#268bd2", accentHover: "#2aa198", userBg: "#eee8d5", assistantBg: "#fdf6e3", toolBg: "#eee8d5", subtle: "rgba(88,110,117,0.06)", red: "#dc322f", green: "#859900", orange: "#b58900" },
    dark: { bg: "#002b36", panel: "#073642", hover: "#0e4250", selected: "#14505e", border: "#2c5c66", text: "#839496", muted: "#6d8284", dim: "#586e75", accent: "#268bd2", accentHover: "#2aa198", userBg: "#0e4250", assistantBg: "#073642", toolBg: "#05313c", subtle: "rgba(131,148,150,0.08)", red: "#dc322f", green: "#859900", orange: "#b58900" },
  },
  onedark: {
    displayName: "One Dark",
    light: { bg: "#fafafa", panel: "#f0f0f0", hover: "#e5e5e5", selected: "#d8d8d8", border: "#c8c8c8", text: "#383a42", muted: "#7f848e", dim: "#a0a1a7", accent: "#4078f2", accentHover: "#005cc5", userBg: "#e8e8f0", assistantBg: "#fafafa", toolBg: "#f0f0f0", subtle: "rgba(56,58,66,0.04)", red: "#e06c75", green: "#98c379", orange: "#d19a66" },
    dark: { bg: "#282c34", panel: "#21252b", hover: "#2c313a", selected: "#3b4048", border: "#4b5263", text: "#abb2bf", muted: "#7d8799", dim: "#5c6370", accent: "#61afef", accentHover: "#528bff", userBg: "#2c313a", assistantBg: "#21252b", toolBg: "#1e2227", subtle: "rgba(171,178,191,0.06)", red: "#e06c75", green: "#98c379", orange: "#d19a66" },
  },
  dracula: {
    displayName: "Dracula",
    light: { bg: "#f8f8f2", panel: "#f0f0ea", hover: "#e6e6de", selected: "#d8d8cf", border: "#c6c6bb", text: "#282a36", muted: "#5f6380", dim: "#8a8fae", accent: "#6272a4", accentHover: "#44475a", userBg: "#e6e6de", assistantBg: "#f8f8f2", toolBg: "#f0f0ea", subtle: "rgba(40,42,54,0.05)", red: "#ff5555", green: "#50fa7b", orange: "#ffb86c" },
    dark: { bg: "#282a36", panel: "#21222c", hover: "#343746", selected: "#44475a", border: "#4a4d63", text: "#f8f8f2", muted: "#9094ad", dim: "#6272a4", accent: "#bd93f9", accentHover: "#ff79c6", userBg: "#343746", assistantBg: "#21222c", toolBg: "#1e1f29", subtle: "rgba(248,248,242,0.05)", red: "#ff5555", green: "#50fa7b", orange: "#ffb86c" },
  },
  catppuccin: {
    displayName: "Catppuccin",
    light: { bg: "#eff1f5", panel: "#e6e9ef", hover: "#dce0e8", selected: "#ccd0da", border: "#bcc0cc", text: "#4c4f69", muted: "#6c6f85", dim: "#8c8fa1", accent: "#1e66f5", accentHover: "#7287fd", userBg: "#dce0e8", assistantBg: "#eff1f5", toolBg: "#e6e9ef", subtle: "rgba(76,79,105,0.05)", red: "#d20f39", green: "#40a02b", orange: "#df8e1d" },
    dark: { bg: "#1e1e2e", panel: "#181825", hover: "#313244", selected: "#45475a", border: "#585b70", text: "#cdd6f4", muted: "#8f93b2", dim: "#6c7086", accent: "#89b4fa", accentHover: "#b4befe", userBg: "#313244", assistantBg: "#181825", toolBg: "#14141f", subtle: "rgba(205,214,244,0.05)", red: "#f38ba8", green: "#a6e3a1", orange: "#fab387" },
  },
};

// ─── OpenChamber built-in themes ────────────────────────────────────────────

const OPENCHAMBER_THEMES_DIR = join(process.cwd(), "lib", "theme", "openchamber");

/**
 * Load the OpenChamber themes converted by scripts/convert-openchamber-theme.cjs.
 * Each file is a BuiltinThemeSet ({ displayName, light, dark }) so the existing
 * resolve/list paths can treat them identically to the QT themes.
 */
function loadOpenChamberThemeSets(): Record<string, BuiltinThemeSet> {
  const result: Record<string, BuiltinThemeSet> = {};
  try {
    if (!existsSync(OPENCHAMBER_THEMES_DIR)) return result;
    for (const entry of readdirSync(OPENCHAMBER_THEMES_DIR)) {
      if (!entry.endsWith(".json")) continue;
      const fullPath = join(OPENCHAMBER_THEMES_DIR, entry);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as BuiltinThemeSet;
        if (!parsed || typeof parsed !== "object") continue;
        result[basename(entry, ".json")] = parsed;
      } catch {
        // Skip malformed converted themes.
      }
    }
  } catch {
    // Directory missing — no OpenChamber themes.
  }
  return result;
}

const OPENCHAMBER_THEME_SETS = loadOpenChamberThemeSets();

/**
 * All built-in themes. Existing QT themes win on name collisions so users who
 * already selected e.g. "gruvbox" keep the familiar QT palette; OpenChamber
 * themes fill in every name the QT set does not provide.
 */
const ALL_BUILTIN_THEME_SETS: Record<string, BuiltinThemeSet> = {
  ...OPENCHAMBER_THEME_SETS,
  ...BUILTIN_THEME_SETS,
};

function resolveBuiltinTheme(name: string, variant: ThemeVariant): ResolvedTheme | null {
  const theme = ALL_BUILTIN_THEME_SETS[name];
  if (!theme) return null;
  const colors = theme[variant];
  if (!colors) return null;
  const cssVars: Record<string, string> = {
    "--bg": colors.bg,
    "--bg-panel": colors.panel,
    "--bg-secondary": colors.panel,
    "--bg-card": colors.panel,
    "--bg-hover": colors.hover,
    "--bg-selected": colors.selected,
    "--bg-card-hover": colors.hover,
    "--bg-subtle": colors.subtle,
    "--border": colors.border,
    "--border-hover": colors.accentHover,
    "--text": colors.text,
    "--text-muted": colors.muted,
    "--text-dim": colors.dim,
    "--accent": colors.accent,
    "--accent-hover": colors.accentHover,
    "--accent-blue": colors.accent,
    "--accent-red": colors.red,
    "--accent-green": colors.green,
    "--accent-orange": colors.orange,
    "--git-status-added": colors.green,
    "--git-status-modified": colors.orange,
    "--git-status-deleted": colors.red,
    "--git-status-added-bg": colors.userBg,
    "--git-status-modified-bg": colors.hover,
    "--git-status-deleted-bg": colors.hover,
    "--user-bg": colors.userBg,
    "--assistant-bg": colors.assistantBg,
    "--tool-bg": colors.toolBg,
    "--hatch-color": colors.subtle,
    // Semantic status tokens
    "--status-error": colors.red,
    "--status-warning": colors.orange,
    "--status-success": colors.green,
    "--status-info": colors.accent,
    "--status-error-bg": `color-mix(in srgb, ${colors.red} 14%, var(--bg))`,
    "--status-warning-bg": `color-mix(in srgb, ${colors.orange} 14%, var(--bg))`,
    "--status-success-bg": `color-mix(in srgb, ${colors.green} 14%, var(--bg))`,
    "--status-info-bg": `color-mix(in srgb, ${colors.accent} 14%, var(--bg))`,
    "--status-error-border": `color-mix(in srgb, ${colors.red} 45%, var(--bg))`,
    "--status-warning-border": `color-mix(in srgb, ${colors.orange} 45%, var(--bg))`,
    "--status-success-border": `color-mix(in srgb, ${colors.green} 45%, var(--bg))`,
    "--status-info-border": `color-mix(in srgb, ${colors.accent} 45%, var(--bg))`,
    // Syntax highlighting tokens (derived from the palette; OpenChamber themes
    // override via their converted syntax colors).
    "--syntax-keyword": colors.accent,
    "--syntax-string": colors.orange,
    "--syntax-number": colors.accent,
    "--syntax-function": colors.accent,
    "--syntax-comment": colors.dim,
  };
  return { name, isDark: variant === "dark", cssVars };
}

// ─── 256-color palette → hex ────────────────────────────────────────────────

// Standard xterm 256-color palette. 0-15: ANSI, 16-231: 6x6x6 cube, 232-255: grayscale.
function ansiToHex(code: number): string {
  // 0-15: basic ANSI colors
  const ansi: Record<number, string> = {
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
  };
  if (code in ansi) return ansi[code];

  // 16-231: 6×6×6 RGB cube
  if (code >= 16 && code <= 231) {
    const n = code - 16;
    const r = Math.round((Math.floor(n / 36) % 6) * (255 / 5));
    const g = Math.round((Math.floor(n / 6) % 6) * (255 / 5));
    const b = Math.round((n % 6) * (255 / 5));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 232-255: grayscale ramp
  if (code >= 232 && code <= 255) {
    const v = Math.round(((code - 232) / 23) * 255);
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }

  return "#000000";
}

// ─── Color resolution ───────────────────────────────────────────────────────

/**
 * Resolve a single color value to a hex string.
 * - Hex string: returned as-is (lowercased)
 * - Number: treated as 256-color index, converted to hex
 * - String matching a var name: resolved from vars
 * - Empty string: returns empty (caller should substitute default)
 */
function resolveColor(
  value: string | number | undefined,
  vars: Record<string, string>,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return ansiToHex(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("#")) return trimmed.toLowerCase();
    // Variable reference
    if (vars[trimmed]) return vars[trimmed].toLowerCase();
    // Could be a raw number-as-string: "242"
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed === String(num)) return ansiToHex(num);
    // Unknown reference — return as-is (may be valid hex without #)
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
    return trimmed.toLowerCase();
  }
  return "";
}

/** Resolve all `vars` entries to hex strings. */
function resolveVars(vars: Record<string, string | number> | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!vars) return resolved;
  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = resolveColor(value, {});
  }
  return resolved;
}

/** Resolve all `colors` entries, expanding var references. */
function resolveColors(
  colors: Record<string, string | number>,
  vars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveColor(value, vars);
  }
  return resolved;
}

// ─── Color manipulation helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Lighten a hex color by mixing with white. factor 0 = no change, 1 = white. */
function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r + (255 - r) * factor),
    Math.round(g + (255 - g) * factor),
    Math.round(b + (255 - b) * factor),
  );
}

/** Darken a hex color by mixing with black. factor 0 = no change, 1 = black. */
function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r * (1 - factor)),
    Math.round(g * (1 - factor)),
    Math.round(b * (1 - factor)),
  );
}

/** Mix two hex colors. factor 0 = all a, factor 1 = all b. */
function mix(a: string, b: string, factor: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    Math.round(ra[0] + (rb[0] - ra[0]) * factor),
    Math.round(ra[1] + (rb[1] - ra[1]) * factor),
    Math.round(ra[2] + (rb[2] - ra[2]) * factor),
  );
}

/** Calculate relative luminance (0-1). Used to determine dark vs light. */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
}

/**
 * Preserve a theme status color's hue while making a modest contrast adjustment.
 * Git status has redundant text, dot, and capsule-background signals, so 3:1
 * keeps green and yellow distinguishable in light themes better than forcing
 * every status color to normal-text 4.5:1 contrast.
 */
function ensureContrast(color: string, background: string, minimum = 3): string {
  if (!hexToRgb(color) || !hexToRgb(background) || contrastRatio(color, background) >= minimum) {
    return color;
  }

  const darkenForContrast = relativeLuminance(background) > relativeLuminance(color);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = darkenForContrast
      ? darken(color, step * 0.05)
      : lighten(color, step * 0.05);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return darkenForContrast ? "#000000" : "#ffffff";
}

// ─── pi CLI token → CSS variable mapping ────────────────────────────────────

/**
 * Maps resolved pi CLI theme colors + vars to pi-web CSS custom properties.
 */
function mapToCssVars(
  colors: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  // ── Extract base palette from vars ──
  const bg0 = vars.bg0 || "#1a1a1a";
  const bg1 = vars.bg1 || "#242424";
  const bg2 = vars.bg2 || "#2e2e2e";
  const bg3 = vars.bg3 || "#383838";
  const fg0 = vars.fg0 || "#e8e8e8";
  const fg3 = vars.fg3 || "#888888";
  const fg4 = vars.fg4 || "#555555";

  // Semantic palette colors
  const red = vars.red || "#dc2626";
  const green = vars.green || "#16a34a";
  const orange = vars.orange || "#d97706";

  // ── Resolve key pi CLI tokens ──
  const accent = colors.accent || orange;
  const text = colors.text || fg0;
  const muted = colors.muted || fg3;
  const dim = colors.dim || fg4;
  const border = colors.border || bg3;
  const borderAccent = colors.borderAccent || accent;
  const selectedBg = colors.selectedBg || bg2;
  const success = colors.success || green;
  const error = colors.error || red;
  const warning = colors.warning || orange;
  const gitAdded = colors.toolDiffAdded || success;
  const gitDeleted = colors.toolDiffRemoved || error;
  const gitModified = warning;
  const userMessageBg = colors.userMessageBg || bg1;
  const toolSuccessBg = colors.toolSuccessBg || bg1;

  // Determine if dark theme
  const isDark = relativeLuminance(bg0) < 0.5;

  // ── Build CSS variables ──
  const css: Record<string, string> = {};

  // Core backgrounds
  css["--bg"] = bg0;
  css["--bg-panel"] = bg1;
  css["--bg-secondary"] = bg1;
  css["--bg-card"] = bg1;
  css["--bg-hover"] = bg2;
  css["--bg-selected"] = selectedBg === bg1 ? bg2 : selectedBg;
  css["--bg-card-hover"] = mix(bg1, bg2, 0.5);
  css["--bg-subtle"] = isDark
    ? `rgba(255,255,255,0.035)`
    : `rgba(15,23,42,0.035)`;

  // Borders
  css["--border"] = border;
  css["--border-hover"] = borderAccent;

  // Text
  css["--text"] = text;
  css["--text-muted"] = muted;
  css["--text-dim"] = dim;

  // Accent
  css["--accent"] = accent;
  css["--accent-hover"] = isDark ? lighten(accent, 0.2) : darken(accent, 0.15);
  css["--accent-blue"] = vars.blue || accent;

  // Semantic colors
  css["--accent-red"] = error;
  css["--accent-green"] = success;
  css["--accent-orange"] = warning;

  // Git status uses the theme's diff/semantic palette, adjusted only enough
  // to keep its small text readable on the active panel background.
  const gitStatusBackgroundWeight = isDark ? 0.24 : 0.18;
  css["--git-status-added"] = ensureContrast(gitAdded, bg1);
  css["--git-status-modified"] = ensureContrast(gitModified, bg1);
  css["--git-status-deleted"] = ensureContrast(gitDeleted, bg1);
  css["--git-status-added-bg"] = mix(bg1, gitAdded, gitStatusBackgroundWeight);
  css["--git-status-modified-bg"] = mix(bg1, gitModified, gitStatusBackgroundWeight);
  css["--git-status-deleted-bg"] = mix(bg1, gitDeleted, gitStatusBackgroundWeight);

  // Message bubbles
  css["--user-bg"] = userMessageBg;
  css["--assistant-bg"] = bg0;
  css["--tool-bg"] = toolSuccessBg;

  // Hatch pattern
  css["--hatch-color"] = isDark
    ? `rgba(${hexToRgb(accent)?.join(",") || "100,193,182"},0.16)`
    : `rgba(${hexToRgb(accent)?.join(",") || "13,148,136"},0.12)`;

  // Semantic status tokens (pi CLI colors.error/success/warning, fallback to
  // accent-derived defaults so the default theme never renders with empty vars)
  css["--status-error"] = error;
  css["--status-warning"] = warning;
  css["--status-success"] = success;
  css["--status-info"] = accent;
  css["--status-error-bg"] = `color-mix(in srgb, ${error} 14%, var(--bg))`;
  css["--status-warning-bg"] = `color-mix(in srgb, ${warning} 14%, var(--bg))`;
  css["--status-success-bg"] = `color-mix(in srgb, ${success} 14%, var(--bg))`;
  css["--status-info-bg"] = `color-mix(in srgb, ${accent} 14%, var(--bg))`;
  css["--status-error-border"] = `color-mix(in srgb, ${error} 45%, var(--bg))`;
  css["--status-warning-border"] = `color-mix(in srgb, ${warning} 45%, var(--bg))`;
  css["--status-success-border"] = `color-mix(in srgb, ${success} 45%, var(--bg))`;
  css["--status-info-border"] = `color-mix(in srgb, ${accent} 45%, var(--bg))`;

  // Syntax tokens: pi CLI themes use camelCase syntaxKeyword/... tokens;
  // the OpenChamber adapter fills short keyword/string/... names. Read both
  // so every theme format colors code highlighting.
  css["--syntax-keyword"] = colors.syntaxKeyword || colors.keyword || accent;
  css["--syntax-string"] = colors.syntaxString || colors.string || orange;
  css["--syntax-number"] = colors.syntaxNumber || colors.number || accent;
  css["--syntax-function"] = colors.syntaxFunction || colors.function || accent;
  css["--syntax-comment"] = colors.syntaxComment || colors.comment || dim;

  return css;
}

// ─── Theme loading ──────────────────────────────────────────────────────────

/** All required pi CLI color tokens (51 tokens). */
const ALL_COLOR_TOKENS = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText",
  "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax",
  "bashMode",
];

/**
 * Parse a pi CLI theme JSON file.
 * Validates required fields and fills in missing color tokens with empty strings.
 */
function parseThemeFile(path: string): PiTheme | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw);

    // OpenChamber layered format: { metadata: { variant }, colors: { primary, surface, ... } }
    if (
      json.metadata
      && typeof json.metadata === "object"
      && (json.metadata.variant === "light" || json.metadata.variant === "dark")
      && json.colors
      && typeof json.colors === "object"
      && json.colors.primary
    ) {
      return parseOpenChamberThemeFile(json);
    }

    if (!json.name || typeof json.name !== "string") return null;
    if (!json.colors || typeof json.colors !== "object") return null;

    // Fill missing tokens with empty strings
    const colors: Record<string, string | number> = {};
    for (const token of ALL_COLOR_TOKENS) {
      colors[token] = json.colors[token] ?? "";
    }

    return {
      name: json.name,
      vars: json.vars,
      colors,
    };
  } catch {
    return null;
  }
}

/**
 * Adapt an OpenChamber layered theme ({ metadata, colors: { primary, surface,
 * interactive, status, chat, tools, syntax } }) into the pi CLI PiTheme shape
 * so mapToCssVars produces working pi-web CSS variables without conversion.
 */
function parseOpenChamberThemeFile(json: Record<string, unknown>): PiTheme | null {
  const colors = json.colors as Record<string, Record<string, string> | undefined>;
  const surface = colors.surface ?? {};
  const interactive = colors.interactive ?? {};
  const primary = colors.primary ?? {};
  const status = colors.status ?? {};
  const chat = colors.chat ?? {};
  const tools = colors.tools ?? {};

  const str = (v: unknown): string => (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : "");

  // Surface ramp for the pi CLI vars keys mapToCssVars reads.
  const bg0 = str(surface.background) || "#1a1a1a";
  const elevated = str(surface.elevated);
  const mutedSurface = str(surface.muted);
  const subtleSurface = str(surface.subtle);
  const fg0 = str(surface.foreground) || "#e8e8e8";
  const mutedFg = str(surface.mutedForeground);

  const accent = str(primary.base);
  const accentHover = str(primary.hover) || accent;
  const border = str(interactive.border) || "#404040";
  const borderAccent = accent || border;

  const transparentToOpaque = (value: string, fallbackBg: string): string => {
    // 8-digit hex with alpha → blend over the given background.
    if (/^#[0-9a-fA-F]{8}$/.test(value)) {
      const a = parseInt(value.slice(7, 9), 16) / 255;
      const base = value.slice(1, 7);
      const r = Math.round(parseInt(base.slice(0, 2), 16) * a + parseInt(fallbackBg.slice(1, 3), 16) * (1 - a));
      const g = Math.round(parseInt(base.slice(2, 4), 16) * a + parseInt(fallbackBg.slice(3, 5), 16) * (1 - a));
      const b = Math.round(parseInt(base.slice(4, 6), 16) * a + parseInt(fallbackBg.slice(5, 7), 16) * (1 - a));
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
    return value;
  };

  const userMessageBg = transparentToOpaque(
    str(chat.userMessageBackground) || (accent ? `${accent}26` : ""),
    bg0,
  );
  const toolBg = transparentToOpaque(str(tools.background) || mutedSurface || subtleSurface || bg0, bg0);

  const metadata = (json.metadata && typeof json.metadata === "object" ? json.metadata : {}) as Record<string, unknown>;
  return {
    name: typeof metadata.name === "string" ? metadata.name : "custom",
    vars: {
      bg0,
      bg1: elevated || mutedSurface || bg0,
      bg2: mutedSurface || subtleSurface || bg0,
      bg3: subtleSurface || mutedSurface || bg0,
      fg0,
      fg3: mutedFg || "#888888",
      fg4: mutedFg || "#777777",
    },
    colors: {
      accent,
      accentHover,
      text: fg0,
      muted: mutedFg || fg0,
      dim: mutedFg || "#888888",
      border,
      borderAccent,
      selectedBg: subtleSurface || mutedSurface || "",
      success: str(status.success) || "#16a34a",
      error: str(status.error) || "#dc2626",
      warning: str(status.warning) || "#d97706",
      userMessageBg: userMessageBg || bg0,
      toolSuccessBg: toolBg || bg0,
      // Syntax highlighting tokens from the layered theme's syntax.base
      keyword: str((colors.syntax as Record<string, Record<string, string>> | undefined)?.base?.keyword) || accent,
      string: str((colors.syntax as Record<string, Record<string, string>> | undefined)?.base?.string) || "",
      number: str((colors.syntax as Record<string, Record<string, string>> | undefined)?.base?.number) || "",
      function: str((colors.syntax as Record<string, Record<string, string>> | undefined)?.base?.function) || "",
      comment: str((colors.syntax as Record<string, Record<string, string>> | undefined)?.base?.comment) || "",
    },
  };
}

// ─── File-name convention helpers ───────────────────────────────────────────

/**
 * Detect the base name and variant from a theme filename.
 *
 * Convention:
 *   gruvbox-dark.json  → { base: "gruvbox", variant: "dark" }
 *   gruvbox-light.json → { base: "gruvbox", variant: "light" }
 *   monokai.json       → { base: "monokai", variant: null }
 */
function parseThemeFilename(
  filename: string,
): { base: string; variant: ThemeVariant | null } {
  const stem = basename(filename, extname(filename));

  // Try "-dark" / "-light" suffix (case-insensitive)
  const darkMatch = /^(.+)-dark$/i.exec(stem);
  if (darkMatch) return { base: darkMatch[1], variant: "dark" };

  const lightMatch = /^(.+)-light$/i.exec(stem);
  if (lightMatch) return { base: lightMatch[1], variant: "light" };

  // Single-file theme — variant determined from content later
  return { base: stem, variant: null };
}

/**
 * Scan a directory for pi CLI theme JSON files.
 * Returns an array of { path, base, variant, isDark } records.
 */
interface ScannedFile {
  path: string;
  base: string;
  variant: ThemeVariant | null;
  isDark: boolean;
}

function scanThemeDir(dir: string): ScannedFile[] {
  const results: ScannedFile[] = [];
  try {
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (extname(entry) !== ".json") continue;
      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }
      const parsed = parseThemeFilename(entry);
      // Determine actual polarity from file content
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;
      const vars = resolveVars(theme.vars);
      const bg0 = vars.bg0 || "#1a1a1a";
      const isDark = relativeLuminance(bg0) < 0.5;
      // If variant wasn't detected from filename, infer from content
      const variant = parsed.variant ?? (isDark ? "dark" : "light");

      results.push({ path: fullPath, base: parsed.base, variant, isDark });
    }
  } catch {
    // Permission errors, etc.
  }
  return results;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List all available theme sets (global + project). */
export function listThemeSets(projectCwd?: string): ThemeSetInfo[] {
  const result: ThemeSetInfo[] = Object.entries(ALL_BUILTIN_THEME_SETS).map(([name, theme]) => ({
    name,
    displayName: theme.displayName,
    hasDark: Boolean(theme.dark),
    hasLight: Boolean(theme.light),
    builtin: true,
    accent: theme.dark?.accent,
    accentLight: theme.light?.accent,
  }));
  const seen = new Set(Object.keys(ALL_BUILTIN_THEME_SETS));

  // Collect all scanned files
  const allFiles: ScannedFile[] = [];

  // Global themes: ~/.pi/agent/themes/
  const globalDir = join(homedir(), ".pi", "agent", "themes");
  allFiles.push(...scanThemeDir(globalDir));

  // Project themes: .pi/themes/ (relative to cwd)
  if (projectCwd) {
    const projectDir = join(projectCwd, ".pi", "themes");
    allFiles.push(...scanThemeDir(projectDir));
  }

  // Group by base name
  const groups = new Map<string, ScannedFile[]>();
  for (const f of allFiles) {
    const list = groups.get(f.base) || [];
    list.push(f);
    groups.set(f.base, list);
  }

  // Build ThemeSetInfo for each group
  for (const [base, files] of groups) {
    if (seen.has(base)) continue;
    seen.add(base);

    let hasDark = false;
    let hasLight = false;
    for (const f of files) {
      if (f.variant === "dark") hasDark = true;
      if (f.variant === "light") hasLight = true;
    }

    result.push({
      name: base,
      displayName: themeNameToDisplay(base),
      hasDark,
      hasLight,
      builtin: false,
      ...extractThemeSetAccent(files),
    });
  }

  return result;
}

/**
 * Extract swatch accents for a scanned theme group by reading the first file
 * of each variant. Handles both pi CLI and OpenChamber layered formats.
 */
function extractThemeSetAccent(files: ScannedFile[]): { accent?: string; accentLight?: string } {
  const readAccent = (file: ScannedFile | undefined, variant: ThemeVariant | null): string | undefined => {
    if (!file) return undefined;
    try {
      const json = JSON.parse(readFileSync(file.path, "utf8")) as {
        colors?: Record<string, unknown>;
        metadata?: { variant?: string };
      };
      if (!json.colors || typeof json.colors !== "object") return undefined;
      const colors = json.colors as Record<string, unknown>;
      const accent = typeof colors.accent === "string" ? colors.accent
        : (typeof colors.primary === "object" && colors.primary !== null)
          ? (colors.primary as Record<string, unknown>).base
          : undefined;
      if (typeof accent === "string" && /^#[0-9a-fA-F]{3,8}$/.test(accent)) {
        return accent.toLowerCase();
      }
      // Fall back to vars.primary for pi CLI themes that only define vars.
      const raw = JSON.parse(readFileSync(file.path, "utf8")) as { vars?: Record<string, string | number> };
      const v = raw.vars?.primary;
      if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) return v.toLowerCase();
      void variant;
    } catch {
      // Malformed file — no accent.
    }
    return undefined;
  };

  const darkFile = files.find((f) => f.variant === "dark");
  const lightFile = files.find((f) => f.variant === "light");
  return {
    accent: readAccent(darkFile, "dark"),
    accentLight: readAccent(lightFile, "light"),
  };
}

/** Convert a kebab-case theme name to a display-friendly title. */
function themeNameToDisplay(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve a specific variant of a theme set.
 *
 * Lookup order:
 *   1. `{base}-{variant}.json` (e.g. `gruvbox-dark.json`)
 *   2. `{base}.json` (single-file fallback)
 *   3. The opposite variant (if only one variant exists and user requests the other)
 *
 * @param name  Base theme-set name (e.g. "gruvbox").
 * @param variant  Which variant to load ("dark" or "light").
 * @param projectCwd  Optional project working directory for project themes.
 */
export function resolveTheme(
  name: string,
  variant: ThemeVariant,
  projectCwd?: string,
): ResolvedTheme | null {
  if (!name) return null;

  const builtin = resolveBuiltinTheme(name, variant);
  if (builtin) return builtin;

  const dirs: string[] = [
    join(homedir(), ".pi", "agent", "themes"),
  ];
  if (projectCwd) {
    dirs.push(join(projectCwd, ".pi", "themes"));
  }

  // Candidate filenames in priority order
  const candidates = [
    `${name}-${variant}.json`,  // e.g. gruvbox-dark.json
    `${name}.json`,             // e.g. monokai.json (single-file)
    `${name}-${variant === "dark" ? "light" : "dark"}.json`, // opposite variant fallback
  ];

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (!existsSync(fullPath)) continue;
      const theme = parseThemeFile(fullPath);
      if (!theme) continue;

      const vars = resolveVars(theme.vars);
      const colors = resolveColors(theme.colors, vars);
      const cssVars = mapToCssVars(colors, vars);
      const bg0 = vars.bg0 || "#1a1a1a";

      return {
        name, // Use the base name, not the file's internal name
        isDark: relativeLuminance(bg0) < 0.5,
        cssVars,
      };
    }
  }

  // Try as direct path (from settings or CLI)
  if (existsSync(name)) {
    const theme = parseThemeFile(name);
    if (theme) {
      const vars = resolveVars(theme.vars);
      const colors = resolveColors(theme.colors, vars);
      const cssVars = mapToCssVars(colors, vars);
      const bg0 = vars.bg0 || "#1a1a1a";
      return {
        name: basename(name, extname(name)),
        isDark: relativeLuminance(bg0) < 0.5,
        cssVars,
      };
    }
  }

  return null;
}
