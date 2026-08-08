import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetch as undiciFetch, ProxyAgent, request as undiciRequest, Socks5ProxyAgent, type Dispatcher } from "undici";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { recordErrorLog } from "./error-log";

export type OpenCodeZenProxyProtocol = "http" | "https" | "socks5";

export interface OpenCodeZenProxy {
  protocol: OpenCodeZenProxyProtocol;
  enabled: boolean;
  url: string;
  port: number;
  username: string;
  password: string;
}

export interface OpenCodeZenAccount {
  id: string;
  note: string;
  apiKey: string;
  enabled: boolean;
  proxy: OpenCodeZenProxy;
}

export interface OpenCodeZenExternalAccess {
  enabled: boolean;
  port: number;
  apiKey: string;
}

export interface OpenCodeZenConfig {
  accounts: OpenCodeZenAccount[];
  autoSwitch: boolean;
  cooldownMs: number;
  externalAccess: OpenCodeZenExternalAccess;
}

export interface SafeOpenCodeZenExternalAccess extends Omit<OpenCodeZenExternalAccess, "apiKey"> {
  apiKeyMasked: string;
  hasApiKey: boolean;
  status: { running: boolean; port?: number; error?: string };
}

export interface SafeOpenCodeZenAccount extends Omit<OpenCodeZenAccount, "apiKey" | "proxy"> {
  apiKeyMasked: string;
  hasApiKey: boolean;
  proxy: Omit<OpenCodeZenProxy, "password"> & { hasPassword: boolean; password: string };
}

export interface SafeOpenCodeZenConfig {
  accounts: SafeOpenCodeZenAccount[];
  autoSwitch: boolean;
  cooldownMs: number;
  externalAccess: SafeOpenCodeZenExternalAccess;
  activeAccountId?: string;
  lastSwitch?: { timestamp: string; from?: string; to: string; statusCode: number };
}

const CONFIG_FILE = "opencode-zen.json";
export const DEFAULT_EXTERNAL_PORT = 7474;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;
/* 全池 429 全败后，把参与账号的长冷却压缩到此值，避免一个坏请求打瘫整池（后续请求 503） */
const SHORT_COOLDOWN_MS = 10_000;
/* 单请求主循环最多尝试的账号数：避免一个坏请求把全池账号都打冷；
 * 超过上限时剩余账号留给后续请求，全败后另有最近成功账号回退兜底 */
const MAX_ATTEMPTS = 3;

/**
 * Cooldown entry: `daily` entries model the OpenCode Zen per-day free quota —
 * they reset at the next UTC midnight and must never be force-tried by the
 * ignore-cooldown fallback, the short-cooldown compression, or the
 * last-success retry. Transient entries keep the old cooldownMs behavior.
 */
type CooldownEntry = { until: number; daily: boolean };

/** Next UTC midnight (00:00 UTC) — the daily quota reset point for Zen accounts. */
export function nextUtcMidnight(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0);
}

export interface OpenCodeZenSwitchEvent {
  sessionId?: string;
  from?: string;
  to: string;
  statusCode: number;
}

export type RuntimeState = {
  config: OpenCodeZenConfig;
  activeIndex: number;
  cooldownUntil: Map<string, CooldownEntry>;
  dispatchers: Map<string, Dispatcher>;
  /** 最近一次成功的账号 id：全败后回退硬试的目标 */
  lastSuccessId?: string;
  lastSwitch?: SafeOpenCodeZenConfig["lastSwitch"];
};

/**
 * Providers that receive the OpenCode Zen account key.
 *
 * pi-ai ships two Zen gateway providers (`opencode` → opencode.ai/zen and
 * `opencode-go` → opencode.ai/zen/go) whose model catalogs overlap for 12
 * models (gpt-5.6-luna, glm-5.2, kimi-k2.6, deepseek-v4-pro, ...). Injecting
 * the same key into both makes every shared model appear twice in the picker
 * as two identical "OpenCode Zen" groups. Only the default zen gateway is
 * keyed; the zen/go catalog's unique models (qwen3.7/3.8-max, hy3,
 * mimo-v2.5, mimo-v2.5-pro) are therefore not listed.
 */
export const OPENCODE_ZEN_PROVIDER_IDS = ["opencode"] as const;

