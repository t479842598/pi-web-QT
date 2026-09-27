/**
 * Query parsing and match highlighting for the command palette.
 *
 * Pure functions only — the palette component renders whatever segments these
 * return, so the matching rules stay testable without a renderer.
 */

import { SCOPE_PREFIXES, type CommandPaletteScope } from "./command-palette-history";

export interface MatchSegment {
  text: string;
  hit: boolean;
}

/**
 * Split a raw query into the scope it selects and the text to search for.
 *
 * A leading `>` / `#` / `@` picks the scope; anything else keeps the scope the
 * user last chose via the tabs. The prefix is stripped from the returned query
 * so matching runs against what the user meant to find.
 */
export function resolveQueryScope(
  raw: string,
  fallback: CommandPaletteScope,
): { scope: CommandPaletteScope; query: string } {
  const trimmed = raw.trimStart();
  const head = trimmed.slice(0, 1);
  const prefixed = Object.prototype.hasOwnProperty.call(SCOPE_PREFIXES, head)
    ? SCOPE_PREFIXES[head]
    : null;
  if (!prefixed) return { scope: fallback, query: raw.trim() };
  // Keep a leading space users habitually type after the prefix out of the term.
  return { scope: prefixed, query: trimmed.slice(1).trim() };
}

/** Inverse of `resolveQueryScope`, used to restore a history entry's prefix. */
export function scopePrefix(scope: CommandPaletteScope): string {
  for (const [prefix, value] of Object.entries(SCOPE_PREFIXES)) {
    if (value === scope) return prefix;
  }
  return "";
}

/** Strip any leading scope prefix from a query (tab clicks reset the prefix). */
export function stripScopePrefix(raw: string): string {
  const trimmed = raw.trimStart();
  const head = trimmed.slice(0, 1);
  return Object.prototype.hasOwnProperty.call(SCOPE_PREFIXES, head)
    ? trimmed.slice(1).trimStart()
    : raw;
}

/**
 * Case-insensitive substring match, split into hit/miss segments for rendering.
 *
 * Space-separated terms all have to appear (AND), matching how the file filter
 * behaves elsewhere in the app; each occurrence of any term is highlighted.
 */
export function highlightMatches(text: string, query: string): MatchSegment[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!text) return [{ text, hit: false }];
  if (terms.length === 0) return [{ text, hit: false }];

  const haystack = text.toLowerCase();
  // Collect every occurrence of every term, then merge into non-overlapping
  // ranges so adjacent terms do not produce nested/duplicated segments.
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(term, from);
      if (at === -1) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const segments: MatchSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

/** True when every whitespace-separated term appears somewhere in `text`. */
export function matchesAllTerms(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Platform-correct label for the palette shortcut (⌘K on macOS, Ctrl+K elsewhere). */
export function commandPaletteShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘K" : "Ctrl+K";
}
