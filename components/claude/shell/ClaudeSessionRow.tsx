"use client";

/**
 * Claude shell — session row.
 *
 * The pi row is inline markup inside SessionSidebar; this is the slot
 * implementation declared by SessionRowSlotProps. It is presentational only:
 * click, context menu, trailing actions and metadata all come in as props, so
 * the tree, drag/rename/delete behaviour and the @-mention wiring stay in the
 * pi sidebar untouched.
 *
 * Geometry: 8px radius, 30px row, depth indent on the leading edge. The active
 * row uses the CDS secondary fill plus a clay rail instead of a full accent
 * wash, so a 40-row list does not turn into a block of colour.
 */

import type { SessionRowSlotProps } from "@/components/ui-kit/types";

const INDENT_PX = 12;
const BASE_INDENT_PX = 8;

export function ClaudeSessionRow({
  title,
  subtitle,
  active,
  running = false,
  unread = false,
  depth = 0,
  onClick,
  onContextMenu,
  actions,
  meta,
  className,
}: SessionRowSlotProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-claude-row="session"
      data-active={active || undefined}
      aria-current={active ? "true" : undefined}
      className={["claude-session-row", className].filter(Boolean).join(" ")}
      style={{ paddingLeft: BASE_INDENT_PX + depth * INDENT_PX }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      }}
    >
      <span
        className={"claude-session-dot" + (running ? " is-running" : unread ? " is-unread" : "")}
        aria-hidden="true"
      />
      <span className="claude-session-body">
        <span className="claude-row-title" title={title}>{title}</span>
        {subtitle && <span className="claude-session-subtitle">{subtitle}</span>}
      </span>
      {meta && <span className="claude-session-meta">{meta}</span>}
      {actions && <span className="claude-session-actions">{actions}</span>}
    </div>
  );
}
