"use client";

/**
 * The provider setup sheet: pick a service, paste a key, watch the models
 * arrive, choose which ones to keep.
 *
 * WHY one screen instead of a wizard: the model list is the point of the form,
 * and every step of a wizard hides the evidence that the endpoint actually
 * answered. Keeping the name, the endpoint, the key and the discovered list on
 * one scrollable sheet means a wrong base URL is visible next to the empty list
 * it produced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useProviderModels } from "@/hooks/useProviderModels";
import type { ModelsFetchErrorKind } from "@/lib/model-fetch-error";
import { apiStyleLabel, resolveEndpointDraft } from "@/lib/provider-api-style";
import type { NamedEndpointPreset, PresetApi } from "@/lib/provider-presets";
import { primaryModelId } from "./model-config-utils";
import { ModelSelectionPanes } from "./ModelSelectionPanes";
import { canRecommendFrom, recommendModelIds } from "@/lib/recommended-models";

export interface ProviderSetupEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: { id: string; name?: string }[];
}

export interface ProviderSetupSaveInput {
  name: string;
  api: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: { id: string; name?: string }[];
}

export interface ProviderSetupSheetProps {
  open: boolean;
  onClose: () => void;
  /** null = 新建；否则是编辑既有自定义 provider */
  editing: { name: string; provider: ProviderSetupEntry } | null;
  preset: NamedEndpointPreset | null;
  existingProviderNames: string[];
  onSave: (input: ProviderSetupSaveInput) => void;
  onRequestCustom: () => void;
}

const API_CHOICES: readonly PresetApi[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
];

/** Probe phases and error kinds, mapped to the copy that already exists. */
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

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-ui-xs)",
  fontWeight: 500,
  color: "var(--ds-text-secondary)",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 9px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--ds-bg-secondary)",
  color: "var(--ds-text-primary)",
  fontSize: "var(--text-ui-sm)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const hintStyle: React.CSSProperties = {
  fontSize: "var(--text-ui-xs)",
  color: "var(--ds-text-muted)",
  lineHeight: 1.4,
};

