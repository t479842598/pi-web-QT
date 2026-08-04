"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface TitleModelOption {
  provider: string;
  id: string;
  reasoning: boolean;
  label: string;
  name?: string;
}

interface TitleModelData {
  value: string | null;
  models: TitleModelOption[];
}

/**
 * Global title-generation model selector. Sits at the top of the Models
 * settings panel; persisted to the `titleModel` field of settings.json via
 * GET/PUT /api/settings/title-model.
 */
export function TitleModelSetting() {
  const { t } = useI18n();
  const [value, setValue] = useState<string | null>(null);
  const [models, setModels] = useState<TitleModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/title-model")
      .then((r) => r.json())
      .then((d: TitleModelData) => {
        setValue(d.value);
        setModels(d.models ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const invalid = value !== null && !models.some((m) => m.label === value);

  const handleChange = useCallback(async (next: string) => {
    const nextValue = next === "" ? null : next;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/settings/title-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: nextValue }),
      });
      const d = (await res.json()) as { value?: string | null; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setValue(d.value ?? null);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch {
      setError(String(t("desktop.titleModelSaveError")));
    } finally {
      setSaving(false);
    }
  }, [t]);

  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 18px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
          {t("desktop.titleModel")}
        </span>
        <select
          value={value ?? ""}
          disabled={loading || saving}
          onChange={(e) => handleChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            maxWidth: 420,
            padding: "6px 9px",
            fontSize: 12,
            color: "var(--text)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
          }}
        >
          <option value="">{t("desktop.titleModelFollowSession")}</option>
          {invalid && value !== null && (
            <option value={value} style={{ color: "#ef4444" }}>
              {value}（{t("desktop.titleModelInvalid")}）
            </option>
          )}
          {providers.map((provider) => (
            <optgroup key={provider} label={provider}>
              {models
                .filter((m) => m.provider === provider)
                .map((m) => (
                  <option key={m.label} value={m.label}>
                    {m.name || m.id}{m.reasoning ? "（reasoning）" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {saving && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>…</span>}
        {!saving && savedOk && (
          <span style={{ fontSize: 11, color: "#4ade80" }}>{t("desktop.titleModelSaved")}</span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {t("desktop.titleModelDescription")}
      </p>
      {error && (
        <p style={{ margin: 0, fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>{error}</p>
      )}
      {invalid && value !== null && (
        <p style={{ margin: 0, fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>
          {value}（{t("desktop.titleModelInvalid")}）
        </p>
      )}
    </div>
  );
}
