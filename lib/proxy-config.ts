import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface ProxyConfig {
  enabled: boolean;
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username: string;
  password: string;
  noProxy: string;
}

const PROXY_KEY = "proxy";

const VALID_PROTOCOLS = ["http", "https", "socks5"] as const;
type Protocol = (typeof VALID_PROTOCOLS)[number];

function defaultProxyConfig(): ProxyConfig {
  return {
    enabled: false,
    protocol: "http",
    host: "127.0.0.1",
    port: 7890,
    username: "",
    password: "",
    noProxy: "localhost,127.0.0.1,.local",
  };
}

function getSettingsPath(): string {
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

/** Current proxy configuration from ~/.pi/agent/settings.json. */
export function readProxyConfig(): ProxyConfig {
  const raw = readSettingsJson()[PROXY_KEY] as Record<string, unknown> | undefined;
  const defaults = defaultProxyConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;

  const protocol = VALID_PROTOCOLS.includes(raw.protocol as Protocol)
    ? (raw.protocol as Protocol)
    : defaults.protocol;

  const port = Number(raw.port);
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    protocol,
    host: typeof raw.host === "string" && raw.host.length > 0 ? raw.host : defaults.host,
    port: validPort ? port : defaults.port,
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : "",
    noProxy: typeof raw.noProxy === "string" ? raw.noProxy : defaults.noProxy,
  };
}

/** Persist the proxy configuration into ~/.pi/agent/settings.json (atomic write). */
export function writeProxyConfig(config: ProxyConfig): void {
  const settings = readSettingsJson();
  settings[PROXY_KEY] = config;
  writePrivateFileAtomicSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

/**
 * Build a fully-qualified proxy URL from the config, e.g.
 * `socks5://user:pass@127.0.0.1:7890`. Returns null when disabled/incomplete.
 * Special characters in credentials are percent-encoded.
 */
export function buildProxyUrl(config: ProxyConfig): string | null {
  if (!config.enabled || !config.host || !config.port) return null;
  let auth = "";
  if (config.username) {
    const encodedUsername = encodeURIComponent(config.username);
    auth = config.password
      ? `${encodedUsername}:${encodeURIComponent(config.password)}@`
      : `${encodedUsername}@`;
  }
  return `${config.protocol}://${auth}${config.host}:${config.port}`;
}

/**
 * Apply the proxy config to the current process environment so
 * EnvHttpProxyAgent (undici) picks it up for all server-side requests.
 * Clears variables when the proxy is disabled.
 */
export function applyProxyEnv(config: ProxyConfig): void {
  const url = buildProxyUrl(config);
  if (url) {
    process.env.HTTP_PROXY = url;
    process.env.HTTPS_PROXY = url;
    process.env.NO_PROXY = config.noProxy || "";
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    process.env.NO_PROXY = "";
  }
}