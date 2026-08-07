/**
 * Rough token-count estimation for a text string. CJK characters count as one
 * token each; everything else averages 4 chars per token. Used for usage
 * statistics where exact counts are unavailable (pi does not persist per-model
 * usage), so the numbers are indicative, not billable.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x20000 && code <= 0x2A6DF) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.max(0, Math.round(tokens));
}
