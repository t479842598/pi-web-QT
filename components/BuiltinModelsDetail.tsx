"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ThinkingLevelMapEditor } from "./ModelsConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { DiscoveredModel } from "@/lib/model-discovery";
import { useI18n } from "@/hooks/useI18n";
import { buildOverridePatches, type OverrideDraft } from "@/lib/builtin-model-overrides";

interface BuiltinModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
}

interface BuiltinModelsResponse {
  provider: string;
  models: BuiltinModelInfo[];
  overrides: Record<string, Record<string, unknown>>;
  configured: boolean;
  error?: string;
}

interface Draft {
  name?: string;
  reasoning?: boolean;
  contextWindow?: string;
  maxTokens?: string;
  thinkingLevelMap?: Record<string, string | null>;
  hidden?: boolean;
}

type FlushAction = () => Promise<void>;
type RegisterFlush = (providerId: string, flush: FlushAction) => (() => void) | void;

function numOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toOverrideDraft(draft: Draft): OverrideDraft {
  const contextWindow = numOrUndefined(draft.contextWindow ?? "");
  const maxTokens = numOrUndefined(draft.maxTokens ?? "");
  const thinkingLevelMap = draft.thinkingLevelMap && Object.keys(draft.thinkingLevelMap).length > 0
    ? { ...draft.thinkingLevelMap }
    : undefined;
  return {
    ...(draft.name?.trim() ? { name: draft.name.trim() } : {}),
    ...(typeof draft.reasoning === "boolean" ? { reasoning: draft.reasoning } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(typeof draft.hidden === "boolean" ? { hidden: draft.hidden } : {}),
  };
}

/**
 * Model field editor for builtin (API-key/OAuth) providers. New edits are
 * persisted as field-level modelOverrides through the server PATCH API.
 */
export function BuiltinModelsDetail({
  providerId,
  onRegisterFlush,
  onConfigChange,
}: {
  providerId: string;
  onRegisterFlush?: RegisterFlush;
  onConfigChange?: (provider: Record<string, unknown> | null) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [models, setModels] = useState<BuiltinModelInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [initialDrafts, setInitialDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const draftsRef = useRef(drafts);
  const initialDraftsRef = useRef(initialDrafts);
  const modelsRef = useRef(models);
  const dirtyRef = useRef(dirty);
  const draftRevisionRef = useRef(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  draftsRef.current = drafts;
  initialDraftsRef.current = initialDrafts;
  modelsRef.current = models;
  dirtyRef.current = dirty;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const response = await fetch(`/api/models-config/builtin?provider=${encodeURIComponent(providerId)}`);
        const data: BuiltinModelsResponse = await response.json();
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (cancelled) return;

        const nextDrafts: Record<string, Draft> = {};
        for (const model of data.models) {
          const override = data.overrides[model.id] ?? {};
          nextDrafts[model.id] = {
            name: typeof override.name === "string" && override.name.length > 0 ? override.name : model.name,
            reasoning: typeof override.reasoning === "boolean" ? override.reasoning : model.reasoning,
            contextWindow: typeof override.contextWindow === "number"
              ? String(override.contextWindow)
              : model.contextWindow != null ? String(model.contextWindow) : "",
            maxTokens: typeof override.maxTokens === "number"
              ? String(override.maxTokens)
              : model.maxTokens != null ? String(model.maxTokens) : "",
            hidden: typeof override.hidden === "boolean" ? override.hidden : false,
            thinkingLevelMap: (override.thinkingLevelMap as Draft["thinkingLevelMap"]) ?? model.thinkingLevelMap,
          };
        }
        setModels(data.models);
        setDrafts(nextDrafts);
        setInitialDrafts(nextDrafts);
        setDirty(new Set());
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [providerId]);

  const patch = useCallback((id: string, change: Partial<Draft>) => {
    draftRevisionRef.current += 1;
    setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), ...change } }));
    setDirty((previous) => new Set(previous).add(id));
  }, []);

  const saveCurrent = useCallback(async (): Promise<void> => {
    const existingRequest = savePromiseRef.current;
    if (existingRequest) return existingRequest;

    const run = async () => {
      const currentDirty = new Set(dirtyRef.current);
      if (currentDirty.size === 0) return;
      const revisionAtStart = draftRevisionRef.current;
      const draftsAtSave = { ...draftsRef.current };

      const serializedDrafts: Record<string, OverrideDraft> = {};
      const serializedInitial: Record<string, OverrideDraft> = {};
      for (const model of modelsRef.current) {
        const current = draftsAtSave[model.id];
        const initial = initialDraftsRef.current[model.id];
        if (current) serializedDrafts[model.id] = toOverrideDraft(current);
        if (initial) serializedInitial[model.id] = toOverrideDraft(initial);
      }
      const patches = buildOverridePatches(currentDirty, serializedDrafts, serializedInitial);
      if (Object.keys(patches).length === 0) {
        setDirty(new Set());
        return;
      }

      setSaving(true);
      setError(null);
      setSavedOk(false);
      try {
        const response = await fetch("/api/models-config/builtin", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, patches }),
        });
        const data = await response.json() as {
          success?: boolean;
          error?: string;
          provider?: Record<string, unknown> | null;
        };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);

        onConfigChange?.(data.provider ?? null);
        const nextInitial = { ...initialDraftsRef.current };
        for (const id of currentDirty) {
          const current = draftsAtSave[id];
          if (current) nextInitial[id] = { ...current };
        }
        initialDraftsRef.current = nextInitial;
        setInitialDrafts(nextInitial);
        if (draftRevisionRef.current === revisionAtStart) {
          setDirty((previous) => new Set([...previous].filter((id) => !currentDirty.has(id))));
        }
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
        throw saveError;
      } finally {
        setSaving(false);
      }
    };

    const request = run();
    savePromiseRef.current = request;
    try {
      await request;
    } finally {
      if (savePromiseRef.current === request) savePromiseRef.current = null;
    }
  }, [onConfigChange, providerId]);

  useEffect(() => {
    if (!onRegisterFlush) return undefined;
    return onRegisterFlush(providerId, saveCurrent) ?? undefined;
  }, [onRegisterFlush, providerId, saveCurrent]);

  // ── 获取新模型（内置提供商，从上游 API 拉最新列表）──
  const [discovery, setDiscovery] = useState<
    { phase: "idle" | "loading" | "success" | "error"; models?: DiscoveredModel[]; newIds?: Set<string>; message?: string }
  >({ phase: "idle" });
  const [selectedNewIds, setSelectedNewIds] = useState<string[]>([]);

  const handleFetchModels = useCallback(async () => {
    setDiscovery({ phase: "loading" });
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: providerId, provider: {} }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; error?: string };
      if (!res.ok || data.error || !data.models) {
        setDiscovery({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const existingIds = new Set(modelsRef.current.map((m) => m.id));
      const newIds = new Set(data.models.filter((m) => !existingIds.has(m.id)).map((m) => m.id));
      setDiscovery({ phase: "success", models: data.models, newIds });
      setSelectedNewIds(data.models.filter((m) => newIds.has(m.id)).map((m) => m.id));
    } catch (e) {
      setDiscovery({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [providerId]);

  const handleAddModels = useCallback(async () => {
    if (!discovery.models?.length) return;
    setSaving(true);
    setError(null);
    try {
      // 写入完整上游模型列表（避免任何合并语义下丢模型），服务端按 {id,name?} 接受。
      const fullList = discovery.models.map((m) => ({ id: m.id, ...(m.name ? { name: m.name } : {}) }));
      const res = await fetch("/api/models-config/builtin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, models: fullList }),
      });
      const data = await res.json() as { success?: boolean; error?: string; provider?: Record<string, unknown> | null };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      onConfigChange?.(data.provider ?? null);
      setDiscovery({ phase: "idle" });
      setSelectedNewIds([]);
      // 重新加载模型列表
      const reload = await fetch(`/api/models-config/builtin?provider=${encodeURIComponent(providerId)}`);
      if (reload.ok) {
        const reloaded = await reload.json() as { models?: BuiltinModelInfo[]; overrides?: Record<string, unknown> };
        if (reloaded.models) {
          setModels(reloaded.models);
          modelsRef.current = reloaded.models;
          setDirty(new Set());
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [discovery.models, onConfigChange, providerId]);

  if (loading) {
    return (
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.modelsLoading")}</p>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
        {t("desktop.builtinModelsTitle")}
      </div>
      {/* 获取新模型：拉取上游最新模型列表，新增模型可勾选添加 */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => { void handleFetchModels(); }}
            disabled={discovery.phase === "loading"}
            style={{
              padding: "5px 12px",
              background: discovery.phase === "loading" ? "var(--bg-panel)" : "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: discovery.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
              cursor: discovery.phase === "loading" ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {discovery.phase === "loading" ? t("desktop.modelsDiscoveryFetching") : t("desktop.builtinModelsFetchNew")}
          </button>
          {discovery.phase === "success" && discovery.models && (
            <button
              type="button"
              onClick={() => { void handleAddModels(); }}
              disabled={saving || selectedNewIds.length === 0}
              style={{
                padding: "5px 12px",
                background: selectedNewIds.length > 0 && !saving ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 5,
                color: selectedNewIds.length > 0 && !saving ? "#fff" : "var(--text-dim)",
                cursor: selectedNewIds.length > 0 && !saving ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {saving ? t("desktop.modelsSaving") : `${t("desktop.modelsAddModelManual")} (${selectedNewIds.length})`}
            </button>
          )}
        </div>

        {discovery.phase === "error" && (
          <p style={{ margin: 0, fontSize: 11, color: "#f87171" }}>{discovery.message}</p>
        )}

        {discovery.phase === "success" && discovery.models && (
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
            {discovery.models.map((model) => {
              const isNew = discovery.newIds?.has(model.id) ?? false;
              const checked = selectedNewIds.includes(model.id);
              return (
                <label
                  key={model.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    minHeight: 32, padding: "5px 9px",
                    borderBottom: "1px solid var(--border)",
                    cursor: isNew ? "pointer" : "default",
                    opacity: isNew ? 1 : 0.55,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!isNew}
                    onChange={(e) => {
                      setSelectedNewIds((prev) => e.target.checked
                        ? [...prev, model.id]
                        : prev.filter((id) => id !== model.id));
                    }}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text)", fontWeight: isNew ? 600 : 400 }}>{model.name || model.id}</span>
                  <code style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{model.id}</code>
                  {isNew && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--accent)", color: "#fff", marginLeft: "auto" }}>
                      新
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {error && <p style={{ margin: 0, fontSize: 11, color: "#f87171" }}>{error}</p>}
      {models.length === 0 && !error && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.builtinModelsEmpty")}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {models.map((model) => {
          const draft = drafts[model.id] ?? {};
          const isOpen = expanded === model.id;
          const isDirty = dirty.has(model.id);
          return (
            <div key={model.id} style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : model.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text)", fontSize: 12, fontWeight: 600, padding: 0, textAlign: "left" }}
                >
                  {draft.name || model.name || model.id}
                  {isDirty && <span style={{ color: "var(--accent)", marginLeft: 6 }}>•</span>}
                </button>
                <code style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{model.id}</code>
                {(draft.reasoning ?? model.reasoning) && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--bg-selected)", color: "var(--text-muted)" }}>
                    reasoning
                  </span>
                )}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {t("desktop.builtinModelsContext")}: <b>{draft.contextWindow ? Number(draft.contextWindow).toLocaleString() : "—"}</b>
                  {" · "}
                  {t("desktop.builtinModelsMaxTokens")}: <b>{draft.maxTokens ? Number(draft.maxTokens).toLocaleString() : "—"}</b>
                </span>
              </div>

              {isOpen && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text)", width: "100%" }}>
                    {t("desktop.modelsName")}
                    <input
                      type="text"
                      value={draft.name ?? ""}
                      placeholder={model.name || model.id}
                      onChange={(e) => patch(model.id, { name: e.target.value.trim() || undefined })}
                      style={{ flex: 1, minWidth: 0, padding: "4px 7px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontFamily: "var(--font-mono)" }}
                    />
                    <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, color: draft.hidden ? "#f87171" : "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }}>
                      <input
                        type="checkbox"
                        checked={draft.hidden === true}
                        onChange={(e) => patch(model.id, { hidden: e.target.checked })}
                      />
                      {t("desktop.builtinModelsHide")}
                    </label>
                  </label>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text)", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={draft.reasoning === true}
                        onChange={(e) => patch(model.id, { reasoning: e.target.checked })}
                      />
                      {t("desktop.builtinModelsReasoning")}
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text)", flex: isMobile ? 1 : undefined, width: isMobile ? "100%" : undefined }}>
                      {t("desktop.modelsContextWindow")}
                      <input
                        type="number"
                        min={1}
                        value={draft.contextWindow ?? ""}
                        placeholder={model.contextWindow != null ? String(model.contextWindow) : ""}
                        onChange={(e) => patch(model.id, { contextWindow: e.target.value })}
                        style={{ flex: 1, minWidth: 0, padding: "4px 7px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontFamily: "var(--font-mono)" }}
                      />
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text)", flex: isMobile ? 1 : undefined, width: isMobile ? "100%" : undefined }}>
                      {t("desktop.modelsMaxOutputTokens")}
                      <input
                        type="number"
                        min={1}
                        value={draft.maxTokens ?? ""}
                        placeholder={model.maxTokens != null ? String(model.maxTokens) : ""}
                        onChange={(e) => patch(model.id, { maxTokens: e.target.value })}
                        style={{ flex: 1, minWidth: 0, padding: "4px 7px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontFamily: "var(--font-mono)" }}
                      />
                    </label>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
                    {t("desktop.builtinModelsThinking")}
                  </div>
                  <ThinkingLevelMapEditor
                    value={draft.thinkingLevelMap}
                    onChange={(map) => patch(model.id, { thinkingLevelMap: map })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => { void saveCurrent().catch(() => {}); }}
          disabled={saving || dirty.size === 0}
          style={{
            alignSelf: "flex-start",
            padding: "5px 14px",
            background: dirty.size > 0 && !saving ? "var(--accent)" : "var(--bg-panel)",
            border: "none",
            borderRadius: 5,
            color: dirty.size > 0 && !saving ? "#fff" : "var(--text-dim)",
            cursor: dirty.size > 0 && !saving ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {saving ? t("desktop.modelsSaving") : savedOk ? t("desktop.modelsSaved") : t("desktop.modelsSave")}
        </button>
        {dirty.size > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("desktop.builtinModelsDirty", { count: dirty.size })}
          </span>
        )}
      </div>

    </div>
  );
}