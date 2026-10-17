"use client";

/**
 * Claude Design System — dialog shell (slot `dialogShell`).
 *
 * Same contract and behaviour as `ConfigPanelShell` in the pi tree: Escape
 * closes unless the panel is embedded, an embedded panel is a plain region and
 * a modal one is a labelled `role="dialog"` with `aria-modal`. What changes is
 * the frame — a 16px card with the CDS double-ring popover shadow, a blurred
 * translucent veil, a compact header with a ghost icon close — plus the focus
 * trap the pi shell never had (Tab cycles inside, focus returns to the opener).
 *
 * The inner panels (`AgentsConfig` and friends) keep their own
 * `settings-content-*` spacing classes: those belong to the settings page, so
 * this shell only redraws the frame around them.
 */

import { useRef, type CSSProperties } from "react";
import { X } from "lucide-react";

import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";

type ClaudeDialogShellProps = SlotPropsMap["dialogShell"];

export function ClaudeDialogShell({
  embedded,
  title,
  subtitle,
  closeLabel = "Close",
  onClose,
  children,
  width = 900,
  height = "78vh",
}: ClaudeDialogShellProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  // pi parity: Escape is the close affordance, and an embedded panel lives
  // inside the settings page, which owns Escape there.
  useEscapeKey(!embedded, onClose);
  useFocusTrap(surfaceRef, !embedded);

  const panelStyle = embedded
    ? undefined
    : ({
        "--cds-dialog-width": `${width}px`,
        "--cds-dialog-height": height,
        // Kept in step with the pi shell's own variables so any pi-tree rule
        // that still reads them sees the same geometry.
        "--config-panel-width": `${width}px`,
        "--config-panel-height": height,
      } as CSSProperties);

  return (
    <div
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={title}
      data-cds="DialogShell"
      data-embedded={embedded ? "true" : undefined}
      className={`cds-overlay config-panel-root settings-content-panel${embedded ? " is-embedded cds-overlay-embedded" : " is-modal"}`}
    >
      <div
        ref={surfaceRef}
        tabIndex={-1}
        data-claude-focus-anchor="true"
        className="cds-card cds-dialog config-panel-surface settings-content-surface"
        style={panelStyle}
      >
        {!embedded && (
          <header className="cds-dialog-header">
            <div className="cds-dialog-heading">
              <strong className="cds-dialog-title">{title}</strong>
              {subtitle && (
                <code className="cds-dialog-subtitle" title={subtitle}>
                  {subtitle}
                </code>
              )}
            </div>
            <button
              type="button"
              className="cds-icon-button"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
