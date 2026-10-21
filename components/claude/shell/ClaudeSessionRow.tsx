"use client";

/**
 * Claude shell — session row.
 *
 * A **row shell**, the same contract as the pi adapter: the sidebar keeps the
 * row's content and behaviour, this component owns the box. So the tree, the
 * rename input, the archive confirmation and the hover actions are shared,
 * and the two kits can only differ in geometry — which is the point.
 *
 * What differs from pi, and where it comes from:
 *   - no fixed 50px height: the row is content-height with the CDS 30px
 *     minimum from `.claude-session-row` (app/settings-claude.css), so the
 *     list rhythm changes — the single biggest "this is the other kit" signal;
 *   - 8px radius (`--cds-radius`) instead of the pi tree row's 0px;
 *   - the selected state is an inset clay rail plus a secondary fill, not a
 *     2px `border-left`, so the text does not shift when a row is selected;
 *   - 8px content gap and 4px inline margin instead of pi's 6px / flush.
 *
 * The `session-row` class and its state modifiers stay on the node: they are
 * the kit-independent hooks the appended Claude layer and `e2e/kit-switch.mjs`
 * read. The accessible shape is deliberately identical to pi's — a shell may
 * look different, it may not read differently.
 */

import type { SessionRowSlotProps } from "@/components/ui-kit/types";

const INDENT_PX = 12;
const BASE_INDENT_PX = 8;

export function ClaudeSessionRow({
  depth,
  selected,
  running,
  unread,
  armed,
  inert,
  deleting,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  containerRef,
  className,
  children,
}: SessionRowSlotProps) {
  const classes = [
    "session-row",
    selected ? "is-selected" : "",
    running ? "is-running" : "",
    unread ? "is-unread" : "",
    depth > 0 ? "is-fork" : "",
    "claude-session-row",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={containerRef}
      className={classes}
      data-fork-depth={depth}
      data-active={selected || armed ? true : undefined}
      data-claude-row="session"
      onClick={inert ? undefined : onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        paddingLeft: BASE_INDENT_PX + depth * INDENT_PX,
        // The sidebar renders the fork indent guide as an absolutely positioned
        // span inside the row, so the row has to stay the containing block —
        // the pi row got that from its inline `position: relative`.
        position: "relative",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {children}
    </div>
  );
}