/** A slug for the provider key, derived from the preset name or its id. */
function presetSlug(preset: NamedEndpointPreset | null): string {
  if (!preset) return "";
  const base = (preset.id || preset.name).trim().toLocaleLowerCase();
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * `name` with the smallest numeric suffix that no configured provider claims.
 *
 * Picking a preset whose id already exists in models.json is an ordinary case
 * (adding a second endpoint for a vendor, or re-adding one after a manual
 * edit). Showing the collision as a red error the moment the sheet opens makes
 * the form look broken before the user has done anything, so a fresh entry
 * starts from a free name and keeps the red line for a name the user typed.
 */
function uniqueProviderName(base: string, taken: readonly string[]): string {
  const root = base.trim() || "provider";
  if (!taken.includes(root)) return root;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/** The path part of an endpoint, shown read-only next to a fixed preset. */
function endpointSummary(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return baseUrl;
  }
}

/**
 * Password field with a show/hide toggle.
 * WHY duplicated instead of importing the one in ModelsConfig: that one is a
 * module-private function, and reaching into the file would mean exporting a
 * helper from a 2500-line component for four lines of markup.
 */
function SecretField({
  value,
  onChange,
  placeholder,
  autoComplete = "off",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        style={{ ...inputStyle, paddingRight: 32, fontFamily: "var(--font-mono)" }}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        title={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        style={{
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--ds-text-muted)",
          cursor: "pointer",
        }}
      >
        {visible ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
      </button>
    </div>
  );
}

export function ProviderSetupSheet({
  open,
  onClose,
  editing,
  preset,
  existingProviderNames,
  onSave,
  onRequestCustom,
}: ProviderSetupSheetProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState<string>(API_CHOICES[0]);
  const [apiTouched, setApiTouched] = useState(false);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [testState, setTestState] = useState<{ phase: "idle" | "testing" | "ok" | "error"; message?: string }>({ phase: "idle" });
  /** Which provider + endpoint the automatic preselection already ran for. */
  const preselectedKeyRef = useRef<string | null>(null);
  const [recommended, setRecommended] = useState(false);

  useEscapeKey(open, onClose);

  const editingProvider = editing?.provider ?? null;
  // A preset fixes the endpoint (it is the reason the user picked that card);
  // a brand-new custom entry is the only form where the field is editable.
  const lockedEndpoint = Boolean(preset);

  /** Stable key for the taken-name list, so the seeding effect can depend on it. */
  const takenKey = useMemo(() => existingProviderNames.join("\u0000"), [existingProviderNames]);

  // A fresh sheet: preset values win for a new provider, the stored entry wins
  // for an edit. Both are reset whenever `open` flips, so a cancelled form
  // cannot leak into the next one.
  useEffect(() => {
    if (!open) return;
    const storedApi = editingProvider?.api ?? "";
    const nextBaseUrl = editingProvider?.baseUrl ?? preset?.baseUrl ?? "";
    const nextApi = storedApi || preset?.api || API_CHOICES[0];
    const seeded = editing?.name ?? uniqueProviderName(presetSlug(preset), existingProviderNames);
    seededNameRef.current = seeded;
    setName(seeded);
    setBaseUrl(nextBaseUrl);
    setApiKey("");
    setApi(nextApi);
    setApiTouched(Boolean(storedApi) || Boolean(preset));
    // Opening for an edit starts from the models models.json already has, so
    // the sheet never shows an empty right pane for a provider that has models.
    setModels((editingProvider?.models ?? []).map((model) => (model.name ? { id: model.id, name: model.name } : { id: model.id })));
    setTestState({ phase: "idle" });
    preselectedKeyRef.current = null;
    setRecommended(false);
    // `editingProvider?.models` is deliberately absent: the stored list is read
    // once at open, and re-running this on a config re-render would wipe what
    // the user has typed into the sheet. `takenKey` stands in for the taken-name
    // array so the seeded default stays collision-free.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.name, editingProvider?.api, editingProvider?.baseUrl, preset, takenKey]);

  /** The name the sheet opened with, so `duplicateName` can tell typed from seeded. */
  const seededNameRef = useRef("");

  const savedModels = useMemo(
    () => editingProvider?.models ?? [],
    [editingProvider],
  );

  const discovery = useProviderModels(
    open,
    { providerName: name, baseUrl, apiKey, api, headers: editingProvider?.headers },
    savedModels,
  );

  // Preselect once per provider + endpoint. A ref, not state, because this is
  // an effect that must not re-run when it writes the list it reads.
  useEffect(() => {
    if (!open || !canRecommendFrom(discovery)) return;
    if (models.length > 0) return;
    const key = `${name}|${baseUrl}`;
    if (preselectedKeyRef.current === key) return;
    preselectedKeyRef.current = key;
    const recommendation = recommendModelIds({ models: discovery.models });
    if (recommendation.reason === "empty" || recommendation.ids.length === 0) return;
    const byId = new Map(discovery.models.map((model) => [model.id, model]));
    setModels(recommendation.ids.map((id) => {
      const found = byId.get(id);
      return found?.name ? { id, name: found.name } : { id };
    }));
    setRecommended(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, discovery.status, discovery.source, discovery.models.length, name, baseUrl]);

  const draft = resolveEndpointDraft({
    baseUrl,
    current: api,
    // A preset knows its dialect and a stored entry already has one: only a
    // custom endpoint may be auto-detected, and only until the user picks.
    locked: Boolean(preset) || Boolean(editingProvider?.api) || apiTouched,
  });

  const effectiveApi = draft.api;
  const autoDetected = draft.autoDetected;

  const trimmedName = name.trim();
  // Only a name the user typed can collide: the seeded default is already
  // collision-free (see `uniqueProviderName`), so pinning the red line to
  // "changed since open" keeps a fresh sheet free of errors.
  const nameTouched = name !== seededNameRef.current;
  const duplicateName = !editing && nameTouched && trimmedName !== "" && existingProviderNames.includes(trimmedName);
  const baseUrlMissing = !baseUrl.trim() && !preset;
  const canSave = trimmedName !== "" && !duplicateName && !baseUrlMissing;

  const runTest = useCallback(async () => {
    const modelId = primaryModelId(models);
    if (!modelId) return;
    setTestState({ phase: "testing" });
    try {
      const provider: Record<string, unknown> = { api: effectiveApi };
      if (baseUrl.trim()) provider.baseUrl = baseUrl.trim();
      if (apiKey.trim()) provider.apiKey = apiKey.trim();
      if (editingProvider?.headers) provider.headers = editingProvider.headers;
      const response = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: trimmedName, provider, model: { id: modelId } }),
      });
      const data = await response.json() as { ok?: boolean; status?: number; latencyMs?: number; error?: string };
      if (!response.ok || !data.ok) {
        setTestState({ phase: "error", message: data.error ?? `HTTP ${response.status}` });
        return;
      }
      const parts = [t("desktop.modelsOk")];
      if (typeof data.status === "number") parts.push(`HTTP ${data.status}`);
      if (typeof data.latencyMs === "number") parts.push(`${data.latencyMs} ms`);
      setTestState({ phase: "ok", message: parts.join(" · ") });
    } catch (error) {
      setTestState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [apiKey, baseUrl, editingProvider, effectiveApi, models, t, trimmedName]);

  const submit = () => {
    if (!canSave) return;
    onSave({
      name: trimmedName,
      api: effectiveApi,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(editingProvider?.headers ? { headers: editingProvider.headers } : {}),
      models,
    });
  };

  const probeLine = (() => {
    if (discovery.status === "loading") return { text: t("desktop.modelsProbeLoading"), tone: "muted" as const };
    if (discovery.status === "error") {
      const key = discovery.errorKind ? PROBE_ERROR_KEYS[discovery.errorKind] : "desktop.modelsProbeErrorUpstream";
      return { text: t(key), tone: "error" as const };
    }
    if (discovery.status === "ready" && discovery.source === "saved") {
      return { text: t("desktop.modelsProbeFromSaved"), tone: "muted" as const };
    }
    if (discovery.status === "ready") {
      return { text: t("desktop.modelsProbeReady", { count: discovery.models.length }), tone: "muted" as const };
    }
    return { text: t("desktop.modelsProbeIdle"), tone: "muted" as const };
  })();

  if (!open) return null;

  const title = editing ? t("desktop.modelsSetupSaveProvider") : (preset?.name ?? t("desktop.modelsAddProvider"));
  const subtitle = preset ? endpointSummary(preset.baseUrl) : (baseUrl.trim() || t("desktop.modelsServiceCustomEndpoint"));

  return (
    <div className="settings-sheet-overlay" data-settings-child-dialog="true">
      <div className="settings-sheet" role="dialog" aria-label={title}>
        <div className="settings-sheet-head">
          <div className="settings-sheet-head-copy">
            <span className="settings-sheet-title">{title}</span>
            <span className="settings-sheet-sub">{subtitle}</span>
          </div>
          <button
            type="button"
            className="settings-sheet-close"
            onClick={onClose}
            aria-label={t("desktop.modelsClose")}
            title={t("desktop.modelsClose")}
          >
            ×
          </button>
        </div>

        <div className="settings-sheet-body">
          <label style={fieldStyle}>
            <span style={labelStyle}>{t("desktop.modelsProviderName")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              readOnly={Boolean(editing)}
              placeholder="provider-name"
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", opacity: editing ? 0.7 : 1 }}
            />
            {duplicateName && (
              <span style={{ ...hintStyle, color: "var(--status-error)" }}>{t("desktop.modelsProviderName")} · {trimmedName}</span>
            )}
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>{t("desktop.modelsBaseUrl")}</span>
            <input
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setApiTouched(false);
              }}
              readOnly={lockedEndpoint}
              placeholder="https://api.example.com/v1"
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", opacity: lockedEndpoint ? 0.7 : 1 }}
            />
            {baseUrlMissing && (
              <span style={{ ...hintStyle, color: "var(--status-error)" }}>{t("desktop.modelsSetupBaseUrlRequired")}</span>
            )}
          </label>

          {!preset && (
            <button
              type="button"
              onClick={onRequestCustom}
              style={{ alignSelf: "flex-start", padding: 0, border: "none", background: "none", color: "var(--ds-accent)", cursor: "pointer", fontSize: "var(--text-ui-xs)" }}
            >
              {t("desktop.modelsServiceCustomEndpoint")}
            </button>
          )}

          <label style={fieldStyle}>
            <span style={labelStyle}>{t("desktop.modelsApiKey")}</span>
            <SecretField
              value={apiKey}
              onChange={setApiKey}
              placeholder={t("desktop.modelsApiKeyPlaceholder")}
            />
            <span style={hintStyle}>{t("desktop.modelsApiKeyHelp")}</span>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>{t("desktop.modelsApi")}</span>
            <select
              value={effectiveApi}
              onChange={(event) => {
                setApi(event.target.value);
                setApiTouched(true);
              }}
              style={inputStyle}
            >
              {API_CHOICES.map((choice) => (
                <option key={choice} value={choice}>{apiStyleLabel(choice)}</option>
              ))}
            </select>
            {autoDetected && (
              <span style={hintStyle}>{t("desktop.modelsApiStyleAutoDetected", { format: apiStyleLabel(effectiveApi) })}</span>
            )}
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{ ...hintStyle, color: probeLine.tone === "error" ? "var(--status-error)" : "var(--ds-text-muted)", flex: 1, minWidth: 0 }}>
              {probeLine.text}
            </span>
            <button
              type="button"
              onClick={discovery.reload}
              disabled={!discovery.canReload || discovery.status === "loading"}
              style={{
                height: 26,
                padding: "0 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--ds-bg-secondary)",
                color: discovery.canReload ? "var(--ds-text-secondary)" : "var(--ds-text-muted)",
                cursor: discovery.canReload ? "pointer" : "not-allowed",
                fontSize: "var(--text-ui-xs)",
                flexShrink: 0,
              }}
            >
              {t("desktop.modelsDiscoverReload")}
            </button>
          </div>

          {discovery.error && discovery.status === "error" && (
            <div style={{ padding: "6px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--ds-bg-secondary)", color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
              {discovery.error}
            </div>
          )}

          <ModelSelectionPanes
            discovered={discovery.models}
            models={models}
            onModelsChange={setModels}
            defaultModelId={primaryModelId(models)}
            discoveryStatus={discovery.status}
          />

          {recommended && (
            <span style={hintStyle}>{t("desktop.modelsRecommendedHint")}</span>
          )}
        </div>

        <div className="settings-sheet-foot">
          <span className="settings-sheet-foot-status" style={{ color: testState.phase === "error" ? "var(--status-error)" : "var(--ds-text-muted)" }}>
            {testState.phase === "testing"
              ? t("desktop.modelsTesting")
              : testState.message ?? ""}
          </span>
          <div className="settings-sheet-foot-actions">
            <button
              type="button"
              onClick={() => { void runTest(); }}
              disabled={testState.phase === "testing" || !primaryModelId(models)}
              style={{
                height: 30,
                padding: "0 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--ds-bg-secondary)",
                color: primaryModelId(models) ? "var(--ds-text-secondary)" : "var(--ds-text-muted)",
                cursor: primaryModelId(models) ? "pointer" : "not-allowed",
                fontSize: "var(--text-ui-xs)",
              }}
            >
              {t("desktop.modelsSetupTest")}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 30,
                padding: "0 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "none",
                color: "var(--ds-text-secondary)",
                cursor: "pointer",
                fontSize: "var(--text-ui-xs)",
              }}
            >
              {t("desktop.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              style={{
                height: 30,
                padding: "0 14px",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: canSave ? "var(--ds-accent)" : "var(--ds-bg-secondary)",
                color: canSave ? "var(--accent-fg)" : "var(--ds-text-muted)",
                cursor: canSave ? "pointer" : "not-allowed",
                fontSize: "var(--text-ui-xs)",
                fontWeight: 600,
              }}
            >
              {t("desktop.modelsSetupSaveProvider")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
