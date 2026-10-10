import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Scan other local coding agents' config files and turn their provider/model
 * entries into pi-web `~/.pi/agent/models.json` provider drafts.
 *
 * Mirrors PI-Desktop's model-config importer (sources: Claude Code, Codex,
 * OpenCode, cc-switch, Pi) but emits this project's `ProviderEntry` shape and
 * only the five API strings this app supports. Parsing is pure and separately
 * testable; `scanModelConfigSources()` is the fs boundary.
 *
 * Secrets never leave the draft: `scanModelConfigSources` returns public
 * candidates (`hasKey` boolean only), and the run path re-reads drafts by key.
 */

export const MODEL_CONFIG_IMPORT_SOURCES = [
  "claude-code",
  "codex",
  "opencode",
  "cc-switch",
  "pi",
] as const;

export type ModelConfigImportSource = (typeof MODEL_CONFIG_IMPORT_SOURCES)[number];

export interface ImportedModel {
  id: string;
  name?: string;
}

/** A provider ready to be written into models.json. */
export interface ModelConfigImportDraft {
  source: ModelConfigImportSource;
  externalId: string;
  name: string;
  baseUrl: string | null;
  /** pi api string (one of API_OPTIONS). */
  api: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ImportedModel[];
  hasKey: boolean;
}

/** What the scan returns to the renderer — no secret values. */
export type ModelConfigImportCandidate = Omit<ModelConfigImportDraft, "apiKey" | "headers">;

const MAX_MODELS_PER_PROVIDER = 64;
const MAX_NAME_LENGTH = 80;

/** pi-web API_OPTIONS; importer normalises every foreign style onto these. */
const API_CHAT = "openai-completions";
const API_RESPONSES = "openai-responses";
const API_ANTHROPIC = "anthropic-messages";
const API_GOOGLE = "google-generative-ai";

const API_STYLE_ALIASES: Record<string, string> = {
  chat: API_CHAT,
  chat_completions: API_CHAT,
  "chat-completions": API_CHAT,
  completions: API_CHAT,
  "openai-chat": API_CHAT,
  "openai-completions": API_CHAT,
  openai_completions: API_CHAT,
  responses: API_RESPONSES,
  "openai-responses": API_RESPONSES,
  openai_responses: API_RESPONSES,
  anthropic: API_ANTHROPIC,
  anthropic_messages: API_ANTHROPIC,
  "anthropic-messages": API_ANTHROPIC,
  google: API_GOOGLE,
  google_generative_ai: API_GOOGLE,
  "google-generative-ai": API_GOOGLE,
};

export function isModelConfigImportSource(value: unknown): value is ModelConfigImportSource {
  return typeof value === "string" && (MODEL_CONFIG_IMPORT_SOURCES as readonly string[]).includes(value);
}

export function modelConfigImportKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export function publicModelConfigCandidate(draft: ModelConfigImportDraft): ModelConfigImportCandidate {
  // Deliberately copy field by field: the secret (`apiKey`) and `headers`
  // must never reach the renderer, and an explicit list can't leak one later.
  return {
    source: draft.source,
    externalId: draft.externalId,
    name: draft.name,
    baseUrl: draft.baseUrl,
    api: draft.api,
    models: draft.models,
    hasKey: draft.hasKey,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

/** Resolve `${VAR}` / `$VAR` against env, then fall back to a literal value. */
function resolveSecret(value: string | null | undefined, env: Record<string, string | undefined>): string | undefined {
  if (!value) return undefined;
  const resolved = value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => env[name] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => env[name] ?? "");
  return resolved.trim() || undefined;
}

function resolveApiStyle(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return API_STYLE_ALIASES[raw.trim().toLowerCase()];
}

/** `"!<cmd>"` secret values are executed by pi at request time; never do that. */
function isShellCommandSecret(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("!");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clampModels(models: ImportedModel[]): ImportedModel[] {
  return models.slice(0, MAX_MODELS_PER_PROVIDER);
}

function clampName(name: string): string {
  return name.slice(0, MAX_NAME_LENGTH);
}

function modelIdsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const record = asRecord(value);
    if (record) return Object.keys(record);
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = typeof entry === "string" ? entry : asRecord(entry)?.id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return unique(ids);
}

function modelsFromUnknown(value: unknown): ImportedModel[] {
  if (!Array.isArray(value)) {
    const record = asRecord(value);
    if (record) {
      return Object.entries(record).map(([id, raw]) => {
        const name = firstString(asRecord(raw)?.name, asRecord(raw)?.label);
        return name ? { id, name } : { id };
      });
    }
    return [];
  }
  const out: ImportedModel[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ id: entry.trim() });
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const id = firstString(record.id, record.model, record.modelId);
    if (!id) continue;
    const name = firstString(record.name, record.displayName);
    out.push(name ? { id, name } : { id });
  }
  return out;
}

