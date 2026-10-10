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
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--text-muted)",
      }}
    >
      {children}
    </div>
  );
}
