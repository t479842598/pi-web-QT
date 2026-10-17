"use client";

/**
 * Claude Design System — project trust dialog (slot `trustDialog`).
 *
 * Same props, same behaviour as the pi component: a blocking modal that asks
 * whether this project may install packages, Escape cancels (cancelled while a
 * submit runs, matching `useEscapeKey(!busy, onCancelAction)`), the error line
 * is a live `role="alert"`, and the confirm button turns into its "trusting…"
 * label while the request is in flight.
 *
 * Restyled as a centred CDS card: 16px radius, popover ring, a toned shield
 * glyph, the cwd in a mono hairline well, and a footer split the CDS way —
 * quiet cancel on the left, clay confirm on the right.
 */

import { useRef } from "react";
import { ShieldCheck } from "lucide-react";

import { CdsButton } from "@/components/claude/primitives/CdsButton";
import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";

type ClaudeTrustDialogProps = SlotPropsMap["trustDialog"];

export function ClaudeTrustDialog({
  cwd,
  busy,
  error,
  onCancelAction,
  onConfirmAction,
}: ClaudeTrustDialogProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);

  useEscapeKey(!busy, onCancelAction);
  useFocusTrap(cardRef, true);

  return (
    <div className="cds-overlay" role="presentation">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-project-trust-title"
        data-cds="TrustDialog"
        tabIndex={-1}
        data-claude-focus-anchor="true"
        className="cds-card cds-trust"
      >
        <div className="cds-trust-body">
          <span className="cds-trust-glyph" aria-hidden="true">
            <ShieldCheck size={20} strokeWidth={2} />
          </span>
          <div className="cds-trust-copy">
            <h2 id="claude-project-trust-title" className="cds-trust-title">
              {t("desktop.trustProjectTitle")}
            </h2>
            <p className="cds-trust-text">{t("desktop.trustProjectBody")}</p>
            <code className="cds-well cds-trust-cwd">{cwd}</code>
            {error && <div role="alert" className="cds-trust-error">{error}</div>}
          </div>
        </div>
        <footer className="cds-trust-footer">
          <CdsButton
            size="md"
            variant="ghost"
            disabled={busy}
            onClick={onCancelAction}
          >
            {t("desktop.cancel")}
          </CdsButton>
          <CdsButton
            size="md"
            variant="primary"
            loading={busy}
            onClick={onConfirmAction}
          >
            {busy ? t("desktop.trustingProject") : t("desktop.trustProject")}
          </CdsButton>
        </footer>
      </div>
    </div>
  );
}
