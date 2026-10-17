"use client";

/**
 * Claude Design System — approval card (slot `approvalCard`).
 *
 * The pi component is a bottom shelf, not a centred modal: a tool call is
 * genuinely suspended on the server while it waits, so the conversation has to
 * stay readable behind it. Every behaviour is carried over unchanged — the
 * ZCode keyboard model (digits answer directly, arrows/Tab move, Enter answers
 * the highlighted row, Escape dismisses as a plain deny), the reset-on-new-request
 * effect, the optional deny reason shared by both deny options, the 4000-char
 * argument cap and the `tool(subject)` rule preview.
 *
 * Only the paint changes: CDS card radius and double-ring elevation, a clay
 * wash on the highlighted row, the destructive row in `--status-error`, and a
 * real focus trap so Tab cannot leave the shelf.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { ApprovalRequestItem } from "@/hooks/useAgentSession";
import { extractSubject } from "@/lib/permission";

type ClaudeApprovalCardProps = SlotPropsMap["approvalCard"];
type ApprovalScope = NonNullable<Parameters<ClaudeApprovalCardProps["onResolve"]>[2]>;

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

export function ClaudeApprovalCard({
  request,
  queuedCount = 0,
  busy = false,
  onResolve,
  onDismiss,
}: ClaudeApprovalCardProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  // pi parity: a new request starts from a clean slate.
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

  const dismiss = useCallback(() => {
    (onDismiss ?? (() => resolve(false, "once", "Dismissed")))();
  }, [onDismiss, resolve]);

  // pi parity, verbatim: digits answer directly, arrows/Tab move, Enter answers
  // the highlighted row, Escape dismisses as a plain deny.
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
      dismiss();
    }
  }, [activeIndex, answer, busy, dismiss, options.length]);

  // Declared before the trap so the highlighted row owns the initial focus and
  // the trap only steps in when focus is still outside the card.
  useEffect(() => {
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex]);

  useFocusTrap(cardRef, Boolean(request) && !busy);

  if (!request) return null;

  const argsText = formatArgs(request.args);
  const argsTruncated = argsText.length > 4000;
  const command = request.args && typeof request.args === "object" && "command" in (request.args as Record<string, unknown>)
    ? String((request.args as Record<string, unknown>).command ?? "")
    : "";
  const alwaysRule = ruleForAlways(request);

  return (
    <div className="cds-approval-layer">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("approval.title")}
        onKeyDown={onKeyDown}
        className="cds-card cds-approval"
      >
        <header className="cds-approval-header">
          <span className="cds-approval-glyph" aria-hidden="true">
            <ShieldCheck size={17} strokeWidth={2} />
          </span>
          <div className="cds-approval-heading">
            <div className="cds-approval-title">
              {t("approval.title")}
              {queuedCount > 0 && (
                <span className="cds-approval-queued">
                  +{queuedCount} {t("approval.queued")}
                </span>
              )}
            </div>
            <div className="cds-approval-subtitle">{t("approval.subtitle")}</div>
          </div>
          <button
            type="button"
            aria-label={t("i18n.close")}
            onClick={dismiss}
            disabled={busy}
            className="cds-icon-button"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="cds-approval-body">
          <div className="cds-approval-toolrow">
            <span className="cds-approval-tool">{request.toolName}</span>
            {command ? <span className="cds-approval-command">{command}</span> : null}
          </div>

          <div className="cds-approval-args">
            <pre className="cds-approval-pre">
              {argsTruncated ? `${argsText.slice(0, 4000)}…` : argsText}
            </pre>
          </div>

          {showReason && (
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("approval.reasonPlaceholder")}
              rows={2}
              className="cds-textarea cds-approval-reason"
            />
          )}
        </div>

        <div role="listbox" aria-label={t("approval.title")} className="cds-approval-options">
          {options.map((option, index) => {
            const active = index === activeIndex;
            const destructive = option.key === "denyAlways";
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
                data-active={active ? "true" : undefined}
                className="cds-approval-option"
              >
                <span className="cds-approval-index" aria-hidden="true">{index + 1}.</span>
                <span className="cds-approval-option-copy">
                  <span className="cds-approval-option-label" data-destructive={destructive ? "true" : undefined}>
                    {t(option.labelKey)}
                  </span>
                  <span className="cds-approval-option-desc">
                    {option.descKey === "approval.allowAlwaysDescription" || option.descKey === "approval.denyAlwaysDescription"
                      ? t(option.descKey, { rule: alwaysRule })
                      : t(option.descKey)}
                  </span>
                </span>
                {option.scopeKey && (
                  <span className="cds-approval-scope">{t(option.scopeKey)}</span>
                )}
              </button>
            );
          })}
        </div>

        <footer className="cds-approval-footer">
          <span className="cds-approval-hint">{t("approval.keyboardHint")}</span>
          <button
            type="button"
            onClick={() => {
              setShowReason((value) => !value);
              if (!showReason) requestAnimationFrame(() => reasonRef.current?.focus());
            }}
            disabled={busy}
            className="cds-link-button"
          >
            {showReason ? t("approval.hideReason") : t("approval.denyWithReason")}
          </button>
        </footer>
      </div>
    </div>
  );
}
