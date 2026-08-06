"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ApprovalRequestItem } from "@/hooks/useAgentSession";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { XIcon } from "@phosphor-icons/react/X";

// ============================================================================
// ApprovalModal — shown when the agent calls a write-class tool in ask mode.
// The tool call is genuinely suspended on the server (beforeToolCall hook)
// until the user picks Allow (runs) or Deny (blocked error back to the agent).
// ============================================================================

interface ApprovalModalProps {
  /** The approval request to display (only the first is interactive). */
  request: ApprovalRequestItem | null;
  /** Extra queued requests behind the active one (count badge). */
  queuedCount?: number;
  busy?: boolean;
  onResolve: (approve: boolean, reason?: string) => void;
}

function formatArgs(args: unknown): string {
  if (args === null || args === undefined) return "{}";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function ApprovalModal({ request, queuedCount = 0, busy = false, onResolve }: ApprovalModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [showReason, setShowReason] = useState(false);

  useEffect(() => {
    if (request) {
      setReason("");
      setShowReason(false);
    }
  }, [request?.id]);

  if (!request) return null;

  const argsText = formatArgs(request.args);
  const argsTruncated = argsText.length > 4000;

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0,
        bottom: 130,
        zIndex: 1300,
        display: "flex", justifyContent: "center",
        pointerEvents: "none",
        padding: "0 14px",
      }}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label="工具调用审批"
        style={{
          pointerEvents: "auto",
          width: "min(380px, 100%)",
          maxHeight: "min(60vh, 400px)",
          display: "flex", flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid color-mix(in srgb, #f59e0b 32%, var(--border))",
          borderRadius: 12,
          boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
          animation: "plan-card-in 0.18s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
          <ShieldCheckIcon size={18} weight="fill" color="var(--accent)" aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--text)" }}>
              {t("approval.title")}
              {queuedCount > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>
                  +{queuedCount} {t("approval.queued")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>
              {t("approval.subtitle")}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("i18n.close")}
            onClick={() => onResolve(false, "Dismissed")}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none", border: "none", borderRadius: 6,
              color: "var(--text-muted)", cursor: busy ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
          {/* Tool badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "3px 10px", borderRadius: 6,
              background: "var(--bg-selected)",
              color: "var(--text)",
              fontSize: 12.5, fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}>
              {request.toolName}
            </span>
            {request.args && typeof request.args === "object" && "command" in (request.args as Record<string, unknown>) ? (
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {String((request.args as Record<string, unknown>).command ?? "")}
              </span>
            ) : null}
          </div>

          {/* Args preview */}
          <div style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            maxHeight: 220,
            overflow: "auto",
          }}>
            <pre style={{
              margin: 0, fontSize: 11.5, lineHeight: 1.55,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {argsTruncated ? `${argsText.slice(0, 4000)}\n…` : argsText}
            </pre>
          </div>

          {/* Deny reason (optional) */}
          {showReason && (
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("approval.reasonPlaceholder")}
              rows={2}
              style={{
                width: "100%", marginTop: 10,
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 10px",
                color: "var(--text)", fontSize: 12.5,
                outline: "none", fontFamily: "inherit", resize: "vertical",
              }}
            />
          )}
        </div>

        {/* Three stacked actions: 上=允许, 中=附理由拒绝, 下=拒绝 */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
        }}>
          {/* 上: 允许 */}
          <button
            type="button"
            onClick={() => onResolve(true)}
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
            <CheckIcon size={14} weight="bold" aria-hidden="true" />
            {t("approval.allow")}
          </button>

          {/* 中: 附理由拒绝（展开填写框） */}
          <button
            type="button"
            onClick={() => { setShowReason((v) => !v); if (!showReason) requestAnimationFrame(() => reasonRef.current?.focus()); }}
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
            <XIcon size={13} aria-hidden="true" />
            {showReason ? t("approval.hideReason") : t("approval.denyWithReason")}
          </button>

          {/* 下: 拒绝 */}
          <button
            type="button"
            onClick={() => onResolve(false, reason.trim() || undefined)}
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
            {t("approval.deny")}
          </button>
        </div>
      </div>
    </div>
  );
}