import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Serialized read-modify-write access to ~/.pi/agent/settings.json.
 *
 * Several modules (modes, features, title model) read + write this single
 * shared file. Without a lock, two concurrent requests each snapshot the file
 * and the last writer silently drops the other's field update — e.g. saving a
 * mode default while toggling the task board could wipe `modes` or `features`
 * (and, worse, SDK-managed fields such as `defaultModel`), which surfaced as
 * settings not applying and sessions misbehaving after a refresh.
 *
 * `mutateSettingsJson` serializes the whole read-mutate-write cycle so every
 * mutation is based on the latest on-disk state.
 */

const LOCK_OPTIONS = {
  retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2_000, randomize: true },
  stale: 30_000,
};

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function readSettingsJson(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface SettingsMutation {
  /** The next settings object (may be the same object the mutator received,
   *  mutated in place). */
  settings: Record<string, unknown>;
  /** Set false to skip persisting even though the object was touched. */
  changed?: boolean;
}

/**
 * Run `mutator` against the latest settings.json under an exclusive lock and
 * persist the result atomically. The mutator receives the current parsed
 * settings object and returns it (optionally mutated). Persist unless the
 * mutator explicitly returned `{ changed: false }`.
 */
export async function mutateSettingsJson(
  mutator: (current: Record<string, unknown>) => SettingsMutation | Promise<SettingsMutation>,
): Promise<{ changed: boolean }> {
  const path = getSettingsPath();
  let compromisedError: Error | null = null;
  const release = await lockfile.lock(path, {
    ...LOCK_OPTIONS,
    onCompromised: (error: Error) => { compromisedError = error; },
  });
  try {
    if (compromisedError) throw compromisedError;
    const current = readSettingsJson();
    const mutation = await mutator(current);
    if (compromisedError) throw compromisedError;
    if (!mutation || typeof mutation !== "object" || !mutation.settings) {
      throw new Error("settings.json mutation must return { settings }");
    }
    if (mutation.changed === false) return { changed: false };
    writePrivateFileAtomicSync(path, JSON.stringify(mutation.settings, null, 2));
    if (compromisedError) throw compromisedError;
    return { changed: true };
  } finally {
    release().catch(() => {});
  }
}

/** Direct read (no lock) — same semantics as before, for one-shot reads. */
export function readSettingsJsonUnlocked(): Record<string, unknown> {
  return readSettingsJson();
}
