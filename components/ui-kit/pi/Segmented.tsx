"use client";

/**
 * pi kit — Segmented.
 *
 * Reproduces `.settings-segmented` exactly as `components/FontSizeRow.tsx`
 * renders it today: a `role="group"` track of `aria-pressed` buttons with no
 * wrapper per item. The contract's `size` is deliberately not read — pi has a
 * single segmented density, so honouring it would be a visual change.
 */

import type { SegmentedSlotProps } from "../types";

export function PiSegmented({ items, value, onChange, ariaLabel, className }: SegmentedSlotProps) {
  return (
    <div
      className={["settings-segmented", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          {item.label}
          {item.badge !== undefined ? <span>{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
