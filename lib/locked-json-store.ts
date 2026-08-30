import { existsSync, readFileSync } from "node:fs";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Shared plumbing for the agent-dir sidecar JSON stores (session-archive.json,
 * project-visibility.json).
 *
 * These files are mutated by concurrent requests (two clients archiving
 * different sessions at once), so every mutation runs under an exclusive lock
 * against the latest on-disk state and persists atomically — the same pattern
 * as settings-lock.ts. Unlike settings.json these files may not exist yet, so
 * the lock uses `realpath: false`; the parent directory (the agent dir) is
 * assumed to exist.
 */

const LOCK_OPTIONS = {
  realpath: false,
  retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2_000, randomize: true },
  stale: 30_000,
};

export interface JsonMutationResult<T> {
  value: T;
  /** Set false to skip persisting even though the value was computed. */
  changed?: boolean;
}

/** Snapshot read without a lock. `parse` must sanitize any input — including
 *  `undefined` (missing file) — into a clean value, so a corrupt file degrades
 *  to the empty shape instead of breaking the list. */
export function readJsonStoreUnlocked<T>(path: string, parse: (raw: unknown) => T): T {
  if (!existsSync(path)) return parse(undefined);
  try {
    return parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return parse(undefined);
  }
}

/** Read-modify-write the store under an exclusive lock; persist atomically
 *  unless the mutator returned `{ changed: false }`. */
export async function mutateJsonStore<T>(
  path: string,
  parse: (raw: unknown) => T,
  mutator: (current: T) => JsonMutationResult<T> | Promise<JsonMutationResult<T>>,
): Promise<{ value: T; changed: boolean }> {
  let compromisedError: Error | null = null;
  const release = await lockfile.lock(path, {
    ...LOCK_OPTIONS,
    onCompromised: (error: Error) => { compromisedError = error; },
  });
  try {
    if (compromisedError) throw compromisedError;
    const current = readJsonStoreUnlocked(path, parse);
    const mutation = await mutator(current);
    if (compromisedError) throw compromisedError;
    if (!mutation || typeof mutation !== "object" || !("value" in mutation)) {
      throw new Error(`${path} mutation must return { value }`);
    }
    if (mutation.changed === false) return { value: mutation.value, changed: false };
    writePrivateFileAtomicSync(path, JSON.stringify(mutation.value, null, 2));
    if (compromisedError) throw compromisedError;
    return { value: mutation.value, changed: true };
  } finally {
    release().catch(() => {});
  }
}
