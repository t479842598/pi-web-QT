"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowClockwise, ArrowUUpLeft, CheckCircle, X } from "@phosphor-icons/react";

interface PlanReviewDialogProps {
  open: boolean;
  /** Last assistant plan text — shown collapsed for reference. */
  planText: string | null;
  /** Confirm execution: exit plan mode and execute the plan. */
  onExecute: () => void;
  /** Send feedback back to the agent (stays in plan mode). */
  onFeedback: (text: string) => void;
  /** Exit plan mode without executing. */
  onExit: () => void;
  onClose: () => void;
  /** True while a feedback round-trip is in flight (agent is running). */
  busy?: boolean;
}

/** Modal shown after a plan-mode run settles. Three ways forward: confirm and
 *  execute the plan, send suggestions back for another plan pass, or leave
 *  plan mode entirely. */
export function PlanReviewDialog({
  open,
  planText,
  onExecute,
  onFeedback,
  onExit,
  onClose,
  busy = false,
}: PlanReviewDialogProps) {
  const { t } = useI18n();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showPlan, setShowPlan] = useState(false);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setFeedbackOpen(false);
    setFeedback("");
    setShowPlan(false);
  }, [open]);

  useEffect(() => {
    if (feedbackOpen) feedbackRef.current?.focus();
  }, [feedbackOpen]);

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13,
    outline: "none", fontFamily: "inherit", resize: "vertical",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1001,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(520px, calc(100vw - 48px))",
        maxHeight: "min(80vh, 640px)",
        overflow: "auto",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {t("tasks.planReviewTitle")}
          </h3>
          <button type="button" onClick={onClose} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 16px 16px" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
            {t("tasks.planReviewDescription")}
          </p>

          {planText ? (
            <div>
              <button
                type="button"
                onClick={() => setShowPlan((v) => !v)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-muted)", fontSize: 12, padding: 0,
                }}
              >
                <ArrowClockwise size={12} aria-hidden="true" style={{ transform: showPlan ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                {showPlan ? t("tasks.planReviewHidePlan") : t("tasks.planReviewShowPlan")}
              </button>
              {showPlan && (
                <div style={{
                  marginTop: 6, maxHeight: 200, overflow: "auto",
                  borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg)", padding: "8px 10px",
                  fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {planText}
                </div>
              )}
            </div>
          ) : null}

          {feedbackOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("tasks.planReviewFeedbackLabel")}
              </label>
              <textarea
                ref={feedbackRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t("tasks.planReviewFeedbackPlaceholder")}
                rows={3}
                style={inputStyle}
              />
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setFeedbackOpen(false);
                onExit();
              }}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 8,
                background: "none", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <ArrowUUpLeft size={13} aria-hidden="true" />
              {t("tasks.planReviewExit")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (feedbackOpen) {
                  if (!feedback.trim()) return;
                  onFeedback(feedback.trim());
                } else {
                  setFeedbackOpen(true);
                }
              }}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 8,
                background: "none", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <ArrowClockwise size={13} aria-hidden="true" />
              {feedbackOpen ? t("tasks.planReviewSendFeedback") : t("tasks.planReviewSuggest")}
            </button>
            <button
              type="button"
              onClick={onExecute}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 16px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <CheckCircle size={13} weight="fill" aria-hidden="true" />
              {t("tasks.planReviewExecute")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
