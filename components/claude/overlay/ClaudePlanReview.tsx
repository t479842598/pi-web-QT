"use client";

/**
 * Claude Design System — plan review (slot `planReview`).
 *
 * pi renders this inline at the tail of the message stream and that placement
 * is kept: the plan itself is already in the transcript above, so the shelf only
 * offers the decisions. Every branch is the pi one — the reset on open, the
 * feedback editor that opens above the action row and focuses its textarea, the
 * plan preview that starts expanded, the send button that stays disabled until
 * the field has text, and the same five callbacks in the same order.
 *
 * It is a CDS card now (card radius, popover ring, clay primary) that keeps
 * `role="dialog"` but not modality: the user still has to scroll the plan it
 * refers to, so `aria-modal` is false and focus is never trapped.
 */

import { useEffect, useRef, useState } from "react";
import { RotateCw, ArrowLeft, CheckCircle2, ChevronRight, ListChecks, X } from "lucide-react";

import { CdsButton } from "@/components/claude/primitives/CdsButton";
import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useI18n } from "@/hooks/useI18n";

type ClaudePlanReviewProps = SlotPropsMap["planReview"];

export function ClaudePlanReview({
  open,
  planText,
  onExecute,
  onFeedback,
  onExit,
  onClose,
  busy = false,
}: ClaudePlanReviewProps) {
  const { t } = useI18n();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [planExpanded, setPlanExpanded] = useState(true);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // pi parity: every opening starts with the editor closed and the plan shown.
  useEffect(() => {
    if (!open) return;
    setFeedbackOpen(false);
    setFeedback("");
    setPlanExpanded(true);
  }, [open]);

  useEffect(() => {
    if (feedbackOpen) feedbackRef.current?.focus();
  }, [feedbackOpen]);

  if (!open) return null;

  const trimmedPlan = planText && planText.trim() ? planText.trim() : null;
  const canSend = feedback.trim().length > 0 && !busy;

  return (
    <section
      role="dialog"
      aria-modal={false}
      aria-label={t("tasks.planReviewTitle")}
      data-cds="PlanReview"
      className="cds-card cds-plan"
    >
      {feedbackOpen && (
        <div className="cds-plan-feedback">
          <label className="cds-plan-feedback-label" htmlFor="cds-plan-feedback">
            {t("tasks.planReviewFeedbackLabel")}
          </label>
          <textarea
            id="cds-plan-feedback"
            ref={feedbackRef}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("tasks.planReviewFeedbackPlaceholder")}
            rows={2}
            className="cds-textarea"
          />
          <div className="cds-plan-feedback-actions">
            <CdsButton size="sm" variant="ghost" disabled={busy} onClick={() => setFeedbackOpen(false)}>
              {t("i18n.cancel")}
            </CdsButton>
            <CdsButton
              size="sm"
              variant="primary"
              disabled={!canSend}
              onClick={() => { if (feedback.trim()) onFeedback(feedback.trim()); }}
            >
              {t("tasks.planReviewSendFeedback")}
            </CdsButton>
          </div>
        </div>
      )}

      {trimmedPlan ? (
        <div className="cds-plan-preview">
          <button
            type="button"
            onClick={() => setPlanExpanded((value) => !value)}
            aria-expanded={planExpanded}
            className="cds-plan-toggle"
          >
            <ChevronRight
              size={12}
              aria-hidden="true"
              className="cds-plan-chevron"
              data-open={planExpanded ? "true" : undefined}
            />
            {planExpanded ? t("tasks.planReviewHidePlan") : t("tasks.planReviewShowPlan")}
          </button>
          {planExpanded && <div className="cds-well cds-plan-body">{trimmedPlan}</div>}
        </div>
      ) : null}

      <div className="cds-plan-actions">
        <span className="cds-plan-title">
          <ListChecks size={14} aria-hidden="true" className="cds-plan-icon" />
          <span className="cds-plan-title-text">{t("tasks.planReviewTitle")}</span>
        </span>

        <CdsButton
          size="sm"
          variant="primary"
          disabled={busy}
          title={t("tasks.planReviewExecute")}
          icon={<CheckCircle2 size={13} aria-hidden="true" />}
          onClick={onExecute}
        >
          {t("tasks.planReviewExecute")}
        </CdsButton>

        <CdsButton
          size="sm"
          variant={feedbackOpen ? "outline" : "ghost"}
          disabled={busy}
          title={t("tasks.planReviewSuggest")}
          aria-pressed={feedbackOpen}
          icon={<RotateCw size={12} aria-hidden="true" />}
          onClick={() => {
            if (feedbackOpen) { setFeedbackOpen(false); return; }
            setFeedbackOpen(true);
            requestAnimationFrame(() => feedbackRef.current?.focus());
          }}
        >
          {t("tasks.planReviewSuggest")}
        </CdsButton>

        <CdsButton
          size="sm"
          variant="ghost"
          disabled={busy}
          title={t("tasks.planReviewExit")}
          icon={<ArrowLeft size={12} aria-hidden="true" />}
          onClick={() => { setFeedbackOpen(false); onExit(); }}
        >
          {t("tasks.planReviewExit")}
        </CdsButton>

        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          title={t("i18n.close")}
          aria-label={t("i18n.close")}
          className="cds-icon-button cds-icon-button-xs"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
