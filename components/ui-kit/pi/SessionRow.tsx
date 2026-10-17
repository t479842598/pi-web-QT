"use client";

import type { MouseEvent } from "react";

import { RunningSessionIndicator, UnreadSessionIndicator } from "@/components/sidebar/session-indicators";
import { sessionDisplayTitle } from "@/lib/session-display-title";
import type { SessionRowSlotProps } from "@/components/ui-kit/types";

/**
 * pi session row.
 *
 * `SessionSidebar` renders its rows inline, so there was no pi component to
 * point the registry at. This adapter reproduces that markup — the same title
 * clamp, the same running/unread indicators, the same indent step — so the
 * `sessionRow` slot has a honest pi side instead of a null.
 *
 * It is deliberately presentational: selection, context menu, and the action
 * affordances all arrive as props from the sidebar that owns the tree.
 */

export function PiSessionRow({
  title,
  subtitle,
  active,
  running,
  unread,
  depth = 0,
  onClick,
  onContextMenu,
  actions,
  meta,
  className,
}: SessionRowSlotProps) {
  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    onContextMenu?.(event);
  };

  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={className}
      data-session-row
      data-depth={depth}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        // One indent step per depth level, matching the tree in SessionSidebar.
        padding: `6px 8px 6px ${8 + depth * 12}px`,
        borderRadius: "var(--cds-radius, 8px)",
        background: active ? "var(--cds-fill-secondary, var(--bg-selected))" : "transparent",
        color: active ? "var(--cds-text-primary, var(--text))" : "var(--cds-text-secondary, var(--text-muted))",
        cursor: "pointer",
        fontSize: "var(--text-ui-caption)",
      }}
    >
      {(running || unread) && (
        <span style={{ display: "inline-flex", flexShrink: 0 }}>
          {running ? <RunningSessionIndicator /> : <UnreadSessionIndicator />}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: active ? 500 : 400,
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--text-ui-xs)",
              color: "var(--cds-text-faint, var(--text-dim))",
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {meta && <span style={{ flexShrink: 0 }}>{meta}</span>}
      {actions && <span style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}>{actions}</span>}
    </div>
  );
}

/** Kept for parity with the sidebar's own naming. */
export const sessionRowTitle = sessionDisplayTitle;
