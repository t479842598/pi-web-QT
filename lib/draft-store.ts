import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

/** A folded long paste: the placeholder label embedded in `value` plus the raw
 *  text it must expand back into before sending. */
export interface ChatDraftPastedBlock {
  id: string;
  label: string;
  text: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  pastedBlocks?: ChatDraftPastedBlock[];
}

function clonePastedBlocks(blocks: ChatDraftPastedBlock[] | undefined): ChatDraftPastedBlock[] | undefined {
  return blocks ? blocks.map((block) => ({ ...block })) : undefined;
}

/** Union of two pasted-block lists, deduped by label+text so rekey merges
 *  never drop a block whose text survived in only one draft. */
function mergePastedBlocks(
  a: ChatDraftPastedBlock[] | undefined,
  b: ChatDraftPastedBlock[] | undefined,
): ChatDraftPastedBlock[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const merged: ChatDraftPastedBlock[] = [];
  const seen = new Set<string>();
  for (const block of [...(a ?? []), ...(b ?? [])]) {
    const key = `${block.label}\u0000${block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...block });
  }
  return merged;
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
    pastedBlocks: clonePastedBlocks(draft.pastedBlocks),
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

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
  submittedBlocks?: ChatDraftPastedBlock[],
  currentBlocks?: ChatDraftPastedBlock[],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
    pastedBlocks: mergePastedBlocks(currentBlocks, submittedBlocks),
  };
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
    undefined,
    current.pastedBlocks,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images, next.pastedBlocks, previous.pastedBlocks)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
