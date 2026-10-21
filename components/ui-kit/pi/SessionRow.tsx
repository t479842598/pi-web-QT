"use client";

import type { SessionRowSlotProps } from "@/components/ui-kit/types";

/**
 * pi session row — the box the sidebar's inline markup used to own.
 *
 * Fidelity contract: this renders EXACTLY what `SessionItem` (fork tree) and
 * `SessionCompactRow` (grouped accordion) declared inline before the slot
 * existed, declaration for declaration, in the same key order, because React
 * emits the `style` attribute in insertion order. The row's *content* stays in
 * the sidebar; only the box moved here.
 *
 * The two variants genuinely differ in pi geometry — the tree row is a fixed
 * 50px single-line box with a 0px radius fallback, the group row is a
 * two-line column with 6px — so `variant` is part of the contract instead of a
 * default the caller has to remember.
 *
 * Surfaces are read through `--session-row-*` variables rather than declared
 * as literals: an inline `background` would beat every stylesheet, while an
 * inline `var()` reference loses to whoever sets the variable on an ancestor.
 * That is how a kit restates the row without `!important`.
 */

/** Tree row height. The sidebar measures its list against this value. */
const TREE_ITEM_HEIGHT = 50;

function rowClasses({ depth, selected, running, unread, className }: SessionRowSlotProps) {
  return [
    "session-row",
    selected ? "is-selected" : "",
    running ? "is-running" : "",
    unread ? "is-unread" : "",
    depth > 0 ? "is-fork" : "",
    className,
  ].filter(Boolean).join(" ");
}

export function PiSessionRow(props: SessionRowSlotProps) {
  // running/unread reach the class string through rowClasses(props), so they
  // are not destructured here.
  const {
    variant, depth, selected, hovered, armed, inert, deleting,
    onSelect, onMouseEnter, onMouseLeave, containerRef,
  } = props;

  const className = rowClasses(props);
  // Exactly the old condition: the archive confirmation pins the selected
  // surface, a rename does not.
  const lit = Boolean(armed) || selected;
  const surface = lit
    ? "var(--session-row-bg-selected, var(--bg-selected))"
    : hovered ? "var(--session-row-bg-hover, var(--bg-hover))" : "transparent";
  const rail = lit
    ? "2px solid var(--session-row-accent, var(--accent))"
    : "2px solid transparent";

  if (variant === "tree") {
    return (
      <div
        ref={containerRef}
        className={className}
        data-fork-depth={depth}
        onClick={inert ? undefined : onSelect}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          height: "var(--session-row-height, " + TREE_ITEM_HEIGHT + "px)",
          minHeight: "var(--session-row-height, " + TREE_ITEM_HEIGHT + "px)",
          display: "flex",
          alignItems: "center",
          paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
          paddingRight: 8,
          cursor: inert ? "default" : "pointer",
          background: surface,
          borderLeft: rail,
          borderRadius: "var(--session-row-radius, 0)",
          transition: "background 0.1s",
          opacity: deleting ? 0.5 : 1,
          gap: 6,
          overflow: "hidden",
        }}
      >
        {props.children}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      data-fork-depth={depth}
      onClick={inert ? undefined : onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "5px 8px 5px 10px",
        paddingLeft: 10 + depth * 14,
        position: "relative",
        cursor: inert ? "default" : "pointer",
        background: surface,
        borderLeft: rail,
        borderRadius: "var(--session-row-radius, 6px)",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {props.children}
    </div>
  );
}