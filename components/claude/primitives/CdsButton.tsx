"use client";

/**
 * Claude Design System — button.
 *
 * Adapted from open-claude-ui `code-examples/CdsButton.tsx` (MIT, see
 * ../../vendor/NOTICE.md). The upstream size ladder (20/24/28/32/40 and radius
 * 6/8/10/12), the 1-border rule (a `Secondary` button inside a card carries no
 * border, only a surface fill) and the outer-shell / inner-paint split are kept.
 *
 * What changed: framer-motion is gone (MotionProvider is `LazyMotion strict`,
 * and these buttons need no motion library at all), every colour now comes from
 * the theme's `--cds-*` / semantic tokens instead of the Tailwind neutral
 * palette or raw literals, and the press squish is the plain
 * `active:scale-[0.98]` transform the brief asks for rather than the
 * upstream 15-step `linear()` spring.
 */

import type { ButtonSlotProps } from "@/components/ui-kit/types";

const SIZE: Record<NonNullable<ButtonSlotProps["size"]>, string> = {
  xxs: "h-5 gap-1 rounded-[6px] px-1.5 text-[11px]",
  xs: "h-6 gap-1 rounded-[6px] px-2 text-[11.5px]",
  sm: "h-7 gap-1.5 rounded-[8px] px-2.5 text-xs",
  md: "h-8 gap-1.5 rounded-[8px] px-3.5 text-sm",
  lg: "h-10 gap-2 rounded-[12px] px-5 text-[15px] font-medium",
  icon: "size-8 rounded-[8px] p-0",
};

/**
 * root paints the button itself: its text colour and the colour of the 1px
 * frame. paint fills the inner layer. The 1-Border Rule lives here — every
 * variant except outline sets border-transparent, so the frame stays a layout
 * constant and outline is the only variant that ever shows it.
 */
interface VariantPaint {
  root: string;
  paint: string;
}

const VARIANT: Record<NonNullable<ButtonSlotProps["variant"]>, VariantPaint> = {
  primary: {
    root: "border-transparent text-[var(--accent-fg)] font-medium",
    paint: "bg-clay group-hover/btn:bg-clay-hover",
  },
  // The CDS default: surface fill, no border.
  secondary: {
    root: "border-transparent text-[var(--text)] font-normal",
    paint: "bg-[var(--cds-fill-secondary)] shadow-field group-hover/btn:bg-[var(--cds-fill-secondary-hover)]",
  },
  ghost: {
    root: "border-transparent text-[var(--text-muted)] font-normal group-hover/btn:text-[var(--text)]",
    paint: "bg-transparent group-hover/btn:bg-[var(--cds-fill-ghost-hover)]",
  },
  danger: {
    root: "border-transparent text-[var(--accent-fg)] font-medium",
    paint: "bg-[var(--status-error)] group-hover/btn:opacity-90",
  },
  outline: {
    root: "border-[var(--cds-hairline-2)] text-[var(--text)] font-normal",
    paint: "bg-transparent group-hover/btn:bg-[var(--cds-fill-ghost-hover)]",
  },
};

const MOTION = "duration-[var(--cds-dur-fast)] ease-[var(--cds-ease-swift)]";

export function CdsButton({
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "left",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonSlotProps) {
  const style = VARIANT[variant];
  const iconOnly = size === "icon" || (children === undefined && Boolean(icon));

  return (
    <button
      {...props}
      type={props.type ?? "button"}
      data-cds="Button"
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      className={[
        "group/btn relative isolate inline-flex shrink-0 select-none items-center justify-center border font-sans outline-none",
        "transition-[transform,box-shadow,color,background-color] active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-35",
        MOTION,
        SIZE[size],
        style.root,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden="true"
        data-cds-part="paint"
        className={[
          "absolute inset-0 -z-10 rounded-[inherit] transition-[background-color,box-shadow,color]",
          MOTION,
          style.paint,
        ].join(" ")}
      />

      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : icon && iconPosition === "left" ? (
        <span className="flex shrink-0 items-center justify-center leading-none">{icon}</span>
      ) : null}

      {children !== undefined && children !== null ? <span className="truncate">{children}</span> : null}

      {!loading && icon && iconPosition === "right" && !iconOnly ? (
        <span className="flex shrink-0 items-center justify-center leading-none">{icon}</span>
      ) : null}
    </button>
  );
}
