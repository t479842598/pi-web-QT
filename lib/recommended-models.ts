/**
 * Picking the handful of models worth pre-selecting after discovery.
 *
 * WHY the recommendation is so conservative: models.json is written verbatim to
 * disk, so a wrong pick costs the user a real request. Ranking therefore only
 * happens when models.dev gave us a trustworthy price, and otherwise the module
 * says so in `reason` instead of inventing an order.
 */

import type { ModelCatalogPreset } from "./model-catalog";

/** A discovered model, optionally carrying models.dev pricing when the catalog knew it. */
export interface RecommendableModel {
  id: string;
  name?: string;
  cost?: { output?: number };
}

export interface RecommendationInput {
  models: readonly RecommendableModel[];
  catalogPreset?: ModelCatalogPreset | null;
  catalogPrice?: { status: "reliable" | "unreliable"; cost?: { output?: number } } | null;
}

export interface Recommendation {
  ids: string[];
  /** 为什么只选这些 / 为什么没选，UI 直接展示 */
  reason: "catalog-ranked" | "first-only" | "empty";
}

export const NON_CHAT_MODEL_PATTERN =
  /embed|rerank|moderation|whisper|tts|transcri|audio|realtime|\blive\b|speech|image|dall-e|imagen|ocr|guard|deep-research|computer-use/i;

export const RECOMMENDED_MODEL_LIMIT = 3 as const;
export const PREMIUM_OUTPUT_COST_PER_MILLION = 100 as const;

/**
 * True when a model id looks like something a chat completion could target.
 * WHY: embedding, TTS, OCR and image endpoints appear in the same /models list
 * as chat models, and selecting one produces a provider that 400s on first use.
 */
export function isChatCapableModelId(id: string): boolean {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !NON_CHAT_MODEL_PATTERN.test(trimmed);
}

/**
 * True when a finished discovery is trustworthy enough to recommend from.
 * WHY the simplification: this module deliberately does NOT parse error text.
 * A 404 from /models is survivable (the endpoint may simply not implement the
 * listing route, which is exactly when a manual model list is wanted), but it
 * arrives as a free-form message. Rather than claim a stronger judgement than we
 * can make, the rule is blunt: any error disqualifies, `ready` alone qualifies.
 */
export function canRecommendFrom(discovery: { status: string; source?: string; error?: string }): boolean {
  if (!discovery || discovery.status !== "ready") return false;
  if (discovery.source === "error") return false;
  if (typeof discovery.error === "string" && discovery.error.trim()) return false;
  return true;
}

function modelFamily(id: string): string {
  const lastSegment = id.trim().split("/").pop() ?? id.trim();
  const dash = lastSegment.indexOf("-");
  return (dash > 0 ? lastSegment.slice(0, dash) : lastSegment).toLocaleLowerCase();
}

/**
 * Collapses a model list into one entry per model family.
 * WHY: a vendor list is usually several sizes of the same family
 * (`gpt-5.1`, `gpt-5.1-mini`, `gpt-5.1-nano`); picking three of them would waste
 * all three slots on one choice.
 */
export function dedupeByFamily(ids: readonly string[], limit = RECOMMENDED_MODEL_LIMIT): string[] {
  const capped = Math.max(0, Math.floor(limit));
  const out: string[] = [];
  if (capped === 0) return out;
  const seen = new Set<string>();
  for (const id of ids) {
    const family = modelFamily(id);
    if (seen.has(family)) continue;
    seen.add(family);
    out.push(id);
    if (out.length >= capped) break;
  }
  return out;
}

/**
 * Output cost of one candidate, preferring its own price over the preset's.
 * WHY: a preset price describes the matched flagship. When discovery also
 * carries per-model pricing the premium check must run per candidate, otherwise
 * every model inherits one number and the ranking can never reorder anything.
 */
function outputCostOf(model: RecommendableModel, fallback: number | undefined): number | undefined {
  const own = model.cost?.output;
  if (typeof own === "number" && Number.isFinite(own)) return own;
  return fallback;
}

function presetOutputCost(input: RecommendationInput): number | undefined {
  if (input.catalogPrice?.status !== "reliable") return undefined;
  const value = input.catalogPrice.cost?.output;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Recommends the model ids a fresh provider entry should start with.
 * WHY the three tiers: each tier is a strictly weaker claim, and `reason` lets
 * the UI say which one it got instead of presenting a guess as a ranking.
 */
export function recommendModelIds(input: RecommendationInput): Recommendation {
  const chat = (input.models ?? []).filter((model) => isChatCapableModelId(model.id));
  if (chat.length === 0) return { ids: [], reason: "empty" };

  const fallbackCost = presetOutputCost(input);
  const canRank = Boolean(input.catalogPreset) && fallbackCost !== undefined;
  if (!canRank) return { ids: [chat[0].id], reason: "first-only" };

  const standard: RecommendableModel[] = [];
  const premium: RecommendableModel[] = [];
  for (const model of chat) {
    const cost = outputCostOf(model, fallbackCost);
    // An unknown price cannot be called premium, so it keeps its original slot.
    const isPremium = cost !== undefined && cost > PREMIUM_OUTPUT_COST_PER_MILLION;
    (isPremium ? premium : standard).push(model);
  }

  return {
    ids: dedupeByFamily([...standard, ...premium].map((model) => model.id)),
    reason: "catalog-ranked",
  };
}
