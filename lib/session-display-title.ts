import { stripModeInstructionBlocks } from "./modes";

/**
 * Session display titles, normalized in ONE place.
 *
 * Pi writes the literal placeholder `(no messages)` into a session file's
 * `firstMessage` when no user message exists (and `stripModeInstructionBlocks`
 * can reduce a mode-instruction-only first message to the same placeholder).
 * Every UI surface that falls back to `firstMessage` must treat that string as
 * "no title", or the top bar / sidebar render it verbatim — truncated on a
 * phone it reads as `(no …`. The Flutter client already filters it
 * (mobile2/lib/src/models.dart); this module is the web-side equivalent.
 */

export const NO_MESSAGES_PLACEHOLDER = "(no messages)";

/**
 * True when the text carries no usable title: empty, whitespace/zero-width
 * only, or the Pi `(no messages)` placeholder (case-insensitive, full-width
 * parens and trailing ellipsis tolerated).
 */
export function isPlaceholderTitle(text: string | null | undefined): boolean {
  if (!text) return true;
  const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return /^[(（]?\s*no\s+messages\s*[)）.\u2026]*$/i.test(cleaned);
}

export interface SessionDisplayTitleSource {
  name?: string | null;
  firstMessage?: string | null;
  id?: string | null;
}

/**
 * Resolve a human-readable session title: `name` → first user message (mode
 * blocks and the `(no messages)` placeholder stripped) → short id → fallback.
 * Never returns an empty string when a session id exists, so rename-prefill
 * and search-filter call sites keep working.
 */
export function sessionDisplayTitle(
  session: SessionDisplayTitleSource,
  fallback = "",
): string {
  const name = stripModeInstructionBlocks(session.name ?? "").trim();
  if (name && !isPlaceholderTitle(name)) return name;

  const firstMessage = stripModeInstructionBlocks(session.firstMessage ?? "").trim();
  if (firstMessage && !isPlaceholderTitle(firstMessage)) return firstMessage.slice(0, 50);

  const id = (session.id ?? "").trim();
  if (id) return id.slice(0, 12);
  return fallback;
}
