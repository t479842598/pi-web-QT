"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ModelSelector, type ModelSelectorOption } from "@/components/ModelSelector";

interface DefaultModelRef {
  provider: string;
  modelId: string;
}

interface DefaultModelResponse {
  stored: DefaultModelRef | null;
  resolved: DefaultModelRef | null;
  availableModels: { provider: string; modelId: string; name: string }[];
  scope: "global" | "project";
  path: string;
  editable: boolean;
  error?: string;
}

interface DefaultModelRowProps {
  cwd?: string | null;
  onChangedAction?: () => void;
}

function defaultModelUrl(cwd: string | null | undefined): string {
  return cwd
    ? `/api/settings/default-model?cwd=${encodeURIComponent(cwd)}`
    : "/api/settings/default-model";
}

/**
 * Global default model row for the Models settings panel.
 *
 * `stored` and `resolved` are carried separately on purpose: settings.json
 * keeps its `defaultProvider`/`defaultModel` pair long after a provider is
 * removed or a model is renamed, and pi silently falls back to the first
 * available model at session start. Showing the stored pair would assert a
 * default no new session will actually use — so a stale pair renders as a
 * warning over an unselected picker, and this row never rewrites the user's
 * settings on its own.
 */
export function DefaultModelRow({ cwd, onChangedAction }: DefaultModelRowProps) {
  const { t } = useI18n();
  const [stored, setStored] = useState<DefaultModelRef | null>(null);
  const [resolved, setResolved] = useState<DefaultModelRef | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelSelectorOption[]>([]);
  const [scopePath, setScopePath] = useState("");
  const [editable, setEditable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // `t` is deliberately NOT a dependency. `useI18n` memoizes it per locale, but
  // a locale switch mid-flight would re-run this effect; the cleanup of the
  // first run then flips `cancelled`, and although the second run's finally
  // still clears `loading`, the ordering is not guaranteed — the first run's
  // response can land after the second run has started, leaving the row stuck
  // on its skeleton. Reading the latest translator from a ref keeps the
  // request keyed on `cwd` alone, and `mountedRef` (not a per-run flag) decides
  // whether the result may still be written.
  const tRef = useRef(t);
  tRef.current = t;
  /** Monotone id of the newest load; only that run may settle `loading`. */
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = (requestSeqRef.current += 1);
    setLoading(true);
    fetch(defaultModelUrl(cwd))
      .then(async (response) => {
        const data = (await response.json()) as DefaultModelResponse;
        if (cancelled || !mountedRef.current) return;
        if (!response.ok) {
          setError(data.error ?? `HTTP ${response.status}`);
          return;
        }
        setStored(data.stored ?? null);
        setResolved(data.resolved ?? null);
        setAvailableModels(data.availableModels ?? []);
        setScopePath(data.path ?? "");
        setEditable(data.editable !== false);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setError(tRef.current("desktop.defaultModelSaveFailed"));
      })
      .finally(() => {
        // The skeleton must always come down. React's development Strict Mode
        // runs this effect twice (mount → cleanup → mount), and the first
        // run's `finally` is the one that fires first — with `cancelled`
        // already flipped by its own cleanup. Gating on that flag left the row
        // showing its skeleton forever. A superseded run is identified by its
        // sequence number instead, and an unmount by `mountedRef`.
        if (!mountedRef.current) return;
        if (requestSeqRef.current !== requestId) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const stale = stored !== null && resolved === null;
  const scopeNotice = t("desktop.defaultModelProjectScope", { path: scopePath });

  const reasonText = useCallback((reason: string | undefined, bodyError?: string): string => {
    if (reason === "unknown-model") return t("desktop.defaultModelUnknownModel");
    if (reason === "project-scope") return t("desktop.defaultModelProjectScope", { path: scopePath });
    return bodyError ?? t("desktop.defaultModelSaveFailed");
  }, [scopePath, t]);

  const handleChange = useCallback(async (nextProvider: string, nextModelId: string) => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/settings/default-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          provider: nextProvider,
          modelId: nextModelId,
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        reason?: string;
        resolved?: DefaultModelRef | null;
        error?: string;
      };
      if (!response.ok || data.error) {
        setError(reasonText(data.reason, data.error));
        return;
      }
      const next = data.resolved ?? null;
      setStored(next);
      setResolved(next);
      setSavedOk(true);
      onChangedAction?.();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSavedOk(false);
      }, 2000);
    } catch {
      setError(t("desktop.defaultModelSaveFailed"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [cwd, onChangedAction, reasonText, t]);

  const selectOptions = useMemo<ModelSelectorOption[]>(
    () => availableModels.map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      name: model.name || model.modelId,
    })),
    [availableModels],
  );

  const statusLine = error ?? (stale ? t("desktop.defaultModelStale") : null);

  return (
    <div className="settings-row is-stacked" aria-busy={loading || saving}>
      <div className="settings-row-copy">
        <span className="settings-row-title">{t("desktop.defaultModelTitle")}</span>
        <span className="settings-row-description">{t("desktop.defaultModelHelp")}</span>
        {!loading && !editable && (
          <span className="settings-row-description" title={scopePath} style={{ color: "var(--ds-text-muted)" }}>
            {scopeNotice}
          </span>
        )}
        {!loading && statusLine && (
          <span role="status" style={{ display: "block", marginTop: 3, fontSize: "var(--text-ui-sm)", lineHeight: 1.5, color: "var(--status-error)" }}>
            {statusLine}
          </span>
        )}
        {!loading && !statusLine && savedOk && (
          <span role="status" style={{ display: "block", marginTop: 3, fontSize: "var(--text-ui-sm)", lineHeight: 1.5, color: "var(--ds-accent)" }}>
            {t("i18n.saved")}
          </span>
        )}
      </div>
      <div className="settings-row-control" style={{ flex: "0 0 auto", width: "min(100%, 260px)", maxWidth: "100%" }}>
        {loading ? (
          <div
            aria-hidden="true"
            style={{
              width: "100%",
              height: 34,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--ds-border-default)",
              background: "var(--ds-bg-secondary)",
            }}
          />
        ) : (
          <ModelSelector
            options={selectOptions}
            value={resolved}
            onChange={handleChange}
            emptyLabel={t("desktop.defaultModelNone")}
            disabled={!editable || saving}
            busy={saving}
            ariaLabel={t("desktop.defaultModelTitle")}
            variant="field"
          />
        )}
      </div>
    </div>
  );
}
