"use client";

import type { ReactNode } from "react";

/** Border-free tile surface that groups related settings rows. Each row inside
 *  is its own soft tile separated by a gap, so options that belong together
 *  read as one decision without a hairline between them. */
export function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="settings-panel is-bare">
      {children}
    </div>
  );
}

/** Tile row inside a SettingCard. */
export function SettingRow({ children }: { children: ReactNode }) {
  return <div className="settings-row">{children}</div>;
}

/** Final row inside a SettingCard — kept in the API for callers; the tile
 *  layout has no trailing hairline to suppress, so it renders like SettingRow. */
export function SettingRowLast({ children }: { children: ReactNode }) {
  return <div className="settings-row">{children}</div>;
}

/** An explanatory block on the same surface as the cards around it — for the
 *  context a row's own description can't carry. */
export function SettingNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="settings-row is-stacked"
      style={{
        gap: 8,
        padding: "10px 12px",
        // A note carries prose, not a single token: it must wrap inside the
        // card instead of widening it. `minWidth: 0` is what lets a flex item
        // shrink below its content's intrinsic width, and the CJK text has no
        // spaces to break at without `overflowWrap`.
        minWidth: 0,
        overflowWrap: "anywhere",
        fontSize: 'var(--text-ui-sm)',
        lineHeight: 1.5,
        color: "var(--ds-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
