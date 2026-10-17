"use client";

/**
 * Claude Design System — toggle.
 *
 * Upstream ships no toggle, so this is hand-written to the CDS switch spec: a
 * 34x20 track, a 16px knob, accent fill when on and a neutral surface fill when
 * off, 1px inset hairline instead of a border. The knob travels with a
 * transform (`--cds-dur-fast` + `--cds-ease-swift`), never with `left`.
 */

import type { ToggleSlotProps } from "@/components/ui-kit/types";

const MOTION = "duration-[var(--cds-dur-fast)] ease-[var(--cds-ease-swift)]";

export function CdsToggle({ checked, onChange, disabled, ariaLabel, id, className }: ToggleSlotProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-cds="Switch"
      className={[
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full border-0 p-0",
        "shadow-[inset_0_0_0_1px_var(--cds-hairline-1)] transition-colors",
        MOTION,
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-clay" : "bg-[var(--cds-fill-secondary)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none block size-4 rounded-full bg-[var(--bg-panel)]",
          "shadow-[0_1px_2px_var(--cds-shadow-tint)] transition-transform",
          MOTION,
          checked ? "translate-x-[15px]" : "translate-x-[1px]",
        ].join(" ")}
      />
    </button>
  );
}
