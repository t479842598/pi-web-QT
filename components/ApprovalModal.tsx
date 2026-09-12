"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ApprovalRequestItem } from "@/hooks/useAgentSession";
import { extractSubject } from "@/lib/permission";
import { XIcon } from "@phosphor-icons/react/X";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";

// ============================================================================
// ApprovalModal — shown when the agent calls a write-class tool in ask mode.
// The tool call is genuinely suspended on the server (beforeToolCall hook)
// until the user picks Allow (runs) or Deny (blocked error back to the agent).
//
// Layout and keyboard model follow ZCode's permission dialog: a numbered option
// list (1..N), arrow/Tab movement, Enter to answer, digits to answer directly.
// Colors come from pi-web's own theme tokens — ZCode contributes structure only
// (see docs/web-mobile-style-reference.md).
// ============================================================================

export type ApprovalScope = "once" | "always";

interface ApprovalModalProps {
  /** The approval request to display (only the first is interactive). */
  request: ApprovalRequestItem | null;
  /** Extra queued requests behind the active one (count badge). */
  queuedCount?: number;
  busy?: boolean;
  onResolve: (approve: boolean, reason?: string, scope?: ApprovalScope) => void;
  /** Escape / the close button: treat as a plain deny rather than a decision. */
  onDismiss?: () => void;
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

/** The literal rule that "always" writes, e.g. `Bash(command:ls)` or `Write(/a.md)`. */
function ruleForAlways(request: ApprovalRequestItem): string {
  const subject = extractSubject(request.toolName, request.args);
  return subject ? `${request.toolName}(${subject})` : request.toolName;
}

type Option = {
  key: "allowOnce" | "allowAlways" | "denyOnce" | "denyAlways";
  labelKey: string;
  descKey: string;
  /** Scope suffix shown on the right (what the choice remembers). */
  scopeKey?: string;
  run: (reason?: string) => void;
};

export function ApprovalModal({ request, queuedCount = 0, busy = false, onResolve, onDismiss }: ApprovalModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (request) {
      setReason("");
      setShowReason(false);
      setActiveIndex(0);
    }
  }, [request?.id]);

  const resolve = useCallback((approve: boolean, scope: ApprovalScope, extraReason?: string) => {
    onResolve(approve, extraReason, scope);
  }, [onResolve]);

  const options: Option[] = request ? [
    {
      key: "allowOnce",
      labelKey: "approval.allow",
      descKey: "approval.allowOnceDescription",
      run: () => resolve(true, "once"),
    },
    {
      key: "allowAlways",
      labelKey: "approval.allowAlways",
      descKey: "approval.allowAlwaysDescription",
      scopeKey: "approval.scopeAlways",
      run: () => resolve(true, "always"),
    },
    {
      key: "denyOnce",
      labelKey: "approval.deny",
      descKey: "approval.denyOnceDescription",
      run: (r) => resolve(false, "once", r?.trim() || undefined),
    },
    {
      key: "denyAlways",
      labelKey: "approval.denyAlways",
      descKey: "approval.denyAlwaysDescription",
      scopeKey: "approval.scopeAlways",
      run: (r) => resolve(false, "always", r?.trim() || undefined),
    },
  ] : [];

  const answer = useCallback((index: number) => {
    const option = options[index];
    if (!option) return;
    option.run(reason);
  }, [options, reason]);

  // ZCode's keyboard model: digits answer directly, arrows/Tab move, Enter
  // answers the highlighted row. Escape dismisses (pi-web convention).
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (busy) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      event.preventDefault();
      answer(digit - 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      answer(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      (onDismiss ?? (() => resolve(false, "once", "Dismissed")))();
    }
  }, [activeIndex, answer, busy, onDismiss, options.length, resolve]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  if (!request) return null;

  const argsText = formatArgs(request.args);
  const argsTruncated = argsText.length > 4000;
  const command = request.args && typeof request.args === "object" && "command" in (request.args as Record<string, unknown>)
    ? String((request.args as Record<string, unknown>).command ?? "")
    : "";
  const alwaysRule = ruleForAlways(request);

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
        aria-modal="true"
        aria-label={t("approval.title")}
        onKeyDown={onKeyDown}
        style={{
          pointerEvents: "auto",
          width: "min(420px, 100%)",
          maxHeight: "min(70vh, 520px)",
          display: "flex", flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
          animation: "plan-card-in 0.18s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px 12px",
        }}>
          <ShieldCheckIcon size={18} weight="fill" color="var(--accent-orange, #f59e0b)" aria-hidden="true" />
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
            onClick={() => (onDismiss ?? (() => resolve(false, "once", "Dismissed")))()}
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

        {/* Body: tool + args */}
        <div style={{ padding: "0 16px", overflowY: "auto", flex: 1 }}>
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
            {command ? (
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {command}
              </span>
            ) : null}
          </div>

          <div style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            maxHeight: 180,
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

          {/* Deny reason (optional, shared by both deny options) */}
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

        {/* Numbered options (ZCode: 1..N, hover/active highlight, scope on the right) */}
        <div role="listbox" aria-label={t("approval.title")} style={{
          display: "flex", flexDirection: "column", gap: 4,
          padding: "12px 12px 4px",
        }}>
          {options.map((option, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={option.key}
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                disabled={busy}
                onClick={() => answer(index)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "8px 10px",
                  background: active ? "var(--bg-selected)" : "none",
                  border: "none", borderRadius: 10,
                  cursor: busy ? "not-allowed" : "pointer",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
              >
                <span style={{
                  width: 18, flexShrink: 0,
                  color: active ? "var(--text)" : "var(--text-dim)",
                  fontSize: 12.5, fontWeight: 600,
                }}>
                  {index + 1}.
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: "block", fontSize: 12.5, fontWeight: 600,
                    color: option.key === "denyAlways" ? "var(--status-error)" : "var(--text)",
                  }}>
                    {t(option.labelKey)}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 1, lineHeight: 1.4 }}>
                    {option.descKey === "approval.allowAlwaysDescription" || option.descKey === "approval.denyAlwaysDescription"
                      ? t(option.descKey, { rule: alwaysRule })
                      : t(option.descKey)}
                  </span>
                </span>
                {option.scopeKey && (
                  <span style={{
                    flexShrink: 0, fontSize: 10.5, color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t(option.scopeKey)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer: keyboard hint + reason toggle */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "8px 16px 12px",
        }}>
          <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
            {t("approval.keyboardHint")}
          </span>
          <button
            type="button"
            onClick={() => { setShowReason((v) => !v); if (!showReason) requestAnimationFrame(() => reasonRef.current?.focus()); }}
            disabled={busy}
            style={{
              background: "none", border: "none", padding: "4px 6px",
              color: "var(--text-muted)", fontSize: 11,
              cursor: busy ? "not-allowed" : "pointer",
              textDecoration: "underline",
            }}
          >
            {showReason ? t("approval.hideReason") : t("approval.denyWithReason")}
          </button>
        </div>
      </div>
    </div>
  );
}
