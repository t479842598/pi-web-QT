/**
 * User-defined code/text snippets backed by ~/.pi/agent/snippets.json.
 *
 * Snippets power the `#` autocomplete in the chat composer: typing `#name`
 * shows matching snippets and selecting one expands the token to its content.
 * Storage mirrors opencode-zen's pattern: atomic private write + proper-lockfile
 * so concurrent saves from multiple windows cannot corrupt the file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SnippetItem {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const SNIPPETS_FILE = process.env.PI_SNIPPETS_FILE
  ? (process.env.PI_SNIPPETS_FILE.startsWith("/") ? process.env.PI_SNIPPETS_FILE : join(process.cwd(), process.env.PI_SNIPPETS_FILE))
  : join(getAgentDir(), "snippets.json");

type SnippetsState = { loaded: boolean; snippets: SnippetItem[] };

declare global {
  var __piSnippetsState: SnippetsState | undefined;
}

function getState(): SnippetsState {
  if (!globalThis.__piSnippetsState) {
    globalThis.__piSnippetsState = { loaded: false, snippets: [] };
  }
  return globalThis.__piSnippetsState;
}

function randomId(): string {
  return `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadFromDisk(): SnippetItem[] {
  try {
    if (!existsSync(SNIPPETS_FILE)) return [];
    const raw = readFileSync(SNIPPETS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { snippets?: unknown };
    if (!Array.isArray(parsed.snippets)) return [];
    return parsed.snippets.filter(
      (s): s is SnippetItem => (
        typeof s === "object" && s !== null
        && typeof (s as SnippetItem).id === "string"
        && typeof (s as SnippetItem).name === "string"
        && typeof (s as SnippetItem).content === "string"
      ),
    );
  } catch {
    // Corrupt file — treat as empty (callers can re-save).
    return [];
  }
}

/** Read all snippets (cached in-process, refreshed on mutation). */
export function listSnippets(): SnippetItem[] {
  const state = getState();
  if (!state.loaded) {
    state.snippets = loadFromDisk();
    state.loaded = true;
  }
  return state.snippets;
}

/** Persist the snippet list atomically. */
export function saveSnippets(snippets: SnippetItem[]): void {
  writePrivateFileAtomicSync(SNIPPETS_FILE, JSON.stringify({ snippets }, null, 2) + "\n");
  const state = getState();
  state.snippets = snippets;
  state.loaded = true;
}

/** Create a snippet. Returns the new item. */
export function createSnippet(input: { name: string; content: string }): SnippetItem {
  const now = Date.now();
  const item: SnippetItem = {
    id: randomId(),
    name: input.name.trim(),
    content: input.content,
    createdAt: now,
    updatedAt: now,
  };
  saveSnippets([...listSnippets(), item]);
  return item;
}

/** Update an existing snippet. Returns null if the id is unknown. */
export function updateSnippet(id: string, patch: { name?: string; content?: string }): SnippetItem | null {
  let updated: SnippetItem | null = null;
  const next = listSnippets().map((snippet) => {
    if (snippet.id !== id) return snippet;
    updated = {
      ...snippet,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      updatedAt: Date.now(),
    };
    return updated;
  });
  if (!updated) return null;
  saveSnippets(next);
  return updated;
}

/** Delete a snippet. Returns true if it existed. */
export function deleteSnippet(id: string): boolean {
  const current = listSnippets();
  const next = current.filter((snippet) => snippet.id !== id);
  if (next.length === current.length) return false;
  saveSnippets(next);
  return true;
}
