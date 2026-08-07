"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowClockwise, ArrowUUpLeft, CheckCircle, X, ListChecks } from "@phosphor-icons/react";

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

/**
 * Plan review shelf — mirrors Reasonix's PromptShelf: a centered card floating
 * above the composer with three vertically stacked actions:
 *   1. 开始执行 (primary)
 *   2. 提出建议 (opens an inline editor at the top of the card)
 *   3. 退出计划
 */
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
    borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 12.5,
    outline: "none", fontFamily: "inherit", resize: "vertical",
  };

  // Position the card above the composer, centered horizontally.
  const composerOffset = typeof window !== "undefined" ? 130 : 130;

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0,
        bottom: composerOffset,
        zIndex: 1001,
        display: "flex", justifyContent: "center",
        pointerEvents: "none",
        padding: "0 14px",
      }}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t("tasks.planReviewTitle")}
        style={{
          pointerEvents: "auto",
          width: "min(360px, 100%)",
          background: "var(--bg-panel)",
          border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
          borderRadius: 12,
          boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
          animation: "plan-card-in 0.18s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}>
          <ListChecks size={15} weight="fill" color="var(--accent)" aria-hidden="true" />
          <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--text)", flex: 1 }}>
            {t("tasks.planReviewTitle")}
          </span>
          {planText ? (
            <button
              type="button"
              onClick={() => setShowPlan((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text-muted)", fontSize: 11.5, padding: "3px 6px",
                borderRadius: 6,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <ArrowClockwise size={12} aria-hidden="true" style={{ transform: showPlan ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              {showPlan ? t("tasks.planReviewHidePlan") : t("tasks.planReviewShowPlan")}
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 3, display: "flex", borderRadius: 5 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Feedback editor — always at the top of the card when open */}
        {feedbackOpen && (
          <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--border)" }}>
            <label style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {t("tasks.planReviewFeedbackLabel")}
            </label>
            <textarea
              ref={feedbackRef}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t("tasks.planReviewFeedbackPlaceholder")}
              rows={2}
              style={inputStyle}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                onClick={() => setFeedbackOpen(false)}
                disabled={busy}
                style={{
                  padding: "5px 10px", borderRadius: 6,
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 11.5, cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {t("i18n.cancel")}
              </button>
              <button
                type="button"
                onClick={() => { if (feedback.trim()) onFeedback(feedback.trim()); }}
                disabled={busy || !feedback.trim()}
                style={{
                  padding: "5px 12px", borderRadius: 6,
                  background: "var(--accent)", color: "#fff",
                  border: "none", fontSize: 11.5, fontWeight: 600,
                  cursor: busy || !feedback.trim() ? "not-allowed" : "pointer",
                }}
              >
                {t("tasks.planReviewSendFeedback")}
              </button>
            </div>
          </div>
        )}

        {/* Plan preview */}
        {showPlan && planText && (
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{
              maxHeight: 140, overflow: "auto",
              borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg)", padding: "8px 10px",
              fontSize: 11.5, lineHeight: 1.5, color: "var(--text-muted)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {planText}
            </div>
          </div>
        )}

        {/* Three stacked actions: 上=执行, 中=建议, 下=退出 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px" }}>
          {/* 上: 开始执行 */}
          <button
            type="button"
            onClick={onExecute}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", padding: "9px 14px", borderRadius: 8,
              background: "var(--accent)", color: "#fff",
              border: "none", fontSize: 12.5, fontWeight: 650,
              cursor: busy ? "not-allowed" : "pointer",
              transition: "opacity 0.12s",
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.opacity = "0.88"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            <CheckCircle size={14} weight="fill" aria-hidden="true" />
            {t("tasks.planReviewExecute")}
          </button>

          {/* 中: 提出建议 */}
          <button
            type="button"
            onClick={() => {
              if (feedbackOpen) return;
              setFeedbackOpen(true);
              requestAnimationFrame(() => feedbackRef.current?.focus());
            }}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", padding: "9px 14px", borderRadius: 8,
              background: "none", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 12.5, fontWeight: 550,
              cursor: busy ? "not-allowed" : "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            <ArrowClockwise size={13} aria-hidden="true" />
            {t("tasks.planReviewSuggest")}
          </button>

          {/* 下: 退出计划 */}
          <button
            type="button"
            onClick={() => {
              setFeedbackOpen(false);
              onExit();
            }}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", padding: "8px 14px", borderRadius: 8,
              background: "none", border: "none",
              color: "var(--text-muted)", fontSize: 12,
              cursor: busy ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <ArrowUUpLeft size={13} aria-hidden="true" />
            {t("tasks.planReviewExit")}
          </button>
        </div>
      </div>
    </div>
  );
}
