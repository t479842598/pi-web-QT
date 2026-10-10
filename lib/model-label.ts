/**
 * Trim a model name for a narrow toolbar trigger (a phone's composer row shows
 * the model beside its provider icon). The full name still reaches the user
 * through the button's title/aria-label, so only the visible text is shortened.
 *
 * Counted in code units on purpose: the target is a fixed-width button, and a
 * surrogate pair (an emoji) occupying one glyph position must not push the
 * visible string past it.
 */
export const MODEL_LABEL_MAX_CHARS = 10;

export function truncateModelLabel(name: string, maxChars = MODEL_LABEL_MAX_CHARS): string {
  const trimmed = name.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}
