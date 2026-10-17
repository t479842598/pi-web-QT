/**
 * Named endpoint presets for the "discover models first" flow.
 *
 * WHY a hand-written table: pi's `KnownProvider` registry ships the base URL and
 * api kind for each provider it brokers, but a models.json provider entry is a
 * *blank* shell — the user must spell a base URL and an api dialect. This table
 * is the smallest thing that turns "I want Kimi" into a filled form, and it is
 * deliberately plain data so it can be unit-tested without the SDK.
 */

export type PresetApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "mistral-conversations";

export type PresetDiscoveryStyle = "openai-models" | "anthropic-models" | "google-models";

export interface NamedEndpointPreset {
  id: string;
  vendorKey: string;
  name: string;
  baseUrl: string;
  api: PresetApi;
  aliases?: readonly string[];
  /** 该预设文档化的模型列表风格，缺省时由 api 推导 */
  discoveryStyle?: PresetDiscoveryStyle;
}

/**
 * Curated presets. baseUrl values mirror the endpoints pi brokers for the same
 * vendor (node_modules/@earendil-works/pi-ai/dist/providers/*), plus the domestic
 * endpoints that are common in this app's user base but not in pi's registry.
 * Account-shaped providers (OAuth / subscription only: opencode-go, pi-messages,
 * codex, xiaomi token plans, qwen token plans) are intentionally absent — they
 * cannot be expressed as a baseUrl + api key.
 */
export const NAMED_ENDPOINT_PRESETS: readonly NamedEndpointPreset[] = [
  {
    id: "openai",
    vendorKey: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    aliases: ["gpt", "chatgpt"],
  },
  {
    id: "anthropic",
    vendorKey: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    aliases: ["claude"],
  },
  {
    id: "google",
    vendorKey: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    aliases: ["gemini", "google-ai"],
    discoveryStyle: "google-models",
  },
  {
    id: "openrouter",
    vendorKey: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
  },
  {
    id: "groq",
    vendorKey: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
  },
  {
    id: "xai",
    vendorKey: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-responses",
    aliases: ["grok"],
  },
  {
    id: "mistral",
    vendorKey: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai",
    api: "mistral-conversations",
    aliases: ["codestral"],
  },
  {
    id: "together",
    vendorKey: "together",
    name: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    api: "openai-completions",
  },
  {
    id: "fireworks",
    vendorKey: "fireworks",
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference",
    api: "openai-completions",
  },
  {
    id: "deepseek",
    vendorKey: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    aliases: ["深度求索"],
  },
  {
    id: "alibaba-cn",
    vendorKey: "dashscope",
    name: "Alibaba Cloud Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
    aliases: ["dashscope", "qwen", "通义千问", "阿里云"],
  },
  {
    id: "moonshotai-cn",
    vendorKey: "moonshotai",
    name: "Moonshot Kimi (China)",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
    aliases: ["kimi", "月之暗面"],
  },
  {
    id: "moonshotai",
    vendorKey: "moonshotai",
    name: "Moonshot Kimi (Global)",
    baseUrl: "https://api.moonshot.ai/v1",
    api: "openai-completions",
    aliases: ["kimi-global"],
  },
  {
    id: "zai",
    vendorKey: "zai",
    name: "Z.AI",
    baseUrl: "https://api.z.ai/api/paas/v4",
    api: "openai-completions",
    aliases: ["z.ai", "zhipu-global", "智谱国际"],
  },
  {
    id: "zhipuai",
    vendorKey: "zhipuai",
    name: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    aliases: ["bigmodel", "glm", "智谱"],
  },
  {
    id: "siliconflow-cn",
    vendorKey: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    api: "openai-completions",
    aliases: ["siliconflow", "硅基流动"],
  },
  {
    id: "volcengine",
    vendorKey: "volcengine",
    name: "Volcengine Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    api: "openai-completions",
    aliases: ["ark", "doubao", "火山引擎", "豆包"],
  },
  {
    id: "minimax",
    vendorKey: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.io/anthropic",
    api: "anthropic-messages",
  },
  {
    id: "minimax-cn",
    vendorKey: "minimax",
    name: "MiniMax (China)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    api: "anthropic-messages",
    aliases: ["minimaxi"],
  },
  {
    id: "kimi-coding",
    vendorKey: "kimi-coding",
    name: "Kimi For Coding",
    baseUrl: "https://api.kimi.com/coding/v1",
    api: "anthropic-messages",
    aliases: ["kimi-code"],
  },
  {
    id: "xiaomi",
    vendorKey: "xiaomi",
    name: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    api: "openai-completions",
    aliases: ["mimo", "小米"],
  },
  {
    id: "nvidia",
    vendorKey: "nvidia",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
    aliases: ["nim"],
  },
  {
    id: "cerebras",
    vendorKey: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    api: "openai-completions",
  },
  {
    id: "baseten",
    vendorKey: "baseten",
    name: "Baseten",
    baseUrl: "https://inference.baseten.co/v1",
    api: "openai-completions",
  },
  {
    id: "huggingface",
    vendorKey: "huggingface",
    name: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    api: "openai-completions",
    aliases: ["hf"],
  },
  {
    id: "vercel-ai-gateway",
    vendorKey: "vercel",
    name: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh",
    api: "openai-completions",
    aliases: ["vercel"],
  },
  {
    id: "opencode",
    vendorKey: "opencode",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "openai-completions",
    aliases: ["zen"],
  },
  {
    id: "meta",
    vendorKey: "meta",
    name: "Meta AI",
    baseUrl: "https://api.meta.ai/v1",
    api: "openai-responses",
    aliases: ["llama"],
  },
];

