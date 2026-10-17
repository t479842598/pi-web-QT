"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CheckIcon,
  CpuIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon } from "@/components/ProviderIcon";
import { TitleModelSetting } from "@/components/TitleModelSetting";
import { DefaultModelRow } from "@/components/model-config/DefaultModelRow";
import { ServiceChooser } from "@/components/model-config/ServiceChooser";
import { ProviderSetupSheet, type ProviderSetupSaveInput } from "@/components/model-config/ProviderSetupSheet";
import { ModelSelectionPanes } from "@/components/model-config/ModelSelectionPanes";
import { syncSlotsAfterReorder } from "@/components/model-config/model-config-utils";
import { useProviderModels } from "@/hooks/useProviderModels";
import type { NamedEndpointPreset } from "@/lib/provider-presets";
import { BuiltinModelsDetail } from "@/components/BuiltinModelsDetail";
import { ProviderUsageSummary } from "@/components/ProviderUsageSummary";
import { ApplyNowButton } from "./ApplyNowButton";
import { ModelConfigImportPanel } from "./ModelConfigImportPanel";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { ModelsFetchErrorKind } from "@/lib/model-fetch-error";
import {
  savedModelIds,
  trackAddedModels,
  collectModelRenames,
} from "./models-config-helpers";
import {
  EnabledModelsBanner,
  EnabledModelsProviderSwitch,
  EnabledModelsSection,
  useEnabledModels,
  type EnabledModelsController,
} from "./EnabledModelsSection";
import { providerBadgeLabel } from "./enabled-models-helpers";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  supportsOAuth?: boolean;
}

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

type BuiltinFlush = () => Promise<void>;
type RegisterBuiltinFlush = (providerId: string, flush: BuiltinFlush) => (() => void) | void;
type BuiltinProviderChange = (provider: Record<string, unknown> | null) => void;
type RegisterModelsFlush = (flush: BuiltinFlush) => (() => void) | void;

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "mistral-conversations"] as const;
/** Probe failure kinds → the copy the panel already carries for each one. */
const PROBE_ERROR_KEYS: Record<ModelsFetchErrorKind, string> = {
  unauthorized: "desktop.modelsProbeErrorUnauthorized",
  forbidden: "desktop.modelsProbeErrorForbidden",
  notFound: "desktop.modelsProbeErrorNotFound",
  rateLimited: "desktop.modelsProbeErrorRateLimited",
  upstream: "desktop.modelsProbeErrorUpstream",
  timeout: "desktop.modelsProbeErrorTimeout",
  network: "desktop.modelsProbeErrorNetwork",
  invalidResponse: "desktop.modelsProbeErrorInvalidResponse",
  unknown: "desktop.modelsProbeErrorUpstream",
};
const CUSTOM_CALL_FORMAT = "__custom__";

function customSelectionExists(config: ModelsJson, selection: Selection): boolean {
  if (selection.type === "provider") return Boolean(config.providers?.[selection.name]);
  if (selection.type !== "model") return true;
  return Boolean(config.providers?.[selection.providerName]?.models?.[selection.index]);
}

function useModelTranslation() {
  const { t } = useI18n();
  return useCallback(
    (key: string, values?: Record<string, string | number>) => t(key, values),
    [t],
  );
}

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-content-field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "6px 9px",
  background: "var(--ds-bg-secondary)",
  borderRadius: 'var(--radius-sm)',
  color: "var(--ds-text-primary)",
  fontSize: 'var(--text-ui-sm)',
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

