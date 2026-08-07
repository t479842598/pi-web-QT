"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowClockwise, CloudArrowUp, X } from "@phosphor-icons/react";
import type { StashEntry } from "@/lib/git-ops";

interface StashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd: string | null;
}

/** Stash manager: list, push, pop, drop — scoped to the current project dir. */
export function StashDialog({ open, onOpenChange, cwd }: StashDialogProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<StashEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    try {
      const res = await fetch(`/api/git/stash?${new URLSearchParams({ cwd }).toString()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { entries: StashEntry[] };
        setEntries(data.entries);
      }
    } catch {
      // keep previous list
    }
  }, [cwd]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const act = async (action: "push" | "pop" | "drop", ref?: string) => {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const res = await fetch(`/api/git/stash?${new URLSearchParams({ cwd: cwd ?? "" }).toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message: message || undefined, ref }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; output?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setOutput(data.output ?? t("tasks.stashDone"));
        setMessage("");
        void refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 950,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(520px, calc(100vw - 48px))",
        maxHeight: "min(75vh, 560px)",
        overflow: "auto",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("desktop.stashTitle")}</h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px 16px" }}>
          {/* Push */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("desktop.stashMessagePlaceholder")}
              style={{
                width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13,
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={() => void act("push")}
              disabled={busy}
              style={{
                alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <CloudArrowUp size={13} aria-hidden="true" />
              {t("desktop.stashPush")}
            </button>
          </div>

          {error && (
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.10)", color: "#ef4444", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {error}
            </div>
          )}
          {output && (
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(34,197,94,0.10)", color: "#22c55e", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {output}
            </div>
          )}

          {/* List */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              {t("desktop.stashList")} ({entries.length})
            </div>
            {entries.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.stashEmpty")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entries.map((entry) => (
                  <div key={entry.ref} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{entry.index}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.message || entry.ref}
                    </span>
                    <button
                      type="button"
                      onClick={() => void act("pop", entry.ref)}
                      disabled={busy}
                      title={t("desktop.stashPop")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 3,
                        padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
                        background: "none", color: "var(--text)", fontSize: 11, cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      <ArrowClockwise size={11} aria-hidden="true" />
                      {t("desktop.stashPop")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act("drop", entry.ref)}
                      disabled={busy}
                      title={t("desktop.stashDrop")}
                      style={{
                        display: "inline-flex", alignItems: "center",
                        padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
                        background: "none", color: "#ef4444", fontSize: 11, cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {t("desktop.stashDrop")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
