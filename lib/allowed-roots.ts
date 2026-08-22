import { toSlashPath } from "./paths";

// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAdditionalAllowedRoots: Set<string> | undefined;
}

/**
 * Allowed roots are internal bookkeeping keys that are never displayed, so they
 * are stored slash-normalized for consistent Set membership. Correctness does
 * not depend on it — isPathWithinRoots() re-normalizes whatever it is given.
 */
export function normalizeSlashes(filePath: string): string {
  return toSlashPath(filePath);
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__piAdditionalAllowedRoots) {
    globalThis.__piAdditionalAllowedRoots = new Set();
  }
  return globalThis.__piAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().add(normalizedRoot);
  globalThis.__piAllowedRootsCache?.roots.add(normalizedRoot);
}

/**
 * Revoke a previously allowed root (e.g. after its worktree is removed).
 * Only the in-memory additional-roots set is pruned; the merged cache is
 * dropped so it rebuilds from session-derived roots — a path that is also a
 * session cwd therefore stays allowed.
 */
export function disallowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().delete(normalizedRoot);
  globalThis.__piAllowedRootsCache = undefined;
}
