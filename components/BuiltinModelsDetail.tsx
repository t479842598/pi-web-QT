"use client";

import { useCallback, useEffect, useState } from "react";
import { ThinkingLevelMapEditor } from "./ModelsConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

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
  reasoning?: boolean;
  contextWindow?: string;
  maxTokens?: string;
  thinkingLevelMap?: Record<string, string | null>;
}

function numOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Model field editor for builtin (API-key/OAuth) providers. Edits are written
 * into models.json as overlay entries for the provider, only for models the
 * user actually changed.
 */
export function BuiltinModelsDetail({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [models, setModels] = useState<BuiltinModelInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/models-config/builtin?provider=${encodeURIComponent(providerId)}`)
      .then((r) => r.json())
      .then((d: BuiltinModelsResponse) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setModels(d.models);
        const initial: Record<string, Draft> = {};
        for (const model of d.models) {
          const ov = d.overrides[model.id] ?? {};
          initial[model.id] = {
            reasoning: typeof ov.reasoning === "boolean" ? ov.reasoning : model.reasoning,
            contextWindow: typeof ov.contextWindow === "number" ? String(ov.contextWindow) : model.contextWindow != null ? String(model.contextWindow) : "",
            maxTokens: typeof ov.maxTokens === "number" ? String(ov.maxTokens) : model.maxTokens != null ? String(model.maxTokens) : "",
            thinkingLevelMap: (ov.thinkingLevelMap as Draft["thinkingLevelMap"]) ?? model.thinkingLevelMap,
          };
        }
        setDrafts(initial);
        setDirty(new Set());
      })
      .catch(() => setError(String(t("desktop.builtinModelsLoadFailed"))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [providerId, t]);

  const patch = useCallback((id: string, change: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...change } }));
    setDirty((prev) => new Set(prev).add(id));
  }, []);

  const handleSave = useCallback(async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      // Serialize drafts into overlay entries.
      // SDK 按 id 整体替换模型条目（非字段合并），因此必须带上 name/reasoning
      // 及全部可编辑字段的当前值，否则未修改字段会被重置（如 name 丢失、reasoning 变 false）。
      const entries = [];
      for (const id of dirty) {
        const draft = drafts[id];
        if (!draft) continue;
        const entry: Record<string, unknown> = { id };
        const model = models.find((m) => m.id === id);
        if (model?.name) entry.name = model.name;
        if (typeof draft.reasoning === "boolean") entry.reasoning = draft.reasoning;
        const cw = numOrUndefined(draft.contextWindow ?? "");
        if (cw !== undefined) entry.contextWindow = cw;
        const mt = numOrUndefined(draft.maxTokens ?? "");
        if (mt !== undefined) entry.maxTokens = mt;
        if (draft.thinkingLevelMap && Object.keys(draft.thinkingLevelMap).length > 0) {
          entry.thinkingLevelMap = draft.thinkingLevelMap;
        }
        entries.push(entry);
      }

      const res = await fetch("/api/models-config");
      const current = (await res.json()) as { providers?: Record<string, Record<string, unknown>> };
      const providers = current.providers ?? {};
      const dirtyIds = new Set([...dirty]);
      const kept = Array.isArray(providers[providerId]?.models)
        ? (providers[providerId].models as Array<Record<string, unknown>>).filter(
            (item) => !dirtyIds.has(String(item.id)),
          )
        : [];
      const merged = [...kept, ...entries.filter((e) => Object.keys(e).length > 1)];
      const nextProvider = merged.length > 0
        ? { ...(providers[providerId] ?? {}), models: merged }
        : undefined;
      const next = { ...providers };
      if (nextProvider) next[providerId] = nextProvider;
      else delete next[providerId];

      const putRes = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: next }),
      });
      const d = (await putRes.json()) as { success?: boolean; error?: string };
      if (!putRes.ok || d.error) {
        setError(d.error ?? `HTTP ${putRes.status}`);
        return;
      }
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      setDirty(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [dirty, drafts, providerId, models]);

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
                  {model.name || model.id}
                  {isDirty && <span style={{ color: "var(--accent)", marginLeft: 6 }}>•</span>}
                </button>
                <code style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{model.id}</code>
                {model.reasoning && (
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
          onClick={handleSave}
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
