"use client";

/**
 * Claude Design System — queue recovery (slot `queueRecovery`).
 *
 * pi restores steer/follow-up messages that were still queued when the server
 * restarted; nothing is auto-delivered, the user picks. Every side effect is
 * carried over verbatim: the selection resets whenever `items` changes, the
 * resolve path guards an empty selection, reports a thrown error in the footer
 * status line, and always clears `busy`; export filters the live queue down to
 * the selection and downloads through `downloadQueueExport`; import parses the
 * file and reports both the empty and the staged count. Escape dismisses unless
 * a submit is running.
 *
 * The shell is CDS now: card radius, popover ring, a header band that keeps the
 * bulk actions as compact ghost buttons, selectable rows that take a clay edge
 * when picked, and a footer where re-queue is the primary action and discard is
 * the destructive one.
 */

import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";

import { CdsButton } from "@/components/claude/primitives/CdsButton";
import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import { downloadQueueExport, parseQueueImport } from "@/lib/queue-export";

type ClaudeQueueRecoveryProps = SlotPropsMap["queueRecovery"];

export function ClaudeQueueRecovery({
  items,
  sessionId,
  onResolve,
  onExport,
  onStageImport,
  onDismiss,
  mode = "recovery",
}: ClaudeQueueRecoveryProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // pi parity: a changed recovery list re-selects everything.
  useEffect(() => {
    setSelected(new Set(items.map((item) => item.id)));
  }, [items]);

  // Escape is the keyboard dismiss for every modal here; suppressed mid-submit.
  useEscapeKey(!busy, onDismiss);
  useFocusTrap(cardRef, !busy);

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

  const title = mode === "import" ? t("desktop.queueImportTitle") : t("desktop.queueRecoveryTitle");
  const description = mode === "import" ? t("desktop.queueImportDescription") : t("desktop.queueRecoveryDescription");
  const empty = selectedItems.length === 0;

  return (
    <div className="cds-overlay" role="presentation">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-cds="QueueRecovery"
        tabIndex={-1}
        data-claude-focus-anchor="true"
        className="cds-card cds-queue"
      >
        <header className="cds-queue-header">
          <div className="cds-queue-heading">
            <h2 className="cds-queue-title">{title}</h2>
            <p className="cds-queue-text">{description}</p>
          </div>
          <div className="cds-queue-tools">
            <CdsButton
              size="xs"
              variant="ghost"
              onClick={() => setSelected(new Set(allSelected ? [] : items.map((item) => item.id)))}
            >
              {allSelected ? t("desktop.selectNone") : t("desktop.selectAll")}
            </CdsButton>
            <CdsButton size="xs" variant="ghost" disabled={busy || empty} onClick={() => void exportSelected("json")}>
              JSON
            </CdsButton>
            <CdsButton size="xs" variant="ghost" disabled={busy || empty} onClick={() => void exportSelected("md")}>
              MD
            </CdsButton>
            <CdsButton
              size="xs"
              variant="ghost"
              disabled={busy}
              icon={<Upload size={12} aria-hidden="true" />}
              onClick={() => importRef.current?.click()}
            >
              {t("desktop.import")}
            </CdsButton>
            <button
              type="button"
              className="cds-icon-button"
              onClick={onDismiss}
              aria-label={t("desktop.close")}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="cds-queue-list">
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                aria-pressed={checked}
                data-selected={checked ? "true" : undefined}
                className="cds-queue-item"
              >
                <span className="cds-check" data-checked={checked ? "true" : undefined} aria-hidden="true">
                  {checked ? <CheckMark /> : null}
                </span>
                <span className="cds-queue-item-body">
                  <span className="cds-queue-meta">
                    <span className="cds-chip">{item.kind === "steer" ? t("desktop.steer") : t("desktop.followUp")}</span>
                    <span>{new Date(item.queuedAt).toLocaleString()}</span>
                    {item.hasImages ? <span>{t("desktop.queueImages")}</span> : null}
                  </span>
                  <span className="cds-queue-item-text">{item.text || t("desktop.queueNoText")}</span>
                </span>
              </button>
            );
          })}
        </div>

        <footer className="cds-queue-footer">
          {status ? <span className="cds-queue-status" role="status">{status}</span> : null}
          <CdsButton size="md" variant="ghost" disabled={busy} onClick={onDismiss}>
            {t("desktop.dismiss")}
          </CdsButton>
          <CdsButton size="md" variant="danger" disabled={busy || empty} onClick={() => void resolve("discard")}>
            {t("desktop.discard")}
          </CdsButton>
          <CdsButton size="md" variant="outline" disabled={busy || empty} onClick={() => void resolve("keep")}>
            {t("desktop.requeue")}
          </CdsButton>
          <CdsButton size="md" variant="primary" disabled={busy || empty} onClick={() => void resolve("keep", true)}>
            {t("desktop.requeueAndContinue")}
          </CdsButton>
        </footer>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="cds-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

/** 10px tick drawn inline so the box needs no icon-font dependency. */
function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 6.5 4.8 8.8 9.5 3.6" />
    </svg>
  );
}