function authApiKey(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return firstString(record.apiKey, record.api_key, record.key, record.access_token) ?? undefined;
}

// ── Claude Code ───────────────────────────────────────────────────────────────

export function parseClaudeCodeModelConfig(
  settings: unknown,
  localSettings?: unknown,
  env: Record<string, string | undefined> = {},
): ModelConfigImportDraft[] {
  const global = asRecord(settings) ?? {};
  const local = asRecord(localSettings) ?? {};
  const merged = { ...stringMap(global.env), ...stringMap(local.env) };
  const baseUrl = firstString(merged.ANTHROPIC_BASE_URL, merged.ANTHROPIC_API_URL);
  const secret = resolveSecret(firstString(merged.ANTHROPIC_API_KEY, merged.ANTHROPIC_AUTH_TOKEN), env);
  const modelIds = unique([
    firstString(local.model, global.model),
    merged.ANTHROPIC_DEFAULT_SONNET_MODEL,
    merged.ANTHROPIC_DEFAULT_OPUS_MODEL,
    merged.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    merged.ANTHROPIC_MODEL,
  ].filter((v): v is string => Boolean(v)));
  if (modelIds.length === 0) return [];
  if (!baseUrl && !secret) return [];
  return [{
    source: "claude-code",
    externalId: "default",
    name: "Claude Code",
    baseUrl: baseUrl ?? null,
    api: API_ANTHROPIC,
    ...(secret ? { apiKey: secret } : {}),
    models: clampModels(modelIds.map((id) => ({ id }))),
    hasKey: Boolean(secret),
  }];
}

// ── OpenCode ──────────────────────────────────────────────────────────────────

export function parseOpenCodeModelConfig(
  config: unknown,
  auth?: unknown,
  env: Record<string, string | undefined> = {},
): ModelConfigImportDraft[] {
  const root = asRecord(config) ?? {};
  const providers = asRecord(root.provider) ?? asRecord(root.providers) ?? {};
  const authMap = asRecord(auth) ?? {};
  const defaultModel = firstString(root.model);
  const drafts: ModelConfigImportDraft[] = [];

  for (const [id, raw] of Object.entries(providers)) {
    const record = asRecord(raw);
    if (!record) continue;
    const options = asRecord(record.options) ?? {};
    const baseUrl = firstString(options.baseURL, options.baseUrl, record.baseURL, record.baseUrl);
    const api = resolveApiStyle(firstString(record.api, options.api, record.apiStyle)) ?? API_CHAT;
    const ownModels = modelsFromUnknown(record.models);
    const modelIds = ownModels.length > 0
      ? ownModels
      : (defaultModel && defaultModel.startsWith(`${id}/`) ? [{ id: defaultModel }] : []);
    if (modelIds.length === 0) continue;
    const headers = stringMap(options.headers ?? record.headers);
    const secret = resolveSecret(
      firstString(options.apiKey, record.apiKey) ?? authApiKey(authMap[id]),
      env,
    );
    drafts.push({
      source: "opencode",
      externalId: id,
      name: clampName(firstString(record.name, record.label) || id),
      baseUrl: baseUrl ?? null,
      api,
      ...(secret ? { apiKey: secret } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      models: clampModels(modelIds),
      hasKey: Boolean(secret),
    });
  }
  return drafts;
}

// ── Codex (TOML) ──────────────────────────────────────────────────────────────

interface TomlExtract {
  root: Record<string, string | boolean>;
  tables: Map<string, Record<string, string | boolean>>;
}

/**
 * The narrow TOML subset Codex config uses: scalar root keys plus
 * `[model_providers.<id>]` tables of newline-separated `key = value` pairs.
 * Anything more exotic is ignored rather than mis-read.
 */
function parseTomlSubset(text: string): TomlExtract {
  const root: Record<string, string | boolean> = {};
  const tables = new Map<string, Record<string, string | boolean>>();
  let current = root;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line || line.startsWith("[[")) continue;
    if (line.startsWith("[")) {
      if (!line.endsWith("]")) continue;
      const header = line.slice(1, -1).trim();
      if (!header) continue;
      const existing = tables.get(header) ?? {};
      tables.set(header, existing);
      current = existing;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    const value = parseTomlValue(line.slice(eq + 1).trim());
    if (!key || value === undefined) continue;
    current[key] = value;
  }
  return { root, tables };
}

function stripTomlComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function parseTomlValue(raw: string): string | boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"/) ?? raw.match(/^'((?:[^'\\]|\\.)*)'/);
  if (quoted) return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const bare = raw.match(/^[^\s#]+/);
  return bare ? bare[0] : undefined;
}

export function parseCodexModelConfig(
  toml: string,
  env: Record<string, string | undefined> = {},
): ModelConfigImportDraft[] {
  const { root, tables } = parseTomlSubset(toml);
  const defaultModel = typeof root.model === "string" ? root.model : null;
  const drafts: ModelConfigImportDraft[] = [];

  for (const [tableKey, fields] of tables) {
    if (!tableKey.startsWith("model_providers.")) continue;
    const id = tableKey.slice("model_providers.".length);
    if (!id) continue;
    if (fields.requires_openai_auth === true && !fields.env_key && !fields.api_key) continue;
    const baseUrl = firstString(fields.base_url, fields.baseUrl);
    const envKey = firstString(fields.env_key, fields.envKey);
    const secret = resolveSecret(firstString(fields.api_key, fields.apiKey), env)
      ?? (envKey ? env[envKey] : undefined);
    const api = resolveApiStyle(firstString(fields.wire_api, fields.wireApi)) ?? API_CHAT;
    const modelIds = unique([
      defaultModel,
      ...(typeof fields.models === "string" ? fields.models.split(",").map((m) => m.trim()) : []),
    ].filter((v): v is string => Boolean(v)));
    if (modelIds.length === 0) continue;
    drafts.push({
      source: "codex",
      externalId: id,
      name: clampName(firstString(fields.name) || id),
      baseUrl: baseUrl ?? null,
      api,
      ...(secret ? { apiKey: secret } : {}),
      models: clampModels(modelIds.map((m) => ({ id: m }))),
      hasKey: Boolean(secret),
    });
  }
  return drafts;
}

// ── Pi (~/.pi/agent/models.json) ──────────────────────────────────────────────

export function parsePiModelConfig(
  modelsJson: unknown,
  env: Record<string, string | undefined> = {},
): ModelConfigImportDraft[] {
  const root = asRecord(modelsJson) ?? {};
  const providers = asRecord(root.providers) ?? root;
  const drafts: ModelConfigImportDraft[] = [];

  for (const [id, raw] of Object.entries(providers)) {
    if (id === "providers") continue;
    const record = asRecord(raw);
    if (!record) continue;
    const baseUrl = firstString(record.baseUrl, record.baseURL, record.url);
    const api = resolveApiStyle(firstString(record.api, record.apiStyle, record.type)) ?? API_CHAT;
    const headers = stringMap(record.headers);
    const rawKey = record.apiKey ?? record.api_key;
    const secret = isShellCommandSecret(rawKey) ? undefined : resolveSecret(firstString(rawKey), env);
    const models = modelsFromUnknown(record.models);
    if (models.length === 0) continue;
    drafts.push({
      source: "pi",
      externalId: id,
      name: clampName(firstString(record.name, record.label) || id),
      baseUrl: baseUrl ?? null,
      api,
      ...(secret ? { apiKey: secret } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      models: clampModels(models),
      hasKey: Boolean(secret),
    });
  }
  return drafts;
}

// ── cc-switch (legacy ~/.cc-switch/config.json) ───────────────────────────────

const CC_SWITCH_APP_TYPES = ["claude", "claude-desktop", "codex", "pi"] as const;

export function parseCcSwitchConfigJson(document: unknown): { id: string; appType: string; name: string; settingsConfig: unknown }[] {
  const root = asRecord(document);
  if (!root) return [];
  const rows: { id: string; appType: string; name: string; settingsConfig: unknown }[] = [];
  for (const appType of CC_SWITCH_APP_TYPES) {
    const app = asRecord(root[appType]);
    const providers = asRecord(app?.providers);
    if (!providers) continue;
    for (const [id, raw] of Object.entries(providers)) {
      const record = asRecord(raw);
      if (!record) continue;
      rows.push({
        id: firstString(record.id) || id,
        appType,
        name: firstString(record.name) || id,
        settingsConfig: record.settingsConfig ?? record.settings_config ?? record,
      });
    }
  }
  return rows;
}

export function parseCcSwitchProviders(
  rows: { id: string; appType: string; name: string; settingsConfig: unknown }[],
  env: Record<string, string | undefined> = {},
): ModelConfigImportDraft[] {
  const drafts: ModelConfigImportDraft[] = [];
  for (const row of rows) {
    const appType = row.appType.trim().toLowerCase();
    let parsed: ModelConfigImportDraft[] = [];
    if (appType === "claude" || appType === "claude-desktop") {
      parsed = parseClaudeCodeModelConfig(row.settingsConfig, undefined, env);
      if (parsed.length === 0) {
        // A cc-switch claude entry with a URL/key but no explicit model still
        // describes a usable provider; import it under a generic model id.
        const envMap = stringMap(asRecord(row.settingsConfig)?.env);
        const baseUrl = firstString(envMap.ANTHROPIC_BASE_URL, envMap.ANTHROPIC_API_URL);
        const secret = resolveSecret(firstString(envMap.ANTHROPIC_API_KEY, envMap.ANTHROPIC_AUTH_TOKEN), env);
        if (baseUrl || secret) {
          parsed = [{
            source: "claude-code",
            externalId: "default",
            name: "Claude Code",
            baseUrl: baseUrl ?? null,
            api: API_ANTHROPIC,
            ...(secret ? { apiKey: secret } : {}),
            models: [{ id: "default" }],
            hasKey: Boolean(secret),
          }];
        }
      }
    } else if (appType === "codex") {
      const settings = asRecord(row.settingsConfig) ?? {};
      const toml = typeof settings.config === "string" ? settings.config : "";
      if (toml) parsed = parseCodexModelConfig(toml, env);
    } else if (appType === "pi") {
      // Pi's authoritative config is ~/.pi/agent/models.json; the cc-switch row
      // is a stale migration snapshot, so let the pi scanner own it.
      continue;
    }
    for (const draft of parsed) {
      drafts.push({
        ...draft,
        source: "cc-switch",
        externalId: `${row.appType}:${row.id}`,
        name: clampName(row.name || draft.name),
      });
    }
  }
  return drafts;
}

// ── scan (fs boundary) ────────────────────────────────────────────────────────

export interface ScanOptions {
  home?: string;
  env?: Record<string, string | undefined>;
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Scan every supported source under `home` and return secret-free candidates. */
export function scanModelConfigSources(options: ScanOptions = {}): ModelConfigImportDraft[] {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;

  const claude = parseClaudeCodeModelConfig(
    readJson(join(home, ".claude", "settings.json")),
    readJson(join(home, ".claude", "settings.local.json")),
    env,
  );

  const codexToml = readText(join(home, ".codex", "config.toml"));
  const codex = codexToml ? parseCodexModelConfig(codexToml, env) : [];

  const opencodeDir = join(home, ".config", "opencode");
  const opencodeConfig =
    readJson(join(opencodeDir, "opencode.json")) ?? readJson(join(opencodeDir, "opencode.jsonc"));
  const opencodeAuth =
    readJson(join(home, ".local", "share", "opencode", "auth.json")) ?? readJson(join(opencodeDir, "auth.json"));
  const opencode = parseOpenCodeModelConfig(opencodeConfig, opencodeAuth, env);

  const ccSwitchRows = parseCcSwitchConfigJson(readJson(join(home, ".cc-switch", "config.json")));
  const ccSwitch = parseCcSwitchProviders(ccSwitchRows, env);

  const pi =
    parsePiModelConfig(readJson(join(home, ".pi", "agent", "models.json")), env);

  // cc-switch first (its rows are user-curated), then the native configs it
  // mirrors; drop any native draft cc-switch already covers by name+baseUrl.
  const covered = new Set(ccSwitch.map((d) => `${d.name}::${d.baseUrl ?? ""}`));
  const native = [...claude, ...opencode, ...codex, ...pi].filter(
    (draft) => !covered.has(`${draft.name}::${draft.baseUrl ?? ""}`),
  );
  return [...ccSwitch, ...native];
}

/** Apply the chosen drafts onto an existing models.json config object. */
export function applyModelConfigImports(
  config: { providers?: Record<string, Record<string, unknown>> },
  drafts: ModelConfigImportDraft[],
): { config: { providers: Record<string, Record<string, unknown>> }; imported: number; skipped: number } {
  const providers: Record<string, Record<string, unknown>> = { ...(config.providers ?? {}) };
  let imported = 0;
  let skipped = 0;

  for (const draft of drafts) {
    let name = draft.name || draft.externalId;
    const existing = providers[name];
    if (existing) {
      const sameEndpoint =
        (existing.baseUrl ?? null) === draft.baseUrl && (existing.api ?? API_CHAT) === draft.api;
      if (!sameEndpoint) {
        // Different provider under the same name: uniquify instead of clobbering.
        let n = 2;
        while (providers[`${name}-${n}`]) n += 1;
        name = `${name}-${n}`;
      } else {
        const existingIds = new Set(modelIdsFromUnknown(existing.models));
        const additions = draft.models.filter((m) => !existingIds.has(m.id));
        if (additions.length === 0) { skipped += 1; continue; }
        providers[name] = {
          ...existing,
          models: [...(Array.isArray(existing.models) ? existing.models : []), ...additions],
        };
        imported += 1;
        continue;
      }
    }
    const entry: Record<string, unknown> = { api: draft.api };
    if (draft.baseUrl) entry.baseUrl = draft.baseUrl;
    if (draft.apiKey && !isShellCommandSecret(draft.apiKey)) entry.apiKey = draft.apiKey;
    if (draft.headers && Object.keys(draft.headers).length) entry.headers = draft.headers;
    if (draft.models.length) entry.models = draft.models;
    providers[name] = entry;
    imported += 1;
  }

  return { config: { providers }, imported, skipped };
}
