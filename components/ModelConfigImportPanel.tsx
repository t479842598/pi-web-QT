"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelConfigImportCandidate } from "@/lib/model-config-import";

const SOURCE_LABEL_KEY: Record<string, string> = {
  "claude-code": "desktop.importSourceClaudeCode",
  codex: "desktop.importSourceCodex",
  opencode: "desktop.importSourceOpenCode",
  "cc-switch": "desktop.importSourceCcSwitch",
  pi: "desktop.importSourcePi",
};

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "ready"; candidates: ModelConfigImportCandidate[] }
  | { phase: "error"; message: string };

function hostOf(baseUrl: string | null): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

/**
 * "Import from other tools" panel: scans local agents (Claude Code, Codex,
 * OpenCode, cc-switch, Pi) and writes the selected providers into models.json.
 * Mirrors PI-Desktop's ModelConfigImportPanel — scan, group by source, tick the
 * ones to keep, import.
 */
export function ModelConfigImportPanel({
  onImported,
  onClose,
}: {
  onImported: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const keyOf = (c: ModelConfigImportCandidate) => `${c.source}:${c.externalId}`;

  const scan = useCallback(async () => {
    setState({ phase: "scanning" });
    setResult(null);
    try {
      const res = await fetch("/api/models-config/import", { cache: "no-store" });
      const data = await res.json() as { candidates?: ModelConfigImportCandidate[]; error?: string };
      if (!res.ok || data.error) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ phase: "ready", candidates: data.candidates ?? [] });
      setSelected(new Set());
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => { void scan(); }, [scan]);

  const candidates = state.phase === "ready" ? state.candidates : [];
  const groups = useMemo(() => {
    const bySource = new Map<string, ModelConfigImportCandidate[]>();
    for (const candidate of candidates) {
      const list = bySource.get(candidate.source) ?? [];
      list.push(candidate);
      bySource.set(candidate.source, list);
    }
    return [...bySource.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `candidates` is a fresh [] literal each render when idle; grouping only matters in the ready phase.
  }, [state.phase === "ready" ? state.candidates : null]);

  const allKeys = candidates.map(keyOf);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  const toggleKey = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  };

  const runImport = async () => {
    const keys = [...selected];
    if (keys.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch("/api/models-config/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json() as { imported?: number; skipped?: number; error?: string };
      if (!res.ok || data.error) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setResult(t("desktop.modelImportResult", { imported: data.imported ?? 0, skipped: data.skipped ?? 0 }));
      onImported();
      setSelected(new Set());
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="settings-panel is-padded"
      style={{ gap: 10, padding: 14, background: "var(--ds-tile-deep)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="settings-row-title">{t("desktop.modelImportTitle")}</div>
          <div className="settings-row-description">{t("desktop.modelImportDescription")}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="config-button config-button-secondary config-button-small" onClick={() => void scan()} disabled={state.phase === "scanning"}>
            {state.phase === "scanning" ? t("desktop.modelImportScanning") : t("desktop.modelImportRescan")}
          </button>
          <button type="button" className="config-button config-button-ghost config-button-small" onClick={onClose}>
            {t("desktop.close")}
          </button>
        </div>
      </div>

      {state.phase === "error" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--status-error)", fontSize: 'var(--text-ui-sm)' }}>
          <WarningCircleIcon size={15} />
          <span>{state.message}</span>
        </div>
      )}

      {state.phase === "ready" && candidates.length === 0 && (
        <div className="settings-row" style={{ color: "var(--ds-text-muted)", fontSize: 'var(--text-ui-sm)' }}>
          {t("desktop.modelImportNone")}
        </div>
      )}

      {state.phase === "ready" && candidates.length > 0 && (
        <>
          <label className="settings-row is-hoverable" style={{ padding: "8px 12px", background: "var(--ds-tile)" }}>
            <span className="settings-row-copy" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: "var(--ds-accent)" }} />
              <span className="settings-row-title">{t("desktop.modelImportSelectAll", { count: candidates.length })}</span>
            </span>
            <button
              type="button"
              className="config-button config-button-primary config-button-small"
              onClick={() => void runImport()}
              disabled={selected.size === 0 || importing}
            >
              {importing
                ? t("desktop.modelImportImporting")
                : t("desktop.modelImportImport", { count: selected.size })}
            </button>
          </label>

          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map(([source, items]) => (
              <div key={source} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 'var(--text-ui-xs)', fontWeight: 700, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", padding: "2px 4px" }}>
                  {t(SOURCE_LABEL_KEY[source] ?? source)} · {items.length}
                </div>
                {items.map((candidate) => {
                  const key = keyOf(candidate);
                  const checked = selected.has(key);
                  return (
                    <label key={key} className="settings-row is-hoverable" style={{ padding: "8px 12px", gap: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleKey(key)} style={{ accentColor: "var(--ds-accent)", flexShrink: 0 }} />
                      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <span className="settings-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{candidate.name}</span>
                          {candidate.hasKey && (
                            <span title={t("desktop.modelImportHasKey")} style={{ fontSize: 'var(--text-ui-xs)', padding: "1px 5px", borderRadius: 'var(--radius-xs)', background: "var(--status-success-bg)", color: "var(--status-success)", border: "1px solid var(--status-success-border)", flexShrink: 0 }}>
                              key
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {candidate.api} · {candidate.models.length} {t("desktop.modelsPlural")}
                          {hostOf(candidate.baseUrl) ? ` · ${hostOf(candidate.baseUrl)}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {result && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--status-success)", fontSize: 'var(--text-ui-sm)' }}>
          <CheckIcon size={14} />
          <span>{result}</span>
        </div>
      )}
    </div>
  );
}