/**
 * Gateways whose requests are routed through the account/proxy pool.
 * Kept separate from OPENCODE_ZEN_PROVIDER_IDS so a user who manually
 * configures an opencode-go provider (own baseUrl + key) still gets the pool.
 */
export function isOpenCodeZenProvider(provider: string): boolean {
  return provider === "opencode" || provider === "opencode-go";
}

declare global {
  var __piOpenCodeZenState: RuntimeState | undefined;
  var __piOpenCodeZenSwitchListeners: Set<(event: OpenCodeZenSwitchEvent) => void> | undefined;
  /** Written by lib/opencode-zen-external.ts; read here for the safe config snapshot. */
  var __piOpenCodeZenExternalStatus: { running: boolean; port?: number; error?: string } | undefined;
}

export function subscribeOpenCodeZenSwitch(listener: (event: OpenCodeZenSwitchEvent) => void): () => void {
  globalThis.__piOpenCodeZenSwitchListeners ??= new Set();
  globalThis.__piOpenCodeZenSwitchListeners.add(listener);
  return () => globalThis.__piOpenCodeZenSwitchListeners?.delete(listener);
}

function notifyOpenCodeZenSwitch(event: OpenCodeZenSwitchEvent): void {
  for (const listener of globalThis.__piOpenCodeZenSwitchListeners ?? []) listener(event);
}

function configPath(): string {
  return join(getAgentDir(), CONFIG_FILE);
}

function defaultProxy(): OpenCodeZenProxy {
  return { protocol: "http", enabled: false, url: "", port: 0, username: "", password: "" };
}

function defaultConfig(): OpenCodeZenConfig {
  return { accounts: [], autoSwitch: true, cooldownMs: DEFAULT_COOLDOWN_MS, externalAccess: { enabled: false, port: DEFAULT_EXTERNAL_PORT, apiKey: "" } };
}

