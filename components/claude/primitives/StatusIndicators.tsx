"use client";

/**
 * Claude Design System — status indicators.
 *
 * Adapted from open-claude-ui `code-examples/StatusIndicators.tsx` (MIT, see
 * ../../vendor/NOTICE.md). Kept: the 6px dot, the tone ladder (clay for live
 * work, semantic danger/error, dim for idle) and the two motion speeds the
 * brief names — a 2.4s breathing run light and a 1.2s pulse.
 *
 * What changed: the upstream `animation:` shorthands referenced keyframes
 * shipped in `cds-theme.css`, which this repo does not load, and a component
 * may not add a stylesheet. Both speeds therefore ride on keyframes that
 * already exist globally: `drop-ring-pulse` (opacity 0.5 -> 1 with a 1 -> 1.06
 * scale) drives the 2.4s breathe, `pulse` (opacity 1 -> 0.5) drives the 1.2s
 * blink. Colours come from `--cds-*` / `--status-*`, never from a literal.
 *
 * `CdsSkeletonSheen` keeps the sweep gradient but cannot animate
 * `background-position` without a new keyframe, so it breathes with the same
 * existing `pulse` keyframe instead of sweeping. Recorded in the NOTICE as a
 * deliberate, minimal degradation.
 */

import type { CSSProperties, ReactNode } from "react";

import type { StatusSlotProps, StatusTone } from "@/components/ui-kit/types";

const TONE_COLOR: Record<StatusTone, string> = {
  idle: "var(--text-dim)",
  queued: "var(--status-info)",
  running: "var(--cds-clay)",
  success: "var(--status-success)",
  warning: "var(--status-warning)",
  error: "var(--status-error)",
};

const SIZE_PX: Record<NonNullable<StatusSlotProps["size"]>, number> = { xs: 5, sm: 6, md: 8 };

/** Tones that carry a live animation; only `running` breathes by default. */
function animationFor(tone: StatusTone, pulse: boolean): string | undefined {
  if (tone === "running" && pulse) return "drop-ring-pulse 2.4s var(--cds-ease-pulse) infinite";
  if (tone === "queued" && pulse) return "pulse 1.2s var(--cds-ease-pulse) infinite";
  return undefined;
}

export function CdsStatus({
  tone,
  size = "sm",
  pulse,
  title,
  label,
  className,
}: StatusSlotProps) {
  const px = SIZE_PX[size];
  const animate = pulse ?? tone === "running";
  const name = label ?? title;

  const style: CSSProperties = {
    width: px,
    height: px,
    background: TONE_COLOR[tone],
  };

  if (tone === "running") {
    style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--cds-clay) 18%, transparent)";
  }
  const animation = animationFor(tone, animate);
  if (animation) style.animation = animation;

  return (
    <span
      data-cds="StatusDot"
      data-kind={tone}
      aria-hidden={name ? undefined : true}
      role={name ? "img" : undefined}
      aria-label={name}
      title={title}
      className={["inline-block shrink-0 rounded-full", className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}

/** Skeleton placeholder: the CDS 105degree sheen, breathing instead of sweeping. */
export function CdsSkeletonSheen({
  className,
  rounded,
  children,
}: {
  className?: string;
  rounded?: string;
  children?: ReactNode;
}) {
  return (
    <span
      data-cds="Skeleton"
      aria-hidden="true"
      className={[
        "relative block overflow-hidden bg-[var(--cds-fill-secondary)]",
        rounded ?? "rounded-[var(--cds-radius)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--text) 12%, transparent) 50%, transparent 65%)",
          animation: "pulse 2s var(--cds-ease-pulse) infinite",
        }}
      />
      {children}
    </span>
  );
}
