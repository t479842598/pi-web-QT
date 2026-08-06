"use client";

import type { ReactNode } from "react";

/** Bordered surface that groups related settings rows. Rows stacked inside one
 *  card get a hairline between them, which is what makes options that belong
 *  together read as one decision instead of two unrelated lines. */
export function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg-panel) 55%, transparent)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** Hairline-separated row inside a SettingCard. */
export function SettingRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "0 14px" }}>
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        {children}
      </div>
    </div>
  );
}

/** Final row inside a SettingCard — no trailing hairline. */
export function SettingRowLast({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "0 14px" }}>{children}</div>
  );
}

/** An explanatory block on the same surface as the cards around it — for the
 *  context a row's own description can't carry. */
export function SettingNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg-panel) 55%, transparent)",
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
