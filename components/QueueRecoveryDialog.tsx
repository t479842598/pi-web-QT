"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PendingRecoveryItem, QueueEntry, QueueEntryInput } from "@/lib/queue-store";
import { downloadQueueExport, parseQueueImport } from "@/lib/queue-export";

export function QueueRecoveryDialog({
  items,
  sessionId,
  onResolve,
  onExport,
  onStageImport,
  onDismiss,
  mode = "recovery",
}: {
  items: PendingRecoveryItem[];
  sessionId?: string;
  onResolve: (keep: string[], discard: string[], continueRun: boolean) => Promise<PendingRecoveryItem[]>;
  onExport: () => Promise<{ live: QueueEntry[]; recovery: QueueEntry[] } | null>;
  onStageImport: (entries: QueueEntryInput[]) => Promise<number | null>;
  onDismiss: () => void;
  mode?: "recovery" | "import";
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelected(new Set(items.map((item) => item.id)));
  }, [items]);

  const selectedItems = items.filter((item) => selected.has(item.id));
  const allSelected = selectedItems.length === items.length && items.length > 0;
  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const resolve = async (action: "keep" | "discard", continueRun = false) => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      await onResolve(
        action === "keep" ? selectedItems.map((item) => item.id) : [],
        action === "discard" ? selectedItems.map((item) => item.id) : [],
        continueRun,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const exportSelected = async (format: "json" | "md") => {
    const data = await onExport();
    if (!data) return;
    const entries = data.recovery.filter((entry) => selected.has(entry.id));
    if (!entries.length) return;
    downloadQueueExport(entries, { sessionId, source: "recovery" }, format);
    setStatus(t("desktop.queueExported", { count: entries.length }));
  };
  const importFile = async (file: File) => {
    const entries = parseQueueImport(await file.text());
    if (!entries.length) {
      setStatus(t("desktop.queueImportEmpty"));
      return;
    }
    const staged = await onStageImport(entries);
    setStatus(staged === null ? t("desktop.queueImportEmpty") : t("desktop.queueImported", { count: staged }));
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "import" ? t("desktop.queueImportTitle") : t("desktop.queueRecoveryTitle")}
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-(--border) bg-(--bg) shadow-2xl"
      >
        <header className="flex flex-wrap items-start gap-3 border-b border-(--border) bg-(--bg-panel) px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-(--text)">
              {mode === "import" ? t("desktop.queueImportTitle") : t("desktop.queueRecoveryTitle")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-(--text-muted)">
              {mode === "import" ? t("desktop.queueImportDescription") : t("desktop.queueRecoveryDescription")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="markdown-code-action" onClick={() => setSelected(new Set(allSelected ? [] : items.map((item) => item.id)))}>
              {allSelected ? t("desktop.selectNone") : t("desktop.selectAll")}
            </button>
            <button type="button" className="markdown-code-action" disabled={busy || selectedItems.length === 0} onClick={() => void exportSelected("json")}>
              JSON
            </button>
            <button type="button" className="markdown-code-action" disabled={busy || selectedItems.length === 0} onClick={() => void exportSelected("md")}>
              MD
            </button>
            <button type="button" className="markdown-code-action" disabled={busy} onClick={() => importRef.current?.click()}>
              {t("desktop.import")}
            </button>
            <button type="button" className="markdown-code-action" onClick={onDismiss} aria-label={t("desktop.close")}>
              ×
            </button>
          </div>
        </header>

        <div className="grid flex-1 content-start gap-2 overflow-y-auto p-3">
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                aria-pressed={checked}
                className={["flex w-full items-start gap-3 rounded-lg border p-3 text-left transition", checked ? "border-(--accent) bg-(--bg-selected)" : "border-(--border) bg-(--bg-panel) hover:bg-(--bg-hover)"].join(" ")}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} onClick={(event) => event.stopPropagation()} className="mt-1 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-(--text-dim)">
                    <span className="rounded-full border border-(--border) px-2 py-0.5 font-mono uppercase">
                      {item.kind === "steer" ? t("desktop.steer") : t("desktop.followUp")}
                    </span>
                    <span>{new Date(item.queuedAt).toLocaleString()}</span>
                    {item.hasImages ? <span>{t("desktop.queueImages")}</span> : null}
                  </span>
                  <span className="mt-2 block whitespace-pre-wrap break-words border-l-2 border-(--border) pl-2 text-xs leading-5 text-(--text)">
                    {item.text || t("desktop.queueNoText")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <footer className={[
          "flex flex-wrap items-center gap-2 border-t border-(--border) px-4 py-3",
          isMobile ? "justify-stretch" : "justify-end",
        ].join(" ")}>
          {status ? <span className="mr-auto text-xs text-(--text-muted)">{status}</span> : null}
          <button type="button" className="rounded-md px-3 py-2 text-xs text-(--text-muted) hover:bg-(--bg-hover)" onClick={onDismiss} disabled={busy}>{t("desktop.dismiss")}</button>
          <button type="button" className="rounded-md border border-red-400/40 px-3 py-2 text-xs text-red-400 disabled:opacity-40" onClick={() => void resolve("discard")} disabled={busy || selectedItems.length === 0}>{t("desktop.discard")}</button>
          <button type="button" className="rounded-md border border-(--accent) px-3 py-2 text-xs text-(--accent) disabled:opacity-40" onClick={() => void resolve("keep")} disabled={busy || selectedItems.length === 0}>{t("desktop.requeue")}</button>
          <button type="button" className="rounded-md bg-(--accent) px-3 py-2 text-xs text-white disabled:opacity-40" onClick={() => void resolve("keep", true)} disabled={busy || selectedItems.length === 0}>{t("desktop.requeueAndContinue")}</button>
        </footer>
      </div>
      <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importFile(file);
        event.currentTarget.value = "";
      }} />
    </div>
  );
}
