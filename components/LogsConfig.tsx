"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Trash } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import type { ErrorLogEntry } from "@/lib/error-log-types";

export function LogsConfig() {
  const { t } = useI18n();
  const [allEntries, setAllEntries] = useState<ErrorLogEntry[]>([]);
  const [level, setLevel] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch the full ring once (the store caps at 500 entries) and filter on
      // the client, so the source dropdown keeps its options while filtering.
      const response = await fetch("/api/logs?limit=500");
      const data = await response.json() as { entries?: ErrorLogEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setAllEntries(data.entries ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availableSources = useMemo(
    () => [...new Set(allEntries.map((entry) => entry.source).filter(Boolean))].sort(),
    [allEntries],
  );

  // Dynamic status-code options: every code that actually appears in the log,
  // so filtering covers all real cases (200/3xx/422/…) rather than a fixed list.
  const availableStatusCodes = useMemo(
    () => [...new Set(allEntries.map((entry) => entry.statusCode).filter((code): code is number => code !== undefined))].sort((a, b) => a - b),
    [allEntries],
  );

  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return allEntries
      .filter((entry) => !level || entry.level === level)
      .filter((entry) => !statusCode || entry.statusCode === Number(statusCode))
      .filter((entry) => !source || entry.source === source)
      .filter((entry) => !needle
        || [entry.message, entry.details, entry.provider, entry.model, entry.source]
          .filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(needle)))
      .slice(0, 200);
  }, [allEntries, level, statusCode, source, query]);

  const clear = async () => {
    try {
      const response = await fetch("/api/logs", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setAllEntries([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const copyEntry = async (entry: ErrorLogEntry) => {
    const text = [
      `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.statusCode ?? "—"}`,
      `${entry.source}${entry.provider ? ` · ${entry.provider}` : ""}${entry.model ? ` · ${entry.model}` : ""}`,
      entry.message,
      entry.details,
    ].filter(Boolean).join("\n");
    try {
      await copyText(text);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <select value={level} onChange={(event) => setLevel(event.target.value)} style={{ padding: "7px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }}>
          <option value="">{t("desktop.logsAllLevels")}</option>
          {["error", "warning", "info"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={statusCode} onChange={(event) => setStatusCode(event.target.value)} style={{ padding: "7px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }}>
          <option value="">{t("desktop.logsAllCodes")}</option>
          {availableStatusCodes.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <select value={source} onChange={(event) => setSource(event.target.value)} style={{ padding: "7px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }}>
          <option value="">{t("desktop.logsAllSources")}</option>
          {availableSources.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("desktop.logsSearch")} style={{ flex: 1, minWidth: 180, padding: "7px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 12 }} />
        <button type="button" onClick={() => void load()} title={t("desktop.refresh")} aria-label={t("desktop.refresh")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer" }}><ArrowClockwise size={14} /></button>
        <button type="button" onClick={() => void clear()} title={t("desktop.logsClear")} aria-label={t("desktop.logsClear")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "#ef4444", cursor: "pointer" }}><Trash size={14} /></button>
      </div>
      {loading && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("desktop.loading")}</div>}
      {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
      {!loading && !error && entries.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("desktop.logsEmpty")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => (
          <details key={entry.id} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)", padding: "8px 10px" }}>
            <summary style={{ cursor: "pointer", color: entry.level === "error" ? "#ef4444" : entry.level === "warning" ? "#f59e0b" : "var(--text)", fontSize: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)", marginRight: 8 }}>{entry.statusCode ?? "—"}</span>
              <span style={{ marginRight: 8 }}>{new Date(entry.timestamp).toLocaleString()}</span>
              <span style={{ overflowWrap: "anywhere" }}>{entry.message.length > 180 ? `${entry.message.slice(0, 180)}…` : entry.message}</span>
            </summary>
            <div style={{ padding: "8px 0 0 18px", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              <div>{entry.source}{entry.provider ? ` · ${entry.provider}` : ""}{entry.model ? ` · ${entry.model}` : ""}</div>
              <div style={{ marginTop: 5, maxHeight: 260, overflow: "auto" }}>{entry.message}</div>
              {entry.details && <div style={{ marginTop: 5, maxHeight: 260, overflow: "auto" }}>{entry.details}</div>}
              <button type="button" onClick={() => void copyEntry(entry)} style={{ marginTop: 8, padding: "4px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>
                {t("desktop.logsCopy")}
              </button>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
