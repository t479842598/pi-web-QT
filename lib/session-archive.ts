import { join } from "node:path";
import { readJsonStoreUnlocked, mutateJsonStore } from "./locked-json-store";

/**
 * Session archive (归档) — a reversible soft-mark that hides a session from
 * the sidebar lists without touching its .jsonl file.
 *
 * Stored in a dedicated JSON file inside the agent dir (like
 * project-aliases.json) so the pi SDK's settings.json rewrites can never
 * clobber it. Keys are session ids; values record when the session was
 * archived (shown in the archive view). Hard delete (DELETE /api/sessions)
 * removes the entry along with the file.
 */

export interface ArchivedSession {
  archivedAt: string;
}

export type SessionArchive = Record<string, ArchivedSession>;

export function getSessionArchivePath(agentDir: string): string {
  return join(agentDir, "session-archive.json");
}

function parseArchive(raw: unknown): SessionArchive {
  const out: SessionArchive = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const archivedAt = (value as { archivedAt?: unknown }).archivedAt;
    out[id] = { archivedAt: typeof archivedAt === "string" ? archivedAt : "" };
  }
  return out;
}

export function readSessionArchive(agentDir: string): SessionArchive {
  return readJsonStoreUnlocked(getSessionArchivePath(agentDir), parseArchive);
}

/** Archive (record archivedAt) or unarchive (remove) a session. Returns the
 *  resulting archive map; a no-op mutation skips the disk write. */
export async function setSessionArchived(
  agentDir: string,
  sessionId: string,
  archived: boolean,
): Promise<SessionArchive> {
  const { value } = await mutateJsonStore(getSessionArchivePath(agentDir), parseArchive, (current) => {
    if (archived) {
      if (current[sessionId]) return { value: current, changed: false };
      return { value: { ...current, [sessionId]: { archivedAt: new Date().toISOString() } } };
    }
    if (!(sessionId in current)) return { value: current, changed: false };
    const next = { ...current };
    delete next[sessionId];
    return { value: next };
  });
  return value;
}

/** Drop the archive entry of a permanently deleted session (best-effort
 *  cleanup so the file does not accumulate ids of dead sessions). */
export async function dropSessionArchiveEntry(agentDir: string, sessionId: string): Promise<void> {
  await setSessionArchived(agentDir, sessionId, false);
}