/**
 * Normalizes a user-typed endpoint so two spellings of the same endpoint compare equal.
 * WHY: trailing slashes and host casing are the two differences users actually produce.
 */
export function normalizeEndpointUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`;
  } catch {
    // Unparseable input still has to answer something stable; strip the cosmetic
    // tail, then re-trim because removing slashes can expose a trailing space.
    return trimmed.replace(/\/+$/, "").trim().toLowerCase();
  }
}

/**
 * Returns the lower-case host of an endpoint, tolerating a missing protocol.
 * WHY: host equality is the fallback match key when the path was rewritten.
 */
export function endpointHost(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? [trimmed] : [`https://${trimmed}`];
  for (const candidate of candidates) {
    try {
      const host = new URL(candidate).hostname.toLocaleLowerCase().replace(/\.$/, "");
      if (host) return host;
    } catch {
      continue;
    }
  }
  return undefined;
}

const COMPLETIONS_FAMILY: Record<string, readonly PresetApi[]> = {
  "openai-completions": ["openai-completions", "openai-responses"],
  "openai-responses": ["openai-completions", "openai-responses"],
};

/**
 * True when two api dialects speak to the same endpoint family.
 * WHY: completions and responses share a host, so host-only matches must not
 * claim an exact dialect; the caller decides whether to keep the current value.
 */
function apisCompatible(left: PresetApi, right: string | undefined): boolean {
  if (!right) return true;
  if (left === right) return true;
  return (COMPLETIONS_FAMILY[left] ?? []).includes(right as PresetApi);
}

/**
 * Finds the preset a form row is describing, or undefined when nothing matches.
 * WHY: a row that already carries a base URL must resolve back to its vendor so
 * the UI can offer that vendor's discovery style instead of guessing from api.
 */
export function matchNamedPreset(input: {
  baseUrl?: string;
  api?: string;
  id?: string;
}): NamedEndpointPreset | undefined {
  const wantedId = input.id?.trim().toLocaleLowerCase();
  if (wantedId) {
    const byId = NAMED_ENDPOINT_PRESETS.find((preset) => preset.id.toLocaleLowerCase() === wantedId);
    if (byId) return byId;
  }

  const wantedUrl = normalizeEndpointUrl(input.baseUrl);
  if (wantedUrl) {
    const byUrl = NAMED_ENDPOINT_PRESETS.find(
      (preset) => normalizeEndpointUrl(preset.baseUrl) === wantedUrl,
    );
    if (byUrl) return byUrl;

    const wantedHost = endpointHost(input.baseUrl);
    if (wantedHost) {
      const sameHost = NAMED_ENDPOINT_PRESETS.filter(
        (preset) => endpointHost(preset.baseUrl) === wantedHost,
      );
      const exactApi = sameHost.find((preset) => preset.api === input.api);
      if (exactApi) return exactApi;
      const compatible = sameHost.find((preset) => apisCompatible(preset.api, input.api));
      if (compatible) return compatible;
    }
  }

  return undefined;
}

/**
 * Builds the lower-case search blob for one preset.
 * WHY: substring filtering must hit "kimi", "moonshot" and a bare host alike,
 * so every human- and machine-readable identifier goes into one string.
 */
export function presetHaystack(preset: NamedEndpointPreset): string {
  const host = endpointHost(preset.baseUrl) ?? "";
  let hostAndPath = `${host} ${preset.baseUrl}`;
  try {
    const url = new URL(preset.baseUrl);
    hostAndPath = `${host} ${url.pathname.replace(/\/+$/, "")} ${preset.baseUrl}`;
  } catch {
    // Keep the raw pair built above.
  }
  return [
    preset.name,
    preset.id,
    preset.vendorKey,
    ...(preset.aliases ?? []),
    hostAndPath,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Case-insensitive substring filter over precomputed haystacks.
 * WHY: an empty query must still hand back a copy, so callers never alias the
 * source array and mutate presets by accident.
 */
export function filterServiceOptions<T extends { haystack: string }>(
  options: readonly T[],
  query: string,
): T[] {
  const needle = (query ?? "").trim().toLocaleLowerCase();
  if (!needle) return [...options];
  return options.filter((option) => option.haystack.toLocaleLowerCase().includes(needle));
}

/**
 * Resolves how many models a preset's endpoint can list.
 * WHY: anthropic and google answer with their own shapes, and an explicit value
 * must win so one-off endpoints can override the api-derived default.
 */
export function presetDiscoveryStyle(preset: NamedEndpointPreset): PresetDiscoveryStyle {
  if (preset.discoveryStyle) return preset.discoveryStyle;
  if (preset.api === "anthropic-messages") return "anthropic-models";
  if (preset.api === "google-generative-ai") return "google-models";
  return "openai-models";
}
