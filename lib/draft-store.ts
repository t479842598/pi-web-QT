export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
}

const drafts = new Map<string, ChatDraft>();

// Bound the in-memory draft map: screenshots are stored as base64, so an
// ever-growing map (deleted sessions, abandoned `new:<cwd>` keys) can pin
// tens of MB for the page's lifetime. Oldest entries are evicted first
// (Map iteration order is insertion order; setDraft refreshes recency).
const DRAFT_CACHE_MAX = 100;

function evictOverflow(): void {
  while (drafts.size > DRAFT_CACHE_MAX) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.delete(key); // refresh recency before re-insert
  drafts.set(key, cloneDraft(draft));
  evictOverflow();
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}
