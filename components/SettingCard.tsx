"use client";

import type { ReactNode } from "react";

/** Claude Design System card: one closed 0.5px hairline, 12px radius, card
 *  surface. Rows are separated by an inset hairline on the row that follows a
 *  sibling (see `app/settings-claude.css`), so a card never draws a second
 *  border around itself and the last row needs no suppression. */
export function SettingCard({ children }: { children: ReactNode }) {
  return <div className="settings-panel is-bare settings-card">{children}</div>;
}

/** Row inside a SettingCard — title left, control right, hairline above every
 *  row that follows another. */
export function SettingRow({ children }: { children: ReactNode }) {
  return <div className="settings-row">{children}</div>;
}

/** Final row inside a SettingCard. The divider comes from the adjacent-sibling
 *  rule, so `is-last` only records the intent for callers that nest a note. */
export function SettingRowLast({ children }: { children: ReactNode }) {
  return <div className="settings-row is-last">{children}</div>;
}

/** An explanatory block on its own surface — a clay rule and a clay-tinted
 *  fill rather than a box, so it reads as a note and not as another control. */
export function SettingNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="settings-row is-stacked settings-note"
      style={{
        gap: 8,
        // A note carries prose, not a single token: it must wrap inside the
        // card instead of widening it. `minWidth: 0` is what lets a flex item
        // shrink below its content's intrinsic width, and the CJK text has no
        // spaces to break at without `overflowWrap`.
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </div>
  );
}