function normalizeExternalAccess(value: unknown, fallback: OpenCodeZenExternalAccess): OpenCodeZenExternalAccess {
  const raw = isRecord(value) ? value : {};
  const port = Number(raw.port);
  return {
    // Opt-in: absent in legacy configs must mean disabled, never enabled.
    enabled: raw.enabled === true,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback.port,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : fallback.apiKey,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProxy(value: unknown): OpenCodeZenProxy {
  const raw = isRecord(value) ? value : {};
  const port = Number(raw.port);
  let url = typeof raw.url === "string" ? raw.url.trim() : "";
  // The protocol field is authoritative when present; otherwise infer it from
  // the pasted URL. Keeps existing configs (url-only) working unchanged.
  const rawProtocol = typeof raw.protocol === "string" ? raw.protocol.toLowerCase() : undefined;
  let protocol: OpenCodeZenProxyProtocol = rawProtocol === "https" || rawProtocol === "socks5" ? rawProtocol : "http";
  if (url && (rawProtocol === undefined || rawProtocol === "http" || rawProtocol === "https" || rawProtocol === "socks5")) {
    try {
      const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
      if (scheme === "socks5" || scheme === "https") protocol = scheme;
    } catch {
      // fall back to the explicit protocol field
    }
  }
  if (url) {
    try {
      const candidate = new URL(/^(https?|socks5):\/\//i.test(url) ? url : `http://${url}`);
      // Proxy credentials are stored in their dedicated fields. Strip any
      // credentials/path/query from pasted URLs before they can reach a safe
      // response or be logged.
      if (candidate.protocol !== "http:" && candidate.protocol !== "https:" && candidate.protocol !== "socks5:") {
        url = "";
      } else if (!candidate.username && !candidate.password && (candidate.pathname === "/" || candidate.pathname === "") && !candidate.search && !candidate.hash) {
        url = `${candidate.protocol}//${candidate.hostname}`;
      } else {
        url = "";
      }
    } catch {
      url = "";
    }
  }
  return {
    protocol,
    enabled: raw.enabled !== false,
    url,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : "",
  };
}

function normalizeAccount(value: unknown, index: number): OpenCodeZenAccount | null {
  if (!isRecord(value)) return null;
  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
  if (!apiKey) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : `account-${index + 1}`;
  return {
    id,
    note: typeof value.note === "string" && value.note.trim() ? value.note.trim() : id,
    apiKey,
    enabled: value.enabled !== false,
    proxy: normalizeProxy(value.proxy),
  };
}

function normalizeConfig(value: unknown): OpenCodeZenConfig {
  const raw = isRecord(value) ? value : {};
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts.map(normalizeAccount).filter((account): account is OpenCodeZenAccount => account !== null)
    : [];
  const cooldown = Number(raw.cooldownMs);
  const fallback = defaultConfig().externalAccess;
  return {
    accounts,
    autoSwitch: raw.autoSwitch !== false,
    cooldownMs: Number.isFinite(cooldown) ? Math.min(Math.max(cooldown, 0), MAX_COOLDOWN_MS) : DEFAULT_COOLDOWN_MS,
    externalAccess: normalizeExternalAccess(raw.externalAccess, fallback),
  };
}

function loadConfig(): OpenCodeZenConfig {
  try {
    if (existsSync(configPath())) return normalizeConfig(JSON.parse(readFileSync(configPath(), "utf8")));
    const authPath = join(getAgentDir(), "auth.json");
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
      const credential = isRecord(auth.opencode) ? auth.opencode : null;
      const key = credential && typeof credential.key === "string" ? credential.key.trim() : "";
      if (key) {
        return normalizeConfig({
          accounts: [{ id: "legacy-opencode", note: "默认 OpenCode Zen", apiKey: key, enabled: true, proxy: defaultProxy() }],
        });
      }
    }
    return defaultConfig();
  } catch {
    return defaultConfig();
  }
}

function getState(): RuntimeState {
  if (!globalThis.__piOpenCodeZenState) {
    globalThis.__piOpenCodeZenState = {
      config: loadConfig(),
      activeIndex: 0,
      cooldownUntil: new Map(),
      dispatchers: new Map(),
    };
  }
  return globalThis.__piOpenCodeZenState;
}

function persist(config: OpenCodeZenConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify(config, null, 2));
}

export function readOpenCodeZenConfig(): OpenCodeZenConfig {
  return structuredClone(getState().config);
}

export function getOpenCodeZenPrimaryKey(): string | null {
  return getState().config.accounts.find((account) => account.enabled && account.apiKey)?.apiKey ?? null;
}

/** Configure a newly-created ModelRuntime from the dedicated Zen pool.
 *  Never throws: the runtime overlay is written synchronously before the SDK's
 *  availability refresh, so a failed refresh must not block session creation,
 *  model listing, or a settings save — it only degrades the auth snapshot. */
export async function configureOpenCodeZenRuntime(modelRuntime: { setRuntimeApiKey: (provider: string, apiKey: string) => Promise<void> }): Promise<void> {
  const apiKey = getOpenCodeZenPrimaryKey();
  if (!apiKey) return;
  const results = await Promise.allSettled(
    OPENCODE_ZEN_PROVIDER_IDS.map((provider) => modelRuntime.setRuntimeApiKey(provider, apiKey)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      recordErrorLog({
        level: "warning",
        source: "opencode-zen-runtime",
        provider: "opencode",
        message: `设置 OpenCode Zen runtime Key 失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      });
    }
  }
}

export function writeOpenCodeZenConfig(config: OpenCodeZenConfig, activeAccountId?: string): void {
  const state = getState();
  state.config = normalizeConfig(config);
  state.activeIndex = activeAccountId
    ? Math.max(0, state.config.accounts.findIndex((account) => account.id === activeAccountId))
    : 0;
  state.cooldownUntil.clear();
  for (const dispatcher of state.dispatchers.values()) void dispatcher.close().catch(() => {});
  state.dispatchers.clear();
  persist(state.config);
}

export function maskOpenCodeKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function getSafeOpenCodeZenConfig(): SafeOpenCodeZenConfig {
  const state = getState();
  const active = state.config.accounts[state.activeIndex];
  const external = state.config.externalAccess;
  return {
    accounts: state.config.accounts.map((account) => ({
      id: account.id,
      note: account.note,
      enabled: account.enabled,
      apiKeyMasked: maskOpenCodeKey(account.apiKey),
      hasApiKey: Boolean(account.apiKey),
      proxy: {
        protocol: account.proxy.protocol,
        enabled: account.proxy.enabled,
        url: account.proxy.url,
        port: account.proxy.port,
        username: account.proxy.username,
        password: "",
        hasPassword: Boolean(account.proxy.password),
      },
    })),
    autoSwitch: state.config.autoSwitch,
    cooldownMs: state.config.cooldownMs,
    externalAccess: {
      enabled: external.enabled,
      port: external.port,
      apiKeyMasked: maskOpenCodeKey(external.apiKey),
      hasApiKey: Boolean(external.apiKey),
      status: globalThis.__piOpenCodeZenExternalStatus ?? { running: false },
    },
    ...(active ? { activeAccountId: active.id } : {}),
    ...(state.lastSwitch ? { lastSwitch: state.lastSwitch } : {}),
  };
}

/** Parse `account-apikey`; only the first dash separates the note and key. */
export function parseOpenCodeKeyImport(text: string): Array<{ note: string; apiKey: string }> {
  const result: Array<{ note: string; apiKey: string }> = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("-");
    if (separator <= 0 || separator === line.length - 1) {
      throw new Error(`第 ${index + 1} 行格式错误：需要 账号-apikey`);
    }
    const note = line.slice(0, separator).trim();
    const apiKey = line.slice(separator + 1).trim();
    if (!note || !apiKey) throw new Error(`第 ${index + 1} 行账号或 API Key 为空`);
    result.push({ note, apiKey });
  }
  return result;
}

function proxyUri(proxy: OpenCodeZenProxy): string | null {
  if (!proxy.enabled || !proxy.url || !proxy.port) return null;
  if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    throw new Error("代理端口无效，必须为 1-65535 的整数");
  }
  let value = proxy.url.trim();
  if (value.includes("://") && !/^(https?|socks5):\/\//i.test(value)) {
    throw new Error("OpenCode Zen 账号代理仅支持 http/https/socks5");
  }
  if (!/^(https?|socks5):\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("代理 URL 只允许主机名，用户名和密码请填写独立字段");
  }
  url.port = String(proxy.port);
  if (proxy.username) url.username = proxy.username;
  if (proxy.password) url.password = proxy.password;
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "socks5:") {
    throw new Error("OpenCode Zen 账号代理仅支持 http/https/socks5");
  }
  return url.toString();
}

function createProxyDispatcher(uri: string, protocol: OpenCodeZenProxyProtocol): Dispatcher {
  return protocol === "socks5" ? new Socks5ProxyAgent(uri) : new ProxyAgent(uri);
}

function accountDispatcher(state: RuntimeState, account: OpenCodeZenAccount): Dispatcher | undefined {
  const uri = proxyUri(account.proxy);
  if (!uri) return undefined;
  const cached = state.dispatchers.get(account.id);
  if (cached) return cached;
  const dispatcher = createProxyDispatcher(uri, account.proxy.protocol);
  state.dispatchers.set(account.id, dispatcher);
  return dispatcher;
}

export async function testOpenCodeZenProxy(proxy: OpenCodeZenProxy): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string }> {
  const uri = proxyUri(proxy);
  if (!uri) return { ok: true, latencyMs: 0 };
  const dispatcher = createProxyDispatcher(uri, proxy.protocol);
  const started = Date.now();
  try {
    const response = await undiciRequest("https://opencode.ai/zen/v1/models", {
      dispatcher,
      headers: { Accept: "application/json", "User-Agent": "pi-web-opencode-zen-test" },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
    await response.body.text();
    return { ok: response.statusCode < 500, status: response.statusCode, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: redactProxyError(error instanceof Error ? error.message : String(error)) };
  } finally {
    await dispatcher.close().catch(() => {});
  }
}

function isOpenCodeTarget(input: FetchInput): boolean {
  try {
    const value = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    return new URL(value).hostname === "opencode.ai";
  } catch {
    return false;
  }
}

function redactProxyError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "[proxy]@")
    .replace(/(password|pass|secret|token|key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function fetchUrl(input: FetchInput): string {
  return typeof input === "string" || input instanceof URL ? input.toString() : input.url;
}

/** 导出仅供测试 */
export function nextAccount(state: RuntimeState, excludedIds: ReadonlySet<string> = new Set(), ignoreCooldown = false): OpenCodeZenAccount | null {
  const now = Date.now();
  const total = state.config.accounts.length;
  if (total === 0) return null;
  /* 冷却中且冷却最早过期（最接近可用）的账号，供 ignoreCooldown 兜底硬试。
   * 日级（daily）冷却的账号不参与兜底——它们到 UTC 0 点才重置，硬试只会再吃 429。 */
  let earliest: { account: OpenCodeZenAccount; index: number; until: number } | null = null;
  for (let offset = 0; offset < total; offset++) {
    const index = (state.activeIndex + offset) % total;
    const account = state.config.accounts[index];
    if (!account.enabled || !account.apiKey || excludedIds.has(account.id)) continue;
    const entry = state.cooldownUntil.get(account.id);
    const until = entry?.until ?? 0;
    if (until > now) {
      if (!entry?.daily && (!earliest || until < earliest.until)) earliest = { account, index, until };
      continue;
    }
    state.activeIndex = (index + 1) % total;
    return account;
  }
  /* 冷却池兜底：全池都在冷却时忽略冷却，取最早过期的账号硬试（对应 codex-proxy 的 PickIgnoringCooldown） */
  if (ignoreCooldown && earliest) {
    state.activeIndex = (earliest.index + 1) % total;
    return earliest.account;
  }
  return null;
}

async function replayableBody(input: FetchInput, init: RequestInit | undefined): Promise<BodyInit | undefined> {
  const body = init?.body;
  if (body === null) return undefined;
  if (body === undefined && input instanceof Request && input.body !== null) {
    try {
      return await input.clone().arrayBuffer();
    } catch {
      return undefined;
    }
  }
  if (body === undefined) return undefined;
  if (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof Blob) return body;
  // A caller-provided ReadableStream is one-shot from fetch's perspective.
  // Do not consume it just to guess whether it can be replayed; a 429 must be
  // returned to the SDK instead of silently sending an empty second request.
  return undefined;
}

function requestInitFor(input: FetchInput, init: RequestInit | undefined, state: RuntimeState, account: OpenCodeZenAccount, body: BodyInit | undefined): RequestInit & { dispatcher?: Dispatcher } {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("authorization", `Bearer ${account.apiKey}`);
  const dispatcher = accountDispatcher(state, account);
  return {
    ...init,
    ...(input instanceof Request && init?.method === undefined ? { method: input.method } : {}),
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(dispatcher ? { dispatcher } : {}),
  };
}

export function createOpenCodeZenFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  sessionId?: string,
  configOverride?: OpenCodeZenConfig,
): typeof globalThis.fetch {
  /* 池状态挂在闭包上（每个 fetch 实例一套运行时态）：覆盖配置时跨请求共享冷却/最近成功账号，
   * 生产（无覆盖）则共享全局态。注意不能放到每次请求内重建，否则冷却与回退记忆全部丢失。 */
  const state: RuntimeState = configOverride
    ? { config: normalizeConfig(configOverride), activeIndex: 0, cooldownUntil: new Map(), dispatchers: new Map() }
    : getState();
  return async (input, init) => {
    if (!isOpenCodeTarget(input)) return baseFetch(input, init);
    const accounts = state.config.accounts.filter((account) => account.enabled && account.apiKey);
    if (accounts.length === 0) {
      return new Response("OpenCode Zen accounts are unavailable", { status: 503 });
    }

    /* 发送辅助：带账号 Key 与（如有）独立代理 dispatcher 发请求 */
    const send = async (account: OpenCodeZenAccount): Promise<Response> => {
      const requestInit = requestInitFor(input, init, state, account, body);
      return requestInit.dispatcher
        ? await undiciFetch(
          fetchUrl(input),
          requestInit as unknown as Parameters<typeof undiciFetch>[1],
        ) as unknown as Response
        : await baseFetch(input, requestInit);
    };

    const body = await replayableBody(input, init);
    const requestHasBody = input instanceof Request ? input.body !== null : init?.body !== undefined && init.body !== null;
    const canReplay = !requestHasBody || body !== undefined;
    const triedAccountIds = new Set<string>();
    /* 全池都在冷却时仍取最早过期的账号硬试（冷却池兜底，日级冷却除外），不直接 503 */
    let account = nextAccount(state, triedAccountIds) ?? nextAccount(state, triedAccountIds, true);
    if (!account) {
      /* Retry-After 按最早解冻时间（日级冷却为距 UTC 0 点的秒数） */
      let earliestUntil = Infinity;
      for (const entry of state.cooldownUntil.values()) if (entry.until < earliestUntil) earliestUntil = entry.until;
      const retryAfter = Number.isFinite(earliestUntil)
        ? Math.max(1, Math.ceil((earliestUntil - Date.now()) / 1000))
        : Math.ceil(state.config.cooldownMs / 1000);
      return new Response("OpenCode Zen accounts are cooling down", { status: 503, headers: { "Retry-After": String(retryAfter) } });
    }
    let lastResponse: Response | null = null;
    let switchedFrom: string | undefined;
    /* 单请求最多尝试 MAX_ATTEMPTS 个账号，剩余账号留给后续请求，避免一个坏请求把全池打冷 */
    const attempts = state.config.autoSwitch && canReplay ? Math.min(Math.max(accounts.length, 1), MAX_ATTEMPTS) : 1;

    for (let attempt = 0; attempt < attempts && account; attempt++) {
      triedAccountIds.add(account.id);
      const response = await send(account);
      if (response.status !== 429 || !state.config.autoSwitch) {
        if (response.ok) state.lastSuccessId = account.id;
        if (response.ok && switchedFrom) notifyOpenCodeZenSwitch({ sessionId, from: switchedFrom, to: account.note, statusCode: 429 });
        return response;
      }
      const responseBody = await response.arrayBuffer();
      lastResponse = new Response(responseBody, { status: response.status, statusText: response.statusText, headers: response.headers });
      const previous = account;
      /* 429 = 当日免费额度耗尽：冷却到下一个 UTC 0 点自动重置，而非固定时长 */
      state.cooldownUntil.set(previous.id, { until: nextUtcMidnight(), daily: true });
      if (attempt === attempts - 1) break; /* 本请求尝试次数已用尽，走统一后处理 */
      account = nextAccount(state, triedAccountIds, true);
      if (!account) break;
      state.lastSwitch = { timestamp: new Date().toISOString(), from: previous.note, to: account.note, statusCode: 429 };
      switchedFrom = previous.note;
      recordErrorLog({ level: "info", source: "opencode-zen-switch", provider: "opencode", message: `OpenCode Zen 429，已从 ${previous.note} 切换到 ${account.note}` });
    }

    /* 全败后：把参与账号的长冷却压缩为短冷却，让后续请求能尽快重新选号（日级冷却不压缩） */
    if (lastResponse && state.config.autoSwitch && triedAccountIds.size > 0) {
      const shortUntil = Date.now() + SHORT_COOLDOWN_MS;
      for (const id of triedAccountIds) {
        const entry = state.cooldownUntil.get(id);
        if (entry && !entry.daily && entry.until > shortUntil) state.cooldownUntil.set(id, { until: shortUntil, daily: false });
      }
    }

    /* 回退最近成功账号：主循环未试过它时（被尝试上限截断或处于冷却被跳过），忽略冷却硬试一次；
     * 日级冷却中的最近成功账号不参与回退（到 UTC 0 点才重置，硬试只会再吃 429） */
    if (lastResponse && state.config.autoSwitch && canReplay && state.lastSuccessId && !triedAccountIds.has(state.lastSuccessId)) {
      const fallbackAccount = state.config.accounts.find((item) => item.id === state.lastSuccessId && item.enabled && item.apiKey && !state.cooldownUntil.get(item.id)?.daily);
      if (fallbackAccount) {
        triedAccountIds.add(fallbackAccount.id);
        recordErrorLog({ level: "info", source: "opencode-zen-switch", provider: "opencode", message: `OpenCode Zen 全败后回退最近成功账号 ${fallbackAccount.note}` });
        const response = await send(fallbackAccount);
        if (response.status !== 429) {
          if (response.ok) {
            state.activeIndex = Math.max(0, state.config.accounts.findIndex((item) => item.id === fallbackAccount.id));
            state.lastSuccessId = fallbackAccount.id;
            if (switchedFrom) notifyOpenCodeZenSwitch({ sessionId, from: switchedFrom, to: fallbackAccount.note, statusCode: 429 });
          }
          return response;
        }
        const responseBody = await response.arrayBuffer();
        lastResponse = new Response(responseBody, { status: response.status, statusText: response.statusText, headers: response.headers });
        state.cooldownUntil.set(fallbackAccount.id, { until: nextUtcMidnight(), daily: true });
      }
    }

    return lastResponse ?? new Response("OpenCode Zen accounts are unavailable", { status: 503 });
  };
}

export function getOpenCodeZenAccountKey(id: string): string | null {
  return getState().config.accounts.find((account) => account.id === id)?.apiKey ?? null;
}

export function getOpenCodeZenAccountProxy(id: string): OpenCodeZenProxy | null {
  return getState().config.accounts.find((account) => account.id === id)?.proxy ?? null;
}

export function mergeOpenCodeZenConfig(input: unknown): OpenCodeZenConfig {
  const current = readOpenCodeZenConfig();
  if (!isRecord(input)) return current;
  // `accounts` missing (e.g. a switch-active-account PUT) must keep the
  // current list — treating it as [] would wipe every configured account.
  const rawAccounts = Array.isArray(input.accounts) ? input.accounts : current.accounts;
  const accounts = rawAccounts.map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `account-${index + 1}`;
    const previous = current.accounts.find((account) => account.id === id);
    const previousProxy = previous?.proxy ?? defaultProxy();
    const rawProxy = isRecord(item.proxy) ? item.proxy : {};
    return {
      id,
      note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : previous?.note ?? id,
      apiKey: typeof item.apiKey === "string" && item.apiKey.trim() ? item.apiKey.trim() : previous?.apiKey ?? "",
      enabled: item.enabled !== false,
      proxy: {
        protocol: rawProxy.protocol === "http" || rawProxy.protocol === "https" || rawProxy.protocol === "socks5" ? rawProxy.protocol : previousProxy.protocol,
        enabled: typeof rawProxy.enabled === "boolean" ? rawProxy.enabled : previousProxy.enabled,
        url: typeof rawProxy.url === "string" ? rawProxy.url.trim() : previousProxy.url,
        port: Number.isInteger(Number(rawProxy.port)) ? Number(rawProxy.port) : previousProxy.port,
        username: typeof rawProxy.username === "string" ? rawProxy.username : previousProxy.username,
        password: typeof rawProxy.password === "string" && rawProxy.password ? rawProxy.password : previousProxy.password,
      },
    } satisfies OpenCodeZenAccount;
  }).filter((account) => account.apiKey);
  const rawExternal = isRecord(input.externalAccess) ? input.externalAccess : {};
  const externalAccess = normalizeExternalAccess(
    {
      enabled: typeof rawExternal.enabled === "boolean" ? rawExternal.enabled : current.externalAccess.enabled,
      port: Number.isInteger(Number(rawExternal.port)) ? Number(rawExternal.port) : current.externalAccess.port,
      apiKey: typeof rawExternal.apiKey === "string" && rawExternal.apiKey.trim() ? rawExternal.apiKey.trim() : current.externalAccess.apiKey,
    },
    current.externalAccess,
  );
  return normalizeConfig({
    accounts,
    autoSwitch: typeof input.autoSwitch === "boolean" ? input.autoSwitch : current.autoSwitch,
    cooldownMs: typeof input.cooldownMs === "number" ? input.cooldownMs : current.cooldownMs,
    externalAccess,
  });
}

export function importOpenCodeZenKeys(text: string): SafeOpenCodeZenConfig {
  const current = readOpenCodeZenConfig();
  const imported = parseOpenCodeKeyImport(text);
  const accounts = [...current.accounts];
  for (const item of imported) {
    // 同一个 Key 再次导入时不新增账号，只更新它的备注（账号名）。
    const existingByKey = accounts.find((account) => account.apiKey === item.apiKey);
    if (existingByKey) {
      if (existingByKey.note !== item.note) existingByKey.note = item.note;
      continue;
    }
    accounts.push({ id: `account-${Date.now().toString(36)}-${accounts.length}`, note: item.note, apiKey: item.apiKey, enabled: true, proxy: defaultProxy() });
  }
  writeOpenCodeZenConfig({ ...current, accounts });
  return getSafeOpenCodeZenConfig();
}

export function replaceOpenCodeZenProxy(accountId: string, proxy: OpenCodeZenProxy): SafeOpenCodeZenConfig {
  const current = readOpenCodeZenConfig();
  const account = current.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("OpenCode Zen account not found");
  account.proxy = normalizeProxy(proxy);
  writeOpenCodeZenConfig(current);
  return getSafeOpenCodeZenConfig();
}

export function opencodeZenConfigFile(): string {
  return configPath();
}
