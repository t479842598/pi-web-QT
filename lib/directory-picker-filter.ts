/**
 * Filtering helpers for the directory picker (adapted from upstream PR #461).
 *
 * The upstream feature derives a filter from a path-suffix input; this local
 * build instead exposes a dedicated filter box above the directory list, so
 * only the entry-filtering half is needed here.
 */

/**
 * Filter directory entries by a case-insensitive substring match on `name`.
 * A null or empty filter returns the entries unchanged (new array).
 */
export function filterDirectoryEntries<T extends { name: string }>(
  entries: readonly T[],
  filter: string | null,
): T[] {
  if (filter === null || filter === "") return [...entries];
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
