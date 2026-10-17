/**
 * One place for browser-stored preferences.
 *
 * The app keeps a dozen render preferences in localStorage (theme, locale,
 * chat appearance, sidebar view, unread markers, provider usage cache …) and
 * five of them are read during render or in a state initializer. That is a
 * hydration hazard: the server has no storage, so the first client render can
 * disagree with the markup that was sent.
 *
 * The kit switch solved it by having the inline bootstrap script write
 * `html.dataset.*` before hydration and having React read the dataset with a
 * fixed server snapshot (`useSyncExternalStore`). This module gives every other
 * preference the same two primitives — and, more importantly, one place that
 * swallows the quota/private-mode failures instead of eleven try blocks.
 *
 * Storage failures never throw: a preference that cannot be read is simply
 * absent, and a preference that cannot be written keeps its in-memory value for
 * the rest of the session.
 */

export type StorageArea = "local" | "session";

function area(kind: StorageArea): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/** Read a raw string, or null when absent/unavailable. */
export function readPreference(key: string, kind: StorageArea = "local"): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a raw string. An empty string removes the key (see `clearPreference`). */
export function writePreference(key: string, value: string, kind: StorageArea = "local"): boolean {
  try {
    const store = area(kind);
    if (!store) return false;
    if (value === "") store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function clearPreference(key: string, kind: StorageArea = "local"): void {
  writePreference(key, "", kind);
}

/** Read + narrow through a parser, falling back when the value is absent or bad. */
export function readParsedPreference<T>(
  key: string,
  parse: (raw: string) => T | null,
  fallback: T,
  kind: StorageArea = "local",
): T {
  const raw = readPreference(key, kind);
  if (raw === null) return fallback;
  try {
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export function readNumberPreference(
  key: string,
  fallback: number,
  clamp: (value: number) => number,
  kind: StorageArea = "local",
): number {
  return readParsedPreference(
    key,
    (raw) => {
      const value = Number(raw);
      return Number.isFinite(value) ? clamp(value) : null;
    },
    fallback,
    kind,
  );
}

export function readBooleanPreference(key: string, fallback: boolean, kind: StorageArea = "local"): boolean {
  return readParsedPreference(key, (raw) => raw === "1" || raw === "true", fallback, kind);
}

export function writeBooleanPreference(key: string, value: boolean, kind: StorageArea = "local"): boolean {
  return writePreference(key, value ? "1" : "0", kind);
}

/** Read a set of `html.dataset` keys — the bootstrap-script channel. */
export function readDataset(keys: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (typeof document === "undefined") return out;
  for (const key of keys) out[key] = document.documentElement.dataset[key];
  return out;
}

/**
 * Subscribe to cross-tab changes for one key prefix.
 *
 * Returns an unsubscribe function; safe to call on the server (no-op).
 */
export function subscribeToStorage(prefix: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: StorageEvent) => {
    if (!event.key || !event.key.startsWith(prefix)) return;
    listener();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
