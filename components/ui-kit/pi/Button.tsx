"use client";

/**
 * pi kit — Button.
 *
 * The pi column must stay byte-for-byte today's UI, so this is a pure
 * translation layer onto `ConfigButton` (components/SettingsUi.tsx): the
 * contract's five variants collapse onto its four, the six sizes onto its two.
 *
 * `icon` / `iconPosition` / `loading` exist in the contract because the CDS
 * button has them; ConfigButton has neither an icon slot nor a spinner. Rather
 * than drop the icon it is inlined around the label in the requested order —
 * no pi call site passes one today, so nothing on screen changes, and a future
 * caller keeps its glyph. `loading` surfaces only as `aria-busy`: adding a
 * spinner to pi buttons is exactly the visual change this adapter must not make.
 */

import { ConfigButton } from "@/components/SettingsUi";

import type { ButtonSlotProps } from "../types";

type PiVariant = "primary" | "secondary" | "danger" | "ghost";
type PiSize = "small" | "default";

const VARIANT: Record<NonNullable<ButtonSlotProps["variant"]>, PiVariant> = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger",
  // pi ships no bordered button; the neutral fill is the closest existing look.
  outline: "secondary",
};

const SIZE: Record<NonNullable<ButtonSlotProps["size"]>, PiSize> = {
  xxs: "small",
  xs: "small",
  sm: "small",
  md: "default",
  lg: "default",
  icon: "small",
};

export function PiButton({
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "left",
  loading,
  className,
  children,
  ...props
}: ButtonSlotProps) {
  return (
    <ConfigButton
      {...props}
      variant={VARIANT[variant]}
      size={SIZE[size]}
      className={className}
      aria-busy={loading || undefined}
    >
      {icon && iconPosition === "left" ? icon : null}
      {children}
      {icon && iconPosition === "right" ? icon : null}
    </ConfigButton>
  );
}
