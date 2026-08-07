import type { ComponentType, CSSProperties } from "react";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import {
  AnthropicMonoIcon,
  OpenAIMonoIcon,
  GoogleColorIcon,
  DeepSeekColorIcon,
  GroqMonoIcon,
  MistralColorIcon,
  MoonshotMonoIcon,
  MinimaxColorIcon,
  FireworksColorIcon,
  HuggingFaceColorIcon,
  CerebrasColorIcon,
  OpenRouterMonoIcon,
  XAIMonoIcon,
  CloudflareColorIcon,
  VercelMonoIcon,
  GithubCopilotMonoIcon,
  AwsColorIcon,
  AzureColorIcon,
  KimiColorIcon,
  QwenColorIcon,
  ZhipuColorIcon,
  CohereColorIcon,
  PerplexityColorIcon,
  TogetherColorIcon,
  GrokMonoIcon,
  AntGroupColorIcon,
  NvidiaColorIcon,
  OpenCodeMonoIcon,
  XiaomiMiMoMonoIcon,
  ZAIMonoIcon,
} from "./provider-icons";

type IconComponent = ComponentType<{ size?: number | string; style?: CSSProperties }>;

const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  anthropic: { Icon: AnthropicMonoIcon, hasColor: false }, openai: { Icon: OpenAIMonoIcon, hasColor: false }, "openai-codex": { Icon: OpenAIMonoIcon, hasColor: false }, reqtoken: { Icon: OpenAIMonoIcon, hasColor: false },
  google: { Icon: GoogleColorIcon, hasColor: true }, "google-vertex": { Icon: GoogleColorIcon, hasColor: true }, "ant-ling": { Icon: AntGroupColorIcon, hasColor: true },
  deepseek: { Icon: DeepSeekColorIcon, hasColor: true }, groq: { Icon: GroqMonoIcon, hasColor: false }, mistral: { Icon: MistralColorIcon, hasColor: true },
  moonshotai: { Icon: MoonshotMonoIcon, hasColor: false }, "moonshotai-cn": { Icon: MoonshotMonoIcon, hasColor: false }, moonshot: { Icon: MoonshotMonoIcon, hasColor: false },
  minimax: { Icon: MinimaxColorIcon, hasColor: true }, "minimax-cn": { Icon: MinimaxColorIcon, hasColor: true }, fireworks: { Icon: FireworksColorIcon, hasColor: true },
  huggingface: { Icon: HuggingFaceColorIcon, hasColor: true }, cerebras: { Icon: CerebrasColorIcon, hasColor: true }, openrouter: { Icon: OpenRouterMonoIcon, hasColor: false },
  xai: { Icon: XAIMonoIcon, hasColor: false }, "cloudflare-ai-gateway": { Icon: CloudflareColorIcon, hasColor: true }, "cloudflare-workers-ai": { Icon: CloudflareColorIcon, hasColor: true },
  "vercel-ai-gateway": { Icon: VercelMonoIcon, hasColor: false }, "github-copilot": { Icon: GithubCopilotMonoIcon, hasColor: false }, "amazon-bedrock": { Icon: AwsColorIcon, hasColor: true },
  "azure-openai-responses": { Icon: AzureColorIcon, hasColor: true }, "kimi-coding": { Icon: KimiColorIcon, hasColor: true }, nvidia: { Icon: NvidiaColorIcon, hasColor: true },
  opencode: { Icon: OpenCodeMonoIcon, hasColor: false }, "opencode-go": { Icon: OpenCodeMonoIcon, hasColor: false }, qwen: { Icon: QwenColorIcon, hasColor: true },
  xiaomi: { Icon: XiaomiMiMoMonoIcon, hasColor: false }, "xiaomi-token-plan-ams": { Icon: XiaomiMiMoMonoIcon, hasColor: false }, "xiaomi-token-plan-cn": { Icon: XiaomiMiMoMonoIcon, hasColor: false }, "xiaomi-token-plan-sgp": { Icon: XiaomiMiMoMonoIcon, hasColor: false },
  zai: { Icon: ZAIMonoIcon, hasColor: false }, "zai-coding-cn": { Icon: ZAIMonoIcon, hasColor: false }, zhipu: { Icon: ZhipuColorIcon, hasColor: true },
  cohere: { Icon: CohereColorIcon, hasColor: true }, perplexity: { Icon: PerplexityColorIcon, hasColor: true }, together: { Icon: TogetherColorIcon, hasColor: true }, grok: { Icon: GrokMonoIcon, hasColor: false },
};

/** Renders a provider's logo, falling back to a neutral CPU icon for unknown providers. */
export function ProviderIcon({ id, size = 14 }: { id: string; size?: number }) {
  const providerIcon = PROVIDER_ICONS[id];
  if (!providerIcon) return <CpuIcon size={size} weight="regular" aria-hidden="true" />;
  if (providerIcon.hasColor) return <providerIcon.Icon size={size} />;
  return <providerIcon.Icon size={size} style={{ color: "currentColor" }} />;
}