function TextInput({ value, onChange, placeholder, mono, inputRef }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  return <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "inherit" }} />;
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const t = useModelTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        title={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--ds-text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  const t = useModelTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--ds-text-primary)" : "var(--ds-text-muted)" }}>
      {!required && <option value="">{t("desktop.modelsInheritNone")}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--ds-accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="settings-content-section-title" style={{ fontSize: 'var(--text-ui-xs)', fontWeight: 600, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({ name, provider, onChange, onRename, onDelete, onAddModel, onModelsChange, onOpenSetup, enabledModels }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModel: () => void;
  /** The pane owns selection and order; slots move with it in the parent. */
  onModelsChange: (models: { id: string; name?: string }[]) => void;
  /** Re-opens the setup sheet for this provider (endpoint, key, full catalog). */
  onOpenSetup: () => void;
  enabledModels: EnabledModelsController;
}) {
  const t = useModelTranslation();
  const [editingName, setEditingName] = useState(name);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  const models = provider.models ?? [];
  // The same probe the setup sheet runs: this pane is where a provider that
  // already exists in models.json gains the rest of its catalog.
  //
  // The stored list is passed as a *snapshot* keyed on the provider name, not
  // as the live draft. The hook derives its request key from those ids, so
  // passing the draft would fire a fresh upstream /models request on every
  // checkbox and every drag. The snapshot only has to say "this provider has
  // models, so models.json holds a credential the route can resolve".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedHint = useMemo(() => (provider.models ?? []).map((model) => ({ id: model.id })), [name]);
  const discovery = useProviderModels(
    true,
    {
      providerName: name,
      baseUrl: provider.baseUrl ?? "",
      apiKey: provider.apiKey ?? "",
      api: provider.api ?? "openai-completions",
      headers: provider.headers,
    },
    savedHint,
  );

  const probeLine = (() => {
    if (discovery.status === "loading") return { text: t("desktop.modelsProbeLoading"), isError: false };
    if (discovery.status === "error") {
      const key = discovery.errorKind ? PROBE_ERROR_KEYS[discovery.errorKind] : "desktop.modelsProbeErrorUpstream";
      return { text: t(key), isError: true };
    }
    if (discovery.status === "ready" && discovery.source === "saved") {
      return { text: t("desktop.modelsProbeFromSaved"), isError: false };
    }
    if (discovery.status === "ready") {
      return { text: t("desktop.modelsProbeReady", { count: discovery.models.length }), isError: false };
    }
    return { text: t("desktop.modelsProbeIdle"), isError: false };
  })();

  return (
    <div className="settings-content-detail-stack" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsProvider")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <EnabledModelsProviderSwitch providerId={name} controller={enabledModels} />
          <button onClick={onDelete}
            style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 'var(--radius-xs)', color: "var(--status-error)", cursor: "pointer", fontSize: 'var(--text-ui-xs)' }}>
            {t("desktop.delete")}
          </button>
        </div>
      </div>

      <Field label={t("desktop.modelsProviderName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--ds-accent)", border: "none", borderRadius: 'var(--radius-xs)', color: "var(--accent-fg)", cursor: "pointer", fontSize: 'var(--text-ui-xs)', alignSelf: "flex-start" }}>
            {t("desktop.rename")}
          </button>
        )}
      </Field>

      <Field label={t("desktop.modelsBaseUrl")}>
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="http(s)://host:port/v1" mono />
      </Field>

      <Field label={t("desktop.modelsApiKey")}>
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder={t("desktop.modelsApiKeyPlaceholder")} mono />
        <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>
          {t("desktop.modelsApiKeyHelp")}
        </span>
      </Field>

      <Field label={t("desktop.modelsApi")}>
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <div style={{ paddingTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 0, color: probeLine.isError ? "var(--status-error)" : "var(--ds-text-muted)", fontSize: 'var(--text-ui-xs)' }}>
            {probeLine.text}
          </span>
          <button
            onClick={onOpenSetup}
            title={t("desktop.modelsDiscoveryFetch")}
            style={{ height: 28, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', background: "var(--ds-bg-secondary)", color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 'var(--text-ui-xs)' }}
          >
            {t("desktop.modelsDiscoveryFetch")}
          </button>
          <button
            onClick={onAddModel}
            title={t("desktop.modelsAddModelManual")}
            style={{ height: 28, padding: "0 11px", border: "none", borderRadius: 'var(--radius-sm)', background: "var(--ds-accent)", color: "var(--accent-fg)", cursor: "pointer", fontSize: 'var(--text-ui-xs)', fontWeight: 600 }}
          >
            {t("desktop.modelsAddModelManual")}
          </button>
        </div>

        {discovery.error && discovery.status === "error" && (
          <div style={{ padding: "7px 9px", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 'var(--radius-sm)', color: "var(--status-error)", fontSize: 'var(--text-ui-xs)', lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {discovery.error}
          </div>
        )}

        <ModelSelectionPanes
          discovered={discovery.models}
          models={models}
          onModelsChange={onModelsChange}
          defaultModelId={models[0]?.id}
          discoveryStatus={discovery.status}
        />
      </div>
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--ds-text-muted)",
  minimal: "var(--ds-text-secondary)",
  low:     "#60a5fa",
  medium:  "#a78bfa",
  high:    "#f472b6",
  xhigh:   "#fb923c",
  max:     "var(--status-error)",
};

export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const t = useModelTranslation();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: 'var(--text-ui-xs)',
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--ds-bg-secondary)",
          color: "var(--ds-text-muted)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--ds-accent)",
          color: "var(--accent-fg)",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "var(--status-error)",
          color: "var(--accent-fg)",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: 'var(--radius-sm)',
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            {/* Level badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: 'var(--text-ui-xs)',
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--ds-text-muted)" : "var(--ds-text-secondary)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            {/* Default + Disabled buttons */}
            <div style={{ display: "flex", borderRadius: 'var(--radius-sm)', border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                {t("desktop.modelsDefault")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{ ...btnBase, borderLeft: "1px solid var(--border)", ...(state === "null" ? btnActiveDisabled : {}) }}
              >
                {t("desktop.modelsDisabled")}
              </button>
            </div>

            {/* Custom button + input fused */}
            <div style={{ display: "flex", borderRadius: 'var(--radius-sm)', border: `1px solid ${state === "string" ? "var(--ds-accent)" : "var(--ds-border-default)"}`, overflow: "hidden", transition: "border-color 0.1s" }}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{ ...btnBase, ...(state === "string" ? btnActive : {}), borderRight: "1px solid var(--border)", flexShrink: 0 }}
              >
                {t("desktop.modelsCustom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--ds-bg-secondary)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--ds-text-primary)" : "var(--ds-text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 'var(--text-ui-xs)',
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let costChanged = false;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        costChanged = true;
        appliedCount += 1;
      }
    }
    if (costChanged) next.cost = cost;
  }
  return { model: next, appliedCount };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const t = useModelTranslation();
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("desktop.modelsTestingConnection");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("desktop.modelsConnected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return [t("desktop.modelsFailed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (!query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (provider.baseUrl?.trim()) params.set("baseUrl", provider.baseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, model, onChange, provider.baseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("desktop.modelsCatalogFilled", { count: appliedCount })
      : t("desktop.modelsCatalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("desktop.modelsCatalogNoExactMatch")
        : t("desktop.modelsCatalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("desktop.modelsCatalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("desktop.modelsCatalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("desktop.modelsCatalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;
  const catalogStatusColor = catalogState.phase === "error"
    ? "var(--status-error)"
    : catalogState.phase === "success" && catalogState.recommendation.price.status === "unreliable"
      ? "var(--status-warning)"
      : "var(--ds-text-muted)";

  return (
    <div className="settings-content-detail-stack" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsModelSection")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 28,
                padding: "0 8px",
                border: `1px solid ${
                  testState.phase === "error" ? "var(--status-error-border)"
                  : testState.phase === "success" ? "var(--status-success-border)"
                  : "var(--ds-border-default)"
                }`,
                borderRadius: 'var(--radius-xs)',
                background: testState.phase === "error" ? "var(--status-error-bg)"
                  : testState.phase === "success" ? "var(--status-success-bg)"
                  : "var(--ds-bg-hover)",
                color: testState.phase === "error" ? "var(--status-error)"
                  : testState.phase === "success" ? "var(--status-success)"
                  : "var(--ds-text-primary)",
                fontSize: 'var(--text-ui-xs)',
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={testState.phase === "success" ? () => setTestState({ phase: "idle" }) : handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title={t("desktop.modelsTestConnection")}
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "var(--status-success)" : "none",
              border: `1px solid ${testState.phase === "success" ? "var(--status-success)" : "var(--ds-border-default)"}`,
              borderRadius: 'var(--radius-xs)',
              color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--ds-text-muted)" : "var(--ds-text-secondary)",
              cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
              fontSize: 'var(--text-ui-xs)',
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && <CheckIcon size={11} />}
            {testState.phase === "testing" ? t("desktop.modelsTesting") : testState.phase === "success" ? t("desktop.modelsOk") : t("desktop.modelsTest")}
          </button>
          <button onClick={onDelete}
            style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 'var(--radius-xs)', color: "var(--status-error)", cursor: "pointer", fontSize: 'var(--text-ui-xs)', boxSizing: "border-box" }}>
            {t("desktop.modelsRemove")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("desktop.modelsIdRequired")}><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
        <Field label={t("desktop.modelsName")}><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("desktop.modelsDisplayName")} /></Field>
      </div>

      <div style={{ padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => void handleCatalogFill()}
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            style={{
              height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)',
              background: "var(--ds-bg-secondary)",
              color: !model.id.trim() || catalogState.phase === "loading" ? "var(--ds-text-muted)" : "var(--ds-text-secondary)",
              cursor: !model.id.trim() || catalogState.phase === "loading" ? "not-allowed" : "pointer",
              fontSize: 'var(--text-ui-xs)',
            }}
          >
            {catalogState.phase === "loading" ? t("desktop.modelsCatalogFilling") : t("desktop.modelsCatalogFill")}
          </button>
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto", color: "var(--ds-text-muted)", fontSize: 'var(--text-ui-xs)', textDecoration: "none" }}
          >
            {t("desktop.modelsCatalogSource")}
          </a>
        </div>

        <div
          aria-live="polite"
          style={{
            marginTop: 6, height: 20, display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 8, color: catalogStatusColor, fontSize: 'var(--text-ui-xs)',
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {catalogStatusText}
          </span>
          {catalogState.phase === "success" && catalogUndoRef.current && (
            <button
              onClick={undoCatalogFill}
              style={{ background: "none", border: "none", color: "var(--ds-accent)", cursor: "pointer", fontSize: 'var(--text-ui-xs)', flexShrink: 0 }}
            >
              {t("desktop.modelsCatalogUndo")}
            </button>
          )}
        </div>
      </div>

      <Field label={t("desktop.modelsApiOverride")}>
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label={t("desktop.modelsReasoningThinking")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label={t("desktop.modelsImageInput")} checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check
            label={t("desktop.modelsDeepSeekCompat")}
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionTitle>{t("desktop.modelsThinkingLevelMap")}</SectionTitle>
              {model.thinkingLevelMap && (
                <button
                  onClick={() => set("thinkingLevelMap", undefined)}
                  style={{ fontSize: 'var(--text-ui-xs)', padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 'var(--radius-xs)', color: "var(--ds-text-muted)", cursor: "pointer" }}
                >
                  {t("desktop.modelsClearAll")}
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor
              value={model.thinkingLevelMap}
              onChange={(v) => set("thinkingLevelMap", v)}
            />
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("desktop.modelsContextWindow")}>
          <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
        </Field>
        <Field label={t("desktop.modelsMaxOutputTokens")}>
          <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
        </Field>
      </div>

      <div>
        <SectionTitle>{t("desktop.modelsCostPerMillionTokens")}</SectionTitle>
        <div className="models-cost-grid" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={k}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({
  provider,
  onRefresh,
  onRegisterBuiltinFlush,
  onBuiltinProviderChange,
  enabledModels,
}: {
  provider: OAuthProvider;
  onRefresh: () => void;
  onRegisterBuiltinFlush?: RegisterBuiltinFlush;
  onBuiltinProviderChange?: BuiltinProviderChange;
  enabledModels: EnabledModelsController;
}) {
  const t = useModelTranslation();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: t("desktop.modelsConnectionLost") });
    };
  }, [provider.id, onRefresh, t]);

  const handleLogout = useCallback(async () => {
    try {
      const res = await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setLoginState({
          phase: "error",
          message: res.status === 409
            ? t("desktop.modelsAuthenticationStateChanged")
            : (data?.error ?? `HTTP ${res.status}`),
        });
      } else {
        setLoginState({ phase: "idle" });
      }
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      onRefresh();
    }
  }, [provider.id, onRefresh, t]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: t("desktop.modelsVerifying") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("desktop.modelsServerError", { status: res.status }) });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("desktop.modelsNetworkError") });
    }
  }, [provider.id, t]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: t("desktop.modelsContinuing") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("desktop.modelsServerError", { status: res.status }) });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("desktop.modelsNetworkError") });
    }
  }, [provider.id, t]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsSubscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "var(--status-success)" : "var(--ds-border-default)", display: "inline-block" }} />
          <span style={{ fontSize: 'var(--text-ui-xs)', color: provider.loggedIn ? "var(--status-success)" : "var(--ds-text-muted)" }}>
            {provider.loggedIn ? t("desktop.modelsConnected") : t("desktop.modelsNotConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: provider.loggedIn && loginState.phase === "idle" ? 0 : 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
            {provider.loggedIn ? t("desktop.modelsAlreadyConnected") : t("desktop.modelsConnectAccount", { provider: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>{t("desktop.modelsOpeningBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-primary)", cursor: "pointer", fontSize: 'var(--text-ui-sm)', textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? t("desktop.modelsCompleteSignIn")
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", lineHeight: 1.5 }}>
                {t("desktop.modelsBrowserDidNotOpen")}{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ds-accent)", wordBreak: "break-all" }}>
                  {t("desktop.modelsOpenLoginPage")}
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("desktop.modelsEnterValue"))}
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-primary)", fontSize: 'var(--text-ui-sm)', outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--ds-accent)" : "var(--ds-bg-secondary)", border: "none", borderRadius: 'var(--radius-sm)', color: inputValue.trim() ? "var(--accent-contrast)" : "var(--ds-text-muted)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: 'var(--text-ui-sm)', fontWeight: 600, flexShrink: 0 }}
              >
                {t("desktop.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
              {t("desktop.modelsOpenVerificationPage")}
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-primary)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ds-accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` ${t("desktop.modelsExpiresInMinutes", { count: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--status-success)" }}>{t("desktop.modelsConnectedSuccessfully")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--status-error)" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 'var(--text-ui-sm)' }}
          >
            {t("desktop.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{ padding: "5px 14px", background: "var(--ds-accent)", border: "none", borderRadius: 'var(--radius-sm)', color: "var(--accent-fg)", cursor: "pointer", fontSize: 'var(--text-ui-sm)', fontWeight: 600 }}
            >
              {provider.loggedIn ? t("desktop.modelsReLogin") : t("desktop.modelsLogin")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 'var(--radius-sm)', color: "var(--status-error)", cursor: "pointer", fontSize: 'var(--text-ui-sm)' }}
              >
                {t("desktop.modelsDisconnect")}
              </button>
            )}
          </>
        )}
      </div>

      <ProviderUsageSummary providerId={provider.id} enabled={provider.loggedIn} />

      <BuiltinModelsDetail
        providerId={provider.id}
        onRegisterFlush={onRegisterBuiltinFlush}
        onConfigChange={onBuiltinProviderChange}
      />

      {provider.loggedIn && <EnabledModelsSection providerId={provider.id} controller={enabledModels} />}
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({
  provider,
  onRefresh,
  onRegisterBuiltinFlush,
  onBuiltinProviderChange,
  enabledModels,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
  onRegisterBuiltinFlush?: RegisterBuiltinFlush;
  onBuiltinProviderChange?: BuiltinProviderChange;
  enabledModels: EnabledModelsController;
}) {
  const t = useModelTranslation();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(res.status === 409
          ? t("desktop.modelsAuthenticationStateChanged")
          : (d.error ?? `HTTP ${res.status}`));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      onRefresh();
      setRemoving(false);
    }
  }, [provider.id, onRefresh, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsApiKey")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "var(--status-success)" : "var(--ds-border-default)", display: "inline-block" }} />
          <span style={{ fontSize: 'var(--text-ui-xs)', color: provider.configured ? "var(--status-success)" : "var(--ds-text-muted)" }}>
            {provider.configured ? t("desktop.modelsConfigured") : t("desktop.modelsNotConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
        {provider.configured
          ? t("desktop.modelsApiKeyStored")
          : t("desktop.modelsEnableModels", {
            provider: provider.displayName,
            count: provider.modelCount,
            models: provider.modelCount === 1 ? t("desktop.modelsSingular") : t("desktop.modelsPlural"),
          })}
      </p>

      <Field label={t("desktop.modelsApiKey")}>
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? t("desktop.modelsEnterNewKey") : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "var(--status-success)" : apiKey.trim() ? "var(--ds-accent)" : "var(--ds-bg-secondary)",
              border: "none", borderRadius: 'var(--radius-sm)',
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--ds-text-muted)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: 'var(--text-ui-sm)', fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && <CheckIcon size={12} />}
            {savedOk ? t("desktop.modelsSaved") : saving ? t("desktop.modelsSaving") : t("desktop.modelsSave")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 'var(--text-ui-sm)', color: "var(--status-error)" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 'var(--radius-sm)', color: "var(--status-error)",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 'var(--text-ui-sm)',
          }}
        >
          {removing ? t("desktop.modelsRemoving") : t("desktop.modelsDisconnect")}
        </button>
      )}

      <ProviderUsageSummary providerId={provider.id} enabled={provider.configured} />

      <BuiltinModelsDetail
        providerId={provider.id}
        onRegisterFlush={onRegisterBuiltinFlush}
        onConfigChange={onBuiltinProviderChange}
      />

      {provider.configured && <EnabledModelsSection providerId={provider.id} controller={enabledModels} />}
    </div>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const t = useModelTranslation();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(true, onClose);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--ds-bg-secondary)",
    borderRadius: 'var(--radius-md)',
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };



  return (
    <div data-settings-child-dialog="true"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-md-plus)', display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Search */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <MagnifyingGlassIcon size={13} style={{ color: "var(--ds-text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("desktop.modelsSearchProviders")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ds-text-primary)", fontSize: 'var(--text-ui-base)', boxSizing: "border-box" }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-muted)", textAlign: "center" }}>{t("desktop.modelsNoProvidersMatch")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {showCustom && (
                <div style={{ gridColumn: "1 / -1", fontSize: 'var(--text-ui-xs)', fontWeight: 600, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsCustom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--ds-accent)"; e.currentTarget.style.background = "var(--ds-bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ds-border-default)"; e.currentTarget.style.background = "var(--ds-bg-secondary)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-primary)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("desktop.modelsCompatibleProvider")}</div>
                    <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>{t("desktop.modelsCustomEndpointFormat")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', background: "var(--ds-bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <PlusIcon size={13} style={{ color: "var(--ds-text-muted)" }} />
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: showCustom ? 6 : 0, fontSize: 'var(--text-ui-xs)', fontWeight: 600, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsSubscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--ds-accent)"; e.currentTarget.style.background = "var(--ds-bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ds-border-default)"; e.currentTarget.style.background = "var(--ds-bg-secondary)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-primary)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 'var(--text-ui-xs)', fontWeight: 600, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsApiKey")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--ds-accent)"; e.currentTarget.style.background = "var(--ds-bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ds-border-default)"; e.currentTarget.style.background = "var(--ds-bg-secondary)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-primary)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>{t("desktop.modelsCount", { count: p.modelCount })}</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add custom provider dialog ────────────────────────────────────────────────

interface CustomProviderSubmit {
  name: string;
  api: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model?: { id: string; contextWindow?: number; maxTokens?: number };
}

function CustomProviderDialog({
  existingProviders,
  onCancel,
  onSubmit,
}: {
  existingProviders: { name: string; provider: ProviderEntry }[];
  onCancel: () => void;
  onSubmit: (input: CustomProviderSubmit) => void;
}) {
  const t = useModelTranslation();
  const [name, setName] = useState("");
  const [api, setApi] = useState<string>(API_OPTIONS[0]);
  const [apiSel, setApiSel] = useState<string>(API_OPTIONS[0]);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);

  useEscapeKey(true, onCancel);
  const [urlOpen, setUrlOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [importValue, setImportValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => nameInputRef.current?.focus(), 30); }, []);

  const urlValid = !baseUrl.trim() || /^https?:\/\//i.test(baseUrl.trim());

  const handleImport = (value: string) => {
    setImportValue(value);
    const entry = existingProviders.find((p) => p.name === value);
    if (!entry) return;
    if (entry.provider.api) { setApi(entry.provider.api); setApiSel(entry.provider.api); }
    setBaseUrl(entry.provider.baseUrl ?? "");
    setApiKey(entry.provider.apiKey ?? "");
    setHeaders(entry.provider.headers ? { ...entry.provider.headers } : undefined);
  };

  const handleSubmit = () => {
    const model = modelId.trim()
      ? {
          id: modelId.trim(),
          ...(parseInt(contextWindow, 10) > 0 ? { contextWindow: parseInt(contextWindow, 10) } : {}),
          ...(parseInt(maxTokens, 10) > 0 ? { maxTokens: parseInt(maxTokens, 10) } : {}),
        }
      : undefined;
    onSubmit({
      name: name.trim(),
      api,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(headers ? { headers } : {}),
      model,
    });
  };

  return (
    <div data-settings-child-dialog="true"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "min(82vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-md-plus)', display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-ui-base)', fontWeight: 700, color: "var(--ds-text-primary)" }}>{t("desktop.modelsAddCustomTitle")}</span>
          <button onClick={onCancel} aria-label={t("desktop.modelsClose")} title={t("desktop.modelsClose")} style={{ background: "none", border: "none", color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label={t("desktop.modelsProviderNameOptional")}>
            <TextInput value={name} onChange={setName} placeholder="new-provider" mono inputRef={nameInputRef} />
          </Field>

          {/* Call format — import & select */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SectionTitle>{t("desktop.modelsCallFormat")}</SectionTitle>
            <select
              value={apiSel}
              onChange={(e) => {
                const v = e.target.value;
                setApiSel(v);
                if (v === CUSTOM_CALL_FORMAT) { setUrlOpen(true); return; }
                setApi(v);
              }}
              style={inputStyle}
            >
              {API_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              <option value={CUSTOM_CALL_FORMAT}>{t("desktop.modelsCustomCallFormat")}</option>
            </select>
            <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)" }}>{t("desktop.modelsCallFormatHelp")}</span>
            {apiSel === CUSTOM_CALL_FORMAT && (
              <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--status-warning)", lineHeight: 1.4 }}>{t("desktop.modelsCustomCallFormatHelp")}</span>
            )}
          </div>

          {/* Import from existing provider */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SectionTitle>{t("desktop.modelsImportProvider")}</SectionTitle>
            <select value={importValue} onChange={(e) => handleImport(e.target.value)}
              style={{ ...inputStyle, color: importValue ? "var(--ds-text-primary)" : "var(--ds-text-muted)" }}>
              <option value="">{t("desktop.modelsImportProviderPlaceholder")}</option>
              {existingProviders.map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.provider.api ? ` · ${p.provider.api}` : ""}</option>
              ))}
            </select>
            {importValue && (
              <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--status-success)" }}>{t("desktop.modelsImported")}: {importValue}</span>
            )}
          </div>

          {/* URL — click + to input a full URL */}
          <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <SectionTitle>{t("desktop.modelsFullUrl")}</SectionTitle>
            {!urlOpen ? (
              <button onClick={() => setUrlOpen(true)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 'var(--text-ui-sm)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--ds-accent)"; e.currentTarget.style.color = "var(--ds-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ds-border-default)"; e.currentTarget.style.color = "var(--ds-text-secondary)"; }}
              >
                <PlusIcon size={12} />
                {t("desktop.modelsAddUrl")}
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <TextInput value={baseUrl} onChange={setBaseUrl} placeholder={t("desktop.modelsUrlPlaceholder")} mono />
                <button onClick={() => { setUrlOpen(false); setBaseUrl(""); }}
                  title={t("desktop.modelsRemove")}
                  style={{ flexShrink: 0, width: 28, height: 28, background: "none", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-muted)", cursor: "pointer", fontSize: 'var(--text-ui-base)', lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              </div>
            )}
            {baseUrl.trim() && !urlValid && <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--status-error)" }}>{t("desktop.modelsUrlInvalid")}</span>}

            <Field label={t("desktop.modelsApiKey")}>
              <SecretTextInput value={apiKey} onChange={setApiKey} placeholder={t("desktop.modelsApiKeyPlaceholder")} mono />
              <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>
                {t("desktop.modelsApiKeyHelp")}
              </span>
            </Field>
          </div>

          {/* Custom request — model ID + context length + output length */}
          <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionTitle>{t("desktop.modelsCustomRequest")}</SectionTitle>
            <Field label={t("desktop.modelsRequestModelId")}>
              <TextInput value={modelId} onChange={setModelId} placeholder="model-id" mono />
              <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", marginTop: 2 }}>{t("desktop.modelsRequestModelIdHelp")}</span>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label={t("desktop.modelsRequestContextLength")}>
                <NumInput value={contextWindow} onChange={setContextWindow} placeholder="128000" />
              </Field>
              <Field label={t("desktop.modelsRequestOutputLength")}>
                <NumInput value={maxTokens} onChange={setMaxTokens} placeholder="16384" />
              </Field>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button onClick={onCancel} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 'var(--text-ui-base)' }}>
            {t("desktop.cancel")}
          </button>
          <button onClick={handleSubmit} disabled={!urlValid}
            style={{ padding: "6px 16px", background: urlValid ? "var(--ds-accent)" : "var(--ds-bg-secondary)", border: "none", borderRadius: 'var(--radius-sm)', color: urlValid ? "#fff" : "var(--ds-text-muted)", cursor: urlValid ? "pointer" : "not-allowed", fontSize: 'var(--text-ui-base)', fontWeight: 600 }}>
            {t("desktop.modelsAdd")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({
  embedded = false,
  sessionId,
  cwd = null,
  onCloseAction,
  onSavedAction,
  onRegisterFlush,
}: {
  embedded?: boolean;
  sessionId?: string | null;
  cwd?: string | null;
  onCloseAction?: () => void;
  onSavedAction?: () => void;
  onRegisterFlush?: RegisterModelsFlush;
}) {
  const t = useModelTranslation();
  const isMobile = useIsMobile();
  // `enabledModels` lives in pi's settings, not models.json, so these switches
  // apply immediately instead of waiting for this panel's Save button.
  const enabledModels = useEnabledModels(cwd);
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** Service chooser: the entry point for adding a provider. */
  const [chooserOpen, setChooserOpen] = useState(false);
  /** Setup sheet for a preset endpoint, or an edit of an existing provider. */
  const [setupSheet, setSetupSheet] = useState<{ preset: NamedEndpointPreset | null; editingName: string | null } | null>(null);
  const configRef = useRef<ModelsJson>({ providers: {} });
  const builtinFlushesRef = useRef<Map<string, BuiltinFlush>>(new Map());
  const configVersionRef = useRef(0);
  const selectionBusyRef = useRef(false);
  configRef.current = config;
  /** Provider ids as models.json has them on disk, and where renames moved them. */
  const savedProvidersRef = useRef<Set<string>>(new Set());
  const renamesRef = useRef<Map<string, string>>(new Map());
  /**
   * Per provider, the model id saved at each slot, or null for a model added
   * since. Mirroring the draft's array moves is what lets a save tell a rename
   * from an unrelated edit without guessing.
   */
  const savedModelIdsRef = useRef<Map<string, (string | null)[]>>(new Map());

  const updateConfigState = useCallback((updater: (previous: ModelsJson) => ModelsJson) => {
    const next = updater(configRef.current);
    configRef.current = next;
    configVersionRef.current += 1;
    setConfig(next);
    return next;
  }, []);

  const refreshAuthenticationProviders = useCallback(() => {
    fetch("/api/auth/combined")
      .then((r) => r.json())
      .then((d: { oauth?: OAuthProvider[]; apiKey?: ApiKeyProvider[] }) => {
        setOauthProviders(d.oauth ?? []);
        setApiKeyProviders(d.apiKey ?? []);
      })
      .catch(() => {});
  }, []);

  const registerBuiltinFlush = useCallback<RegisterBuiltinFlush>((providerId, flush) => {
    builtinFlushesRef.current.set(providerId, flush);
    return () => {
      if (builtinFlushesRef.current.get(providerId) === flush) {
        builtinFlushesRef.current.delete(providerId);
      }
    };
  }, []);

  const flushBuiltinModels = useCallback(async () => {
    const flushes = [...builtinFlushesRef.current.values()];
    for (const flush of flushes) await flush();
  }, []);

  useEffect(() => {
    if (!onRegisterFlush) return undefined;
    return onRegisterFlush(flushBuiltinModels) ?? undefined;
  }, [flushBuiltinModels, onRegisterFlush]);

  const updateBuiltinProvider = useCallback((providerId: string, provider: Record<string, unknown> | null) => {
    updateConfigState((previous) => {
      const providers = { ...(previous.providers ?? {}) };
      if (provider) providers[providerId] = provider as ProviderEntry;
      else delete providers[providerId];
      return { ...previous, providers };
    });
    onSavedAction?.();
  }, [onSavedAction, updateConfigState]);

  const selectSelection = useCallback(async (nextSelection: Selection) => {
    if (selectionBusyRef.current) return;
    selectionBusyRef.current = true;
    setSaveError(null);
    try {
      await flushBuiltinModels();
      setSelection(nextSelection);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      selectionBusyRef.current = false;
    }
  }, [flushBuiltinModels]);

  const reloadConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/models-config", { cache: "no-store" });
      const d = await r.json() as ModelsJson & { error?: string };
      // 422 = models.json exists but is unusable. The panel must show the
      // error and keep saving disabled: the draft would not contain the
      // file's providers, and a save replaces the whole file (upstream v0.9.3).
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      const normalized = d.providers ? d : { ...d, providers: {} };
      configRef.current = normalized;
      configVersionRef.current += 1;
      setConfig(normalized);
      savedProvidersRef.current = new Set(Object.keys(normalized.providers ?? {}));
      savedModelIdsRef.current = savedModelIds(normalized);
      setSelection((current) => current && customSelectionExists(normalized, current)
        ? current
        : null);
      setSaveError(null);
    } catch (error) {
      const empty = { providers: {} };
      configRef.current = empty;
      configVersionRef.current += 1;
      setConfig(empty);
      // Surface why the file could not be shown; saving stays possible only
      // for a genuinely absent file (empty object), not for a broken one.
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadConfig();
    refreshAuthenticationProviders();
  }, [refreshAuthenticationProviders, reloadConfig]);

  /**
   * Inserts a provider under a name that is not taken yet.
   * WHY shared: the setup sheet and the custom-provider dialog must produce the
   * same `name`, `name-1`, `name-2` sequence, or the two paths disagree about
   * what "the provider I just added" is called.
   */
  const insertProvider = useCallback((baseName: string, entry: ProviderEntry): string => {
    let finalName = baseName;
    let n = 1;
    while (configRef.current.providers?.[finalName]) finalName = `${baseName}-${n++}`;
    updateConfigState((previous) => ({
      ...previous,
      providers: { ...(previous.providers ?? {}), [finalName]: entry },
    }));
    return finalName;
  }, [updateConfigState]);

  const createCustomProvider = useCallback(async (input: CustomProviderSubmit) => {
    if (selectionBusyRef.current) return;
    selectionBusyRef.current = true;
    setSaveError(null);
    try {
      await flushBuiltinModels();
      const entry: ProviderEntry = {
        api: input.api || "openai-completions",
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.model ? { models: [input.model] } : {}),
      };
      const finalName = insertProvider(input.name.trim() || "new-provider", entry);
      setSelection({ type: "provider", name: finalName });
      setCustomDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      selectionBusyRef.current = false;
    }
  }, [flushBuiltinModels, insertProvider]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    updateConfigState((previous) => ({ ...previous, providers: { ...(previous.providers ?? {}), [name]: p } }));
  }, [updateConfigState]);

  /**
   * Saves the setup sheet. A new provider gets the discovered list as its
   * models; an edit replaces the existing entry's models and keeps everything
   * the sheet does not own (headers, compat, modelOverrides).
   */
  const saveProviderSetup = useCallback((input: ProviderSetupSaveInput) => {
    const models = input.models.map((model) => (model.name ? { id: model.id, name: model.name } : { id: model.id }));
    const entry: ProviderEntry = {
      api: input.api,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(models.length > 0 ? { models } : {}),
    };
    const editingName = setupSheet?.editingName ?? null;
    if (editingName) {
      const existing = configRef.current.providers?.[editingName] ?? {};
      updateProvider(editingName, { ...existing, ...entry });
      setSetupSheet(null);
      setSelection({ type: "provider", name: editingName });
      return;
    }
    const finalName = insertProvider(input.name.trim() || "new-provider", entry);
    trackAddedModels(savedModelIdsRef.current, finalName, models.length);
    setSetupSheet(null);
    setSelection({ type: "provider", name: finalName });
  }, [insertProvider, setupSheet, updateProvider]);


  const renameProvider = useCallback((oldName: string, newName: string) => {
    // Remember where each saved provider ended up, so the enabledModels entries
    // can follow it on save instead of pointing at an id that no longer exists.
    const renames = renamesRef.current;
    let original = oldName;
    for (const [from, to] of renames) {
      if (to !== oldName) continue;
      original = from;
      break;
    }
    if (original === newName) renames.delete(original);
    else if (savedProvidersRef.current.has(original)) renames.set(original, newName);
    const slots = savedModelIdsRef.current.get(oldName);
    if (slots) {
      savedModelIdsRef.current.delete(oldName);
      savedModelIdsRef.current.set(newName, slots);
    }
    updateConfigState((previous) => {
      const entries = Object.entries(previous.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return previous;
      entries[idx] = [newName, entries[idx][1]];
      return { ...previous, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, [updateConfigState]);

  const deleteProvider = useCallback((name: string) => {
    savedModelIdsRef.current.delete(name);
    const next = updateConfigState((previous) => {
      const providers = { ...(previous.providers ?? {}) };
      delete providers[name];
      return { ...previous, providers };
    });
    const remaining = Object.keys(next.providers ?? {});
    setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
  }, [updateConfigState]);

  const addModel = useCallback(async (providerName: string) => {
    if (selectionBusyRef.current) return;
    selectionBusyRef.current = true;
    setSaveError(null);
    try {
      await flushBuiltinModels();
      trackAddedModels(savedModelIdsRef.current, providerName, 1);
      const next = updateConfigState((previous) => {
        const provider = previous.providers?.[providerName] ?? {};
        const models = [...(provider.models ?? []), { id: "" }];
        return { ...previous, providers: { ...(previous.providers ?? {}), [providerName]: { ...provider, models } } };
      });
      const index = (next.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      selectionBusyRef.current = false;
    }
  }, [flushBuiltinModels, updateConfigState]);

  /**
   * Replaces a provider's whole model list from the selection panes.
   *
   * The saved-slot map has to move with it: `collectModelRenames()` compares a
   * slot with the model that now sits in it, so a reorder without a slot move
   * reads as N renames (`a→c`, `b→a`, `c→b`) and `enabledModels.resync()`
   * rewrites entries the user never touched. A slot holds the id saved at that
   * position, so handing the new order to `syncSlotsAfterReorder()` re-points
   * every surviving slot at its model's new index and leaves a model added
   * since the last save at `null` — which is exactly what a deletion and an
   * addition already look like to `collectModelRenames()`.
   */
  const replaceProviderModels = useCallback((providerName: string, next: { id: string; name?: string }[]) => {
    const nextIds = next.map((model) => model.id).filter((id) => id.trim() !== "");
    const previousSlots = savedModelIdsRef.current.get(providerName);
    // The draft's own ids, positionally against the slots: a model renamed in
    // the detail editor still owns its slot under the old spelling, and this is
    // what keeps that rename from collapsing into "unsaved" on the next drag.
    const previousIds = (configRef.current.providers?.[providerName]?.models ?? []).map((model) => model.id);
    if (previousSlots) {
      savedModelIdsRef.current.set(
        providerName,
        syncSlotsAfterReorder(previousSlots, nextIds, previousIds) ?? [],
      );
    } else if (nextIds.length > 0) {
      // A provider created since the last save has no saved slots at all.
      trackAddedModels(savedModelIdsRef.current, providerName, nextIds.length);
    }

    updateConfigState((previous) => {
      const provider = previous.providers?.[providerName] ?? {};
      return {
        ...previous,
        providers: {
          ...(previous.providers ?? {}),
          [providerName]: {
            ...provider,
            models: next.length > 0
              ? next.map((model) => (model.name ? { id: model.id, name: model.name } : { id: model.id }))
              : undefined,
          },
        },
      };
    });
  }, [updateConfigState]);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    updateConfigState((previous) => {
      const provider = previous.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...previous, providers: { ...(previous.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, [updateConfigState]);

  const removeModel = useCallback(async (providerName: string, index: number) => {
    if (selectionBusyRef.current) return;
    selectionBusyRef.current = true;
    setSaveError(null);
    try {
      await flushBuiltinModels();
      savedModelIdsRef.current.get(providerName)?.splice(index, 1);
      updateConfigState((previous) => {
        const provider = previous.providers?.[providerName] ?? {};
        const models = [...(provider.models ?? [])];
        models.splice(index, 1);
        return { ...previous, providers: { ...(previous.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
      });
      setSelection({ type: "provider", name: providerName });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      selectionBusyRef.current = false;
    }
  }, [flushBuiltinModels, updateConfigState]);
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      await flushBuiltinModels();
      const snapshot = configRef.current;
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const data = await res.json() as { success?: boolean; error?: string; config?: ModelsJson };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.config) {
        configRef.current = data.config;
        configVersionRef.current += 1;
        setConfig(data.config);
      }
      setSavedOk(true);
      onSavedAction?.();
      setTimeout(() => setSavedOk(false), 2000);
      // models.json just changed under the switches: providers may have been
      // renamed, models added, deleted or renamed. Re-verify the stored
      // patterns against the new catalog and re-read.
      const renames = [...renamesRef.current].map(([from, to]) => ({ from, to }));
      const modelRenames = collectModelRenames(configRef.current, savedModelIdsRef.current, renamesRef.current);
      savedProvidersRef.current = new Set(Object.keys(configRef.current.providers ?? {}));
      savedModelIdsRef.current = savedModelIds(configRef.current);
      renamesRef.current.clear();
      enabledModels.resync(renames, modelRenames);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [flushBuiltinModels, onSavedAction, saving, enabledModels]);

  const requestClose = useCallback(async () => {
    try {
      await flushBuiltinModels();
      onCloseAction?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [flushBuiltinModels, onCloseAction]);

  // Escape closes the standalone dialog; the embedded variant lives inside
  // SettingsModal, which owns its own close affordances.
  useEscapeKey(!embedded && Boolean(onCloseAction), () => { void requestClose(); });

  const providers = Object.entries(config.providers ?? {});
  const builtinProviderIds = new Set([
    ...oauthProviders.map((provider) => provider.id),
    ...apiKeyProviders.map((provider) => provider.id),
  ]);
  // Custom providers not covered by the built-in/auth lists.
  const customProviders = providers.filter(([providerId]) =>
    !builtinProviderIds.has(providerId),
  );
  // `12/40` next to a provider makes a narrowed selector visible at a glance.
  const scopeBadge = (providerId: string) => {
    const label = providerBadgeLabel(enabledModels.view, providerId);
    return label ? <span className="models-sidebar-badge">{label}</span> : null;
  };
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const visibleApiKeyProviders = apiKeyProviders;
  const activeApiKey = visibleApiKeyProviders.filter((p) => p.configured);
  const providerCount = activeOAuth.length + activeApiKey.length + customProviders.length;

  // Catalog refresh mirrors the Models panel's own button: fetch remote
  // catalogs now, then reload this panel so any newly listed models appear.
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const refreshCatalog = useCallback(async () => {
    if (refreshingCatalog) return;
    setRefreshingCatalog(true);
    try {
      await fetch("/api/models/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await reloadConfig();
      refreshAuthenticationProviders();
    } catch {
      // A failed pass leaves the stored catalog in place; nothing to surface.
    } finally {
      setRefreshingCatalog(false);
    }
  }, [refreshingCatalog, reloadConfig, refreshAuthenticationProviders]);

  // The detail editor is opened by clicking a provider row (see the list
  // below). There is deliberately no "auto-select the first provider" effect:
  // the page is a single-column list and opening an editor on mount would
  // cover it with a modal the user never asked for.
  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <OAuthDetail
          key={p.id}
          provider={p}
          onRefresh={refreshAuthenticationProviders}
          onRegisterBuiltinFlush={registerBuiltinFlush}
          onBuiltinProviderChange={(provider) => updateBuiltinProvider(p.id, provider)}
          enabledModels={enabledModels}
        />
      );
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <ApiKeyDetail
          key={p.id}
          provider={p}
          onRefresh={refreshAuthenticationProviders}
          onRegisterBuiltinFlush={registerBuiltinFlush}
          onBuiltinProviderChange={(provider) => updateBuiltinProvider(p.id, provider)}
          enabledModels={enabledModels}
        />
      );
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onModelsChange={(next) => replaceProviderModels(selection.name, next)}
          onAddModel={() => { void addModel(selection.name); }}
          onOpenSetup={() => setSetupSheet({ preset: null, editingName: selection.name })}
          enabledModels={enabledModels}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => { void removeModel(selection.providerName, selection.index); }}
      />
    );
  })();

  return (
    <>
    <div
      className="settings-content-panel"
      style={embedded
        ? { display: "flex", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }
        : { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className={embedded ? "settings-content-surface" : "models-config-panel settings-content-surface"} style={embedded
        ? { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }
        : { width: isMobile ? "calc(100vw - 16px)" : 860, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "78vh", maxHeight: "calc(100dvh - 16px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-md-plus)', display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {!embedded && (
          <div className="settings-content-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ds-text-primary)" }}>{t("desktop.models")}</span>
              <code style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>
            </div>
            <button onClick={() => { void requestClose(); }} aria-label={t("desktop.modelsClose")} title={t("desktop.modelsClose")} style={{ background: "none", border: "none", color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        )}

        {/* Global title model setting */}
        <TitleModelSetting />

        {/* Global default model: what a brand-new session starts with. */}
        <DefaultModelRow cwd={cwd} onChangedAction={onSavedAction} />

        <EnabledModelsBanner controller={enabledModels} />

        {/* Body: single-column provider list (PI-Desktop model-page shape). */}
        <div
          className="settings-content-detail model-config-page"
          style={{ flex: 1, overflowY: "auto", padding: "var(--settings-content-detail-padding, 20px)", display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* ── Providers ── */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--text-ui-base)', fontWeight: 650, color: "var(--ds-text-primary)" }}>{t("desktop.modelsProvidersSection")}</span>
                {providerCount > 0 && <span className="models-sidebar-badge">{providerCount}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  className={`config-button config-button-small ${importOpen ? "config-button-primary" : "config-button-secondary"}`}
                  onClick={() => setImportOpen((v) => !v)}
                >
                  {t("desktop.modelImportEntry")}
                </button>
                <button
                  type="button"
                  className="config-button config-button-ghost config-button-small"
                  onClick={() => setPickerOpen(true)}
                  title={t("desktop.modelsSearchProviders")}
                >
                  {t("desktop.modelsSearchProviders")}
                </button>
                <button
                  type="button"
                  className="config-button config-button-primary config-button-small"
                  onClick={() => setChooserOpen(true)}
                >
                  {t("desktop.modelsAddProvider")}
                </button>
              </div>
            </div>

            {importOpen && (
              <ModelConfigImportPanel
                onImported={() => { void reloadConfig(); }}
                onClose={() => setImportOpen(false)}
              />
            )}

            <div className="settings-panel">
              {loading ? (
                <div className="settings-row" style={{ color: "var(--ds-text-secondary)", fontSize: 'var(--text-ui-sm)' }}>{t("desktop.modelsLoading")}</div>
              ) : providerCount === 0 ? (
                <div className="settings-row is-stacked" style={{ flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "32px 20px" }}>
                  <CpuIcon size={22} style={{ color: "var(--ds-text-muted)" }} />
                  <div>
                    <div className="settings-row-title">{t("desktop.modelsNoProviders")}</div>
                    <div className="settings-row-description">{t("desktop.modelsNoProvidersDesc")}</div>
                  </div>
                  <button type="button" className="config-button config-button-primary config-button-small" onClick={() => setChooserOpen(true)}>
                    {t("desktop.modelsAddProvider")}
                  </button>
                </div>
              ) : (
                <>
                  {activeOAuth.map((p) => (
                    <button
                      key={`oauth-${p.id}`}
                      type="button"
                      className="settings-row is-hoverable"
                      style={{ textAlign: "left", cursor: "pointer", font: "inherit" }}
                      onClick={() => { void selectSelection({ type: "oauth", providerId: p.id }); }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                        <ProviderIcon id={p.id} size={20} />
                        <span className="settings-row-copy">
                          <span className="settings-row-title">{p.name}</span>
                          <span className="settings-row-description">OAuth · {p.loggedIn ? t("desktop.modelsConnected") : t("desktop.modelsNotConnected")}</span>
                        </span>
                      </span>
                      {scopeBadge(p.id)}
                      <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", flexShrink: 0 }}>{t("desktop.modelsManage")} ›</span>
                    </button>
                  ))}

                  {activeApiKey.map((p) => (
                    <button
                      key={`apikey-${p.id}`}
                      type="button"
                      className="settings-row is-hoverable"
                      style={{ textAlign: "left", cursor: "pointer", font: "inherit" }}
                      onClick={() => { void selectSelection({ type: "apikey", providerId: p.id }); }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                        <ProviderIcon id={p.id} size={20} />
                        <span className="settings-row-copy">
                          <span className="settings-row-title">{p.displayName}</span>
                          <span className="settings-row-description">{t("desktop.modelsCount", { count: p.modelCount })} · {p.configured ? t("desktop.modelsConfigured") : t("desktop.modelsNotConfigured")}</span>
                        </span>
                      </span>
                      {scopeBadge(p.id)}
                      <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", flexShrink: 0 }}>{t("desktop.modelsManage")} ›</span>
                    </button>
                  ))}

                  {customProviders.map(([pName, pData]) => {
                    const models = pData.models ?? [];
                    return (
                      <div key={pName} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button
                          type="button"
                          className="settings-row is-hoverable"
                          style={{ textAlign: "left", cursor: "pointer", font: "inherit" }}
                          onClick={() => { void selectSelection({ type: "provider", name: pName }); }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                            <CpuIcon size={18} style={{ color: "var(--ds-text-muted)", flexShrink: 0 }} />
                            <span className="settings-row-copy">
                              <span className="settings-row-title" style={{ fontFamily: "var(--font-mono)" }}>{pName}</span>
                              <span className="settings-row-description">{pData.api ?? "openai-completions"} · {models.length} {t("desktop.modelsPlural")}</span>
                            </span>
                          </span>
                          {scopeBadge(pName)}
                          <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", flexShrink: 0 }}>{t("desktop.modelsManage")} ›</span>
                        </button>

                        {models.map((m, i) => (
                          <button
                            key={`${pName}-${i}`}
                            type="button"
                            className="settings-row is-hoverable"
                            style={{ textAlign: "left", cursor: "pointer", font: "inherit", marginLeft: 18, padding: "7px 14px", background: "var(--ds-tile-deep)" }}
                            onClick={() => { void selectSelection({ type: "model", providerName: pName, index: i }); }}
                          >
                            <span className="settings-row-copy">
                              <span style={{ fontSize: 'var(--text-ui-sm)', fontFamily: "var(--font-mono)", color: m.id ? "var(--ds-text-secondary)" : "var(--ds-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {m.id || t("desktop.modelsNewModel")}
                              </span>
                            </span>
                            {m.reasoning && (
                              <span style={{ fontSize: 'var(--text-ui-xs)', padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 'var(--radius-xs)', flexShrink: 0 }}>T</span>
                            )}
                          </button>
                        ))}

                        <button
                          type="button"
                          className="settings-row is-hoverable"
                          style={{ textAlign: "left", cursor: "pointer", font: "inherit", marginLeft: 18, padding: "6px 14px", background: "transparent", color: "var(--ds-text-muted)", fontSize: 'var(--text-ui-xs)' }}
                          onClick={() => { void addModel(pName); }}
                        >
                          {t("desktop.modelsAddModel")}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>

          {/* ── Catalog status ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <code style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ~/.pi/agent/models.json
            </code>
            <button
              type="button"
              className="config-button config-button-ghost config-button-small"
              onClick={() => { void refreshCatalog(); }}
              disabled={refreshingCatalog}
              style={{ flexShrink: 0 }}
            >
              {refreshingCatalog ? t("desktop.modelsCatalogRefreshing") : t("desktop.modelsCatalogRefresh")}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="settings-content-footer" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {saveError && <span style={{ fontSize: 'var(--text-ui-sm)', color: "var(--status-error)", flex: 1 }}>{saveError}</span>}
          {!embedded && (
            <button onClick={() => { void requestClose(); }} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 'var(--radius-sm)', color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 'var(--text-ui-base)' }}>
              {t("desktop.cancel")}
            </button>
          )}
          <ApplyNowButton sessionId={sessionId} onBeforeApply={handleSave} />
          <button onClick={handleSave} disabled={saving || savedOk} style={{
            position: "relative",
            padding: "6px 16px",
            minWidth: 92,
            background: savedOk ? "var(--status-success)" : saving ? "var(--ds-bg-secondary)" : "var(--ds-accent)",
            border: "none", borderRadius: 'var(--radius-sm)',
            color: savedOk ? "#fff" : saving ? "var(--ds-text-secondary)" : "#fff",
            cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 'var(--text-ui-base)', fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
            animation: savedOk ? "saved-pop 0.45s ease" : undefined,
          }}>
            {savedOk && (
              <CheckIcon
                size={14}
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}
              />
            )}
            <span>{savedOk ? t("desktop.modelsSaved") : saving ? t("desktop.modelsSaving") : t("desktop.modelsSave")}</span>
          </button>
        </div>
      </div>
    </div>
    {/* Detail opens as a modal, like PI-Desktop's provider setup sheet: the
        list stays single-column and the editor floats over it. */}
    {selection && detailContent && (
      <div
        data-settings-child-dialog="true"
        style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => setSelection(null)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: 620, maxWidth: "calc(100vw - 32px)", maxHeight: "min(84vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 'var(--radius-lg-plus)', display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.28)", overflow: "hidden" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setSelection(null)}
              aria-label={t("desktop.modelsClose")}
              style={{ background: "none", border: "none", color: "var(--ds-text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 8px" }}
            >
              ×
            </button>
          </div>
          <div style={{ overflowY: "auto", padding: "18px 20px" }}>
            {detailContent}
          </div>
        </div>
      </div>
    )}
    <ServiceChooser
      open={chooserOpen}
      onClose={() => setChooserOpen(false)}
      oauthProviders={oauthProviders}
      apiKeyProviders={visibleApiKeyProviders}
      onPickOAuth={(id) => {
        setChooserOpen(false);
        void selectSelection({ type: "oauth", providerId: id });
      }}
      onPickApiKey={(id) => {
        setChooserOpen(false);
        void selectSelection({ type: "apikey", providerId: id });
      }}
      onPickPreset={(preset) => {
        setChooserOpen(false);
        setSetupSheet({ preset, editingName: null });
      }}
      onPickCustom={() => {
        setChooserOpen(false);
        setCustomDialogOpen(true);
      }}
    />
    <ProviderSetupSheet
      open={setupSheet !== null}
      onClose={() => setSetupSheet(null)}
      editing={setupSheet?.editingName
        ? { name: setupSheet.editingName, provider: config.providers?.[setupSheet.editingName] ?? {} }
        : null}
      preset={setupSheet?.preset ?? null}
      existingProviderNames={Object.keys(config.providers ?? {})}
      onSave={saveProviderSetup}
      onRequestCustom={() => {
        setSetupSheet(null);
        setCustomDialogOpen(true);
      }}
    />
    {/* The old grid stays as the "search every provider" browser: the chooser
        covers presets and the two auth groups, while this one keeps the flat,
        unfiltered list (including already-configured providers) reachable. */}
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={visibleApiKeyProviders}
        onSelectOAuth={(id) => { void selectSelection({ type: "oauth", providerId: id }); }}
        onSelectApiKey={(id) => { void selectSelection({ type: "apikey", providerId: id }); }}
        onAddCustom={() => { setPickerOpen(false); setCustomDialogOpen(true); }}
        onClose={() => setPickerOpen(false)}
      />
    )}
    {customDialogOpen && (
      <CustomProviderDialog
        existingProviders={customProviders.map(([pName, pData]) => ({ name: pName, provider: pData }))}
        onCancel={() => setCustomDialogOpen(false)}
        onSubmit={(input) => { void createCustomProvider(input); }}
      />
    )}
    </>
  );
}
