"use client";

/**
 * Claude Design System — field.
 *
 * Also hand-written: upstream has no input primitive. Spec applied from
 * `cds-theme.css`'s control ladder — 32px height (`--cds-control-height-lg`,
 * 28px at `sm`), `var(--cds-radius)`, a surface fill and the hairline drawn as
 * an inset shadow rather than a border, so focus can recolour the same ring in
 * clay instead of adding a second one.
 */

import type { CSSProperties } from "react";

import type { FieldSlotProps } from "@/components/ui-kit/types";

const MOTION = "duration-[var(--cds-dur-fast)] ease-[var(--cds-ease-swift)]";

export function CdsField({ size = "md", invalid, className, style, ...props }: FieldSlotProps) {
  const error: CSSProperties = invalid
    ? { boxShadow: "inset 0 0 0 1px var(--status-error)" }
    : {};

  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      data-cds="Field"
      className={[
        "w-full rounded-[var(--cds-radius)] border-0 bg-[var(--cds-fill-secondary)] px-2.5",
        "text-[13px] text-[var(--text)] outline-none",
        "shadow-[inset_0_0_0_1px_var(--cds-hairline-1)]",
        "transition-[box-shadow,background-color]",
        MOTION,
        "placeholder:text-[var(--text-dim)]",
        size === "sm" ? "h-7" : "h-8",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...style, ...error }}
    />
  );
}
