"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowClockwise, ArrowUUpLeft, CheckCircle, ListChecks } from "@phosphor-icons/react";

interface PlanReviewDialogProps {
  open: boolean;
  /** Last assistant plan text — kept for execute prompt; no longer previewed inline
   *  because the plan is already in the chat message above. */
  planText: string | null;
  onExecute: () => void;
  onFeedback: (text: string) => void;
  onExit: () => void;
  onClose: () => void;
  busy?: boolean;
}

/**
 * Plan review shelf — inline at the end of the message stream so the user can
 * finish reading the plan (visible above) before choosing an action. Three
 * horizontal compact buttons: 确认执行 (primary) / 提出建议 (opens inline
 * editor above) / 退出计划.
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
  const [planExpanded, setPlanExpanded] = useState(true);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

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

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 12.5,
    outline: "none", fontFamily: "inherit", resize: "vertical",
  };

  return (
    <div
      role="region"
      aria-label={t("tasks.planReviewTitle")}
      style={{
        maxWidth: 820,
        margin: "12px auto 8px",
        border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
        borderRadius: 12,
        background: "var(--bg-panel)",
        animation: "plan-card-in 0.18s ease-out",
        overflow: "hidden",
      }}
    >
      {/* Feedback editor — opens above the buttons when 提出建议 is clicked */}
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

      {/* Finished plan — shown by default so the user can read it right here
          (the plan-mode extension returns it as a tool result that can be
          easy to miss in the collapsed tool card above). */}
      {planText && planText.trim() ? (
        <div style={{ padding: "0 14px 10px" }}>
          <button
            type="button"
            onClick={() => setPlanExpanded((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", padding: "6px 0",
              cursor: "pointer", color: "var(--text-muted)", fontSize: 11.5,
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ transform: planExpanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>›</span>
            {planExpanded ? t("tasks.planReviewHidePlan") : t("tasks.planReviewShowPlan")}
          </button>
          {planExpanded && (
            <div
              style={{
                maxHeight: 320, overflow: "auto",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "10px 12px",
                fontSize: 12.5, lineHeight: 1.65, color: "var(--text)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                fontFamily: "var(--font-mono)",
              }}
            >
              {planText.trim()}
            </div>
          )}
        </div>
      ) : null}

      {/* Three horizontal action buttons + close */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px" }}>
        <ListChecks size={14} weight="fill" color="var(--accent)" aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text)", marginRight: 8, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("tasks.planReviewTitle")}
        </span>

        {/* 确认执行 */}
        <button
          type="button"
          onClick={onExecute}
          disabled={busy}
          title={t("tasks.planReviewExecute")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 12px", borderRadius: 7,
            background: "var(--accent)", color: "#fff",
            border: "none", fontSize: 12, fontWeight: 650,
            cursor: busy ? "not-allowed" : "pointer",
            transition: "opacity 0.12s",
          }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.opacity = "0.88"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          <CheckCircle size={13} weight="fill" aria-hidden="true" />
          {t("tasks.planReviewExecute")}
        </button>

        {/* 提出建议 */}
        <button
          type="button"
          onClick={() => {
            if (feedbackOpen) { setFeedbackOpen(false); return; }
            setFeedbackOpen(true);
            requestAnimationFrame(() => feedbackRef.current?.focus());
          }}
          disabled={busy}
          title={t("tasks.planReviewSuggest")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 10px", borderRadius: 7,
            background: feedbackOpen ? "var(--bg-selected)" : "none",
            border: feedbackOpen ? "1px solid var(--accent)" : "1px solid var(--border)",
            color: feedbackOpen ? "var(--accent)" : "var(--text)",
            fontSize: 12, fontWeight: 550,
            cursor: busy ? "not-allowed" : "pointer",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => { if (!busy && !feedbackOpen) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
          onMouseLeave={(e) => { if (!feedbackOpen) { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text)"; } }}
        >
          <ArrowClockwise size={12} aria-hidden="true" />
          {t("tasks.planReviewSuggest")}
        </button>

        {/* 退出计划 */}
        <button
          type="button"
          onClick={() => {
            setFeedbackOpen(false);
            onExit();
          }}
          disabled={busy}
          title={t("tasks.planReviewExit")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 8px", borderRadius: 7,
            background: "none", border: "none",
            color: "var(--text-muted)", fontSize: 12,
            cursor: busy ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <ArrowUUpLeft size={12} aria-hidden="true" />
          {t("tasks.planReviewExit")}
        </button>

        {/* 关闭（浮动 X，轻量） */}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          title={t("i18n.close")}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", fontSize: 12,
            cursor: busy ? "not-allowed" : "pointer",
            borderRadius: 5,
          }}
          onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
