"use client";

/**
 * pi kit — Field.
 *
 * `.field-input` (app/settings.css) is the real input shell the settings pages
 * render today: borderless inset fill, `--ds-field-height`, accent glow on
 * focus. The adapter only forwards it, adds `size="sm"` as the control-height
 * row and paints the error ring from the semantic token.
 */

import type { CSSProperties } from "react";

import type { FieldSlotProps } from "../types";

export function PiField({ size = "md", invalid, className, style, ...props }: FieldSlotProps) {
  const merged: CSSProperties = { ...style };
  if (size === "sm") merged.height = "var(--cds-control-height, var(--ds-field-height))";
  if (invalid) merged.boxShadow = "inset 0 0 0 1px var(--status-error)";

  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={["field-input", className].filter(Boolean).join(" ")}
      style={merged}
    />
  );
}
