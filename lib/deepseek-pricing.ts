/**
 * DeepSeek 官网 CNY 计价层（纯函数，零请求）。
 *
 * 与 Reasonix internal/config/pricing.go 的官方 CNY 表保持一致：
 *   flash: cache_hit ¥0.02 / 输入 ¥1 / 输出 ¥2（每 1M token）
 *   pro:   cache_hit ¥0.025 / 输入 ¥3 / 输出 ¥6（每 1M token）
 *
 * 匹配规则：modelId 包含 sub-string deepseek-v4-flash / deepseek-v4-pro 即命中
 * 对应价表（与 provider 无关——zenmux 等网关代理上的同名模型也按官网价计算）。
 * 未命中模型的费用保持 SDK 的 USD cost 展示，不做汇率换算。
 */

export interface DeepSeekCNYPrice {
  /** 每 1M 缓存命中输入 token */
  cacheRead: number;
  /** 每 1M 未缓存输入 token */
  input: number;
  /** 每 1M 输出 token */
  output: number;
  /** 缓存写入免费（DeepSeek 官方无 cacheWrite 费用） */
  cacheWrite: number;
}

export const DEEPSEEK_CNY_PRICING: Readonly<Record<"flash" | "pro", DeepSeekCNYPrice>> = {
  flash: { cacheRead: 0.02, input: 1, output: 2, cacheWrite: 0 },
  pro: { cacheRead: 0.025, input: 3, output: 6, cacheWrite: 0 },
};

export type DeepSeekPriceKey = keyof typeof DEEPSEEK_CNY_PRICING | null;

export interface TokenUsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Resolve a model id to its DeepSeek official CNY price tier, independent of
 * provider. Sub-string match so gateway-side ids (zenmux/deepseek-v4-pro,
 * deepseek-v4-pro-20260809) resolve too. Returns null when the id does not
 * carry the deepseek-v4-flash / deepseek-v4-pro marker.
 */
export function resolveDeepSeekPrice(modelId: string | undefined | null): DeepSeekPriceKey {
  const id = (modelId ?? "").toLowerCase();
  if (id.includes("deepseek-v4-flash")) return "flash";
  if (id.includes("deepseek-v4-pro")) return "pro";
  return null;
}

/** True when the model id is priced by the DeepSeek official CNY table. */
export function matchesDeepSeekCNY(modelId: string | undefined | null): boolean {
  return resolveDeepSeekPrice(modelId) !== null;
}

const denom = 1_000_000;

/**
 * Estimated spend for one usage record in CNY, using the DeepSeek official
 * CNY table. cacheWrite is free (price 0), mirroring Reasonix Pricing.Cost.
 */
export function cnyCost(
  modelId: string | undefined | null,
  usage: TokenUsageLike | undefined | null,
): number {
  const tier = resolveDeepSeekPrice(modelId);
  if (!tier) return 0;
  if (!usage) return 0;
  const p = DEEPSEEK_CNY_PRICING[tier];
  const input = finiteOr(usage.input);
  const output = finiteOr(usage.output);
  const cacheRead = finiteOr(usage.cacheRead);
  const cacheWrite = finiteOr(usage.cacheWrite);
  return (cacheRead * p.cacheRead + input * p.input + output * p.output + cacheWrite * p.cacheWrite) / denom;
}

/**
 * CNY sum over multiple usage records for one model id.
 */
export function cnyCostSum(
  modelId: string | undefined | null,
  usages: readonly TokenUsageLike[],
): number {
  let total = 0;
  for (const u of usages) total += cnyCost(modelId, u);
  return total;
}

/** "¥38.93" / "¥0.0123" / "<¥0.01"（不足一分钱）/ "¥0.00"（零）。 */
export function formatCNY(n: number): string {
  const value = finiteOrNumber(n);
  if (!Number.isFinite(value) || value <= 0) return "¥0.00";
  if (value < 0.01) return "<¥0.01";
  if (value < 1) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function finiteOr(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function finiteOrNumber(n: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}