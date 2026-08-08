import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface VisionConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface SafeVisionConfig extends Omit<VisionConfig, "apiKey"> {
  apiKey: string;
  hasApiKey: boolean;
}

const KEYS = ["MCP_OCR_PROVIDER", "MCP_OCR_BASE_URL", "MCP_OCR_API_KEY", "MCP_OCR_MODEL", "MCP_OCR_MAX_TOKENS"] as const;

function envPath(): string {
  return join(dirname(getAgentDir()), "plugins", "deepseek-vision", ".env");
}

function defaults(): VisionConfig {
  return { provider: "custom", baseUrl: "", apiKey: "", model: "", maxTokens: 4096 };
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    if (!existsSync(envPath())) return values;
    for (const line of readFileSync(envPath(), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = parseEnvValue(match[2]);
    }
  } catch {
    return {};
  }
  return values;
}

export function readVisionConfig(): VisionConfig {
  const values = readEnv();
  const maxTokens = Number(values.MCP_OCR_MAX_TOKENS);
  const fallback = defaults();
  return {
    provider: values.MCP_OCR_PROVIDER || fallback.provider,
    baseUrl: values.MCP_OCR_BASE_URL || fallback.baseUrl,
    apiKey: values.MCP_OCR_API_KEY || fallback.apiKey,
    model: values.MCP_OCR_MODEL || fallback.model,
    maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : fallback.maxTokens,
  };
}

export function readSafeVisionConfig(): SafeVisionConfig {
  const config = readVisionConfig();
  return { ...config, apiKey: "", hasApiKey: Boolean(config.apiKey) };
}

export function writeVisionConfig(input: Partial<VisionConfig>): void {
  const current = readVisionConfig();
  const next: VisionConfig = {
    provider: typeof input.provider === "string" && input.provider.trim() ? input.provider.trim() : current.provider,
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim() : current.baseUrl,
    apiKey: typeof input.apiKey === "string" && input.apiKey ? input.apiKey : current.apiKey,
    model: typeof input.model === "string" ? input.model.trim() : current.model,
    maxTokens: typeof input.maxTokens === "number" && Number.isInteger(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : current.maxTokens,
  };

  const path = envPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const replacements: Record<string, string> = {
    MCP_OCR_PROVIDER: next.provider,
    MCP_OCR_BASE_URL: next.baseUrl,
    MCP_OCR_API_KEY: next.apiKey,
    MCP_OCR_MODEL: next.model,
    MCP_OCR_MAX_TOKENS: String(next.maxTokens),
  };
  const seen = new Set<string>();
  const lines = original.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !KEYS.includes(match[1] as typeof KEYS[number])) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${replacements[key]}`;
  });
  for (const key of KEYS) {
    if (!seen.has(key)) lines.push(`${key}=${replacements[key]}`);
  }
  writePrivateFileAtomicSync(path, `${lines.filter((line, index) => index < lines.length - 1 || line !== "").join("\n")}\n`);
}

export function getVisionConfigPath(): string {
  return envPath();
}
