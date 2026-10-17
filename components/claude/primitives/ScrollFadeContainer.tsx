"use client";

/**
 * Claude Design System — scroll fade.
 *
 * Adapted from open-claude-ui `code-examples/ScrollFadeContainer.tsx` (MIT, see
 * ../../vendor/NOTICE.md). Kept: the idea of fading with a `mask-image` ramp
 * driven by `--cds-scroll-fade-top` / `--cds-scroll-fade-bottom` (28px by
 * default, from the token layer), and the "edges" contract that lets a caller
 * fade only one side.
 *
 * What changed: the upstream 8-stop ramp spells its alpha stops as
 * `#0000000d`-style hex. Those are mask alphas, not theme colours, but this
 * repo forbids raw literals in the Claude tree, so the ramp is rebuilt from
 * `black` plus two `color-mix` midpoints — same intent, still a
 * non-linear-feeling ramp, no literal hex. The scroll sensor is dropped: the
 * slot renders a pure container and the shell that owns the scroller sets the
 * two variables (the pi adapter does exactly the same).
 */

import type { CSSProperties, ReactNode } from "react";

export interface CdsScrollFadeProps {
  children: ReactNode;
  className?: string;
  edges?: "top" | "bottom" | "both" | "none";
  size?: number;
}

const DEFAULT_FADE_PX = 28;

function maskFor(top: number, bottom: number): CSSProperties {
  if (top === 0 && bottom === 0) return {};
  const mid = "color-mix(in srgb, black 42%, transparent)";
  const gradient = [
    "linear-gradient(to bottom",
    "transparent 0",
    `${mid} calc(var(--cds-scroll-fade-top) * 0.45)`,
    "black var(--cds-scroll-fade-top)",
    "black calc(100% - var(--cds-scroll-fade-bottom))",
    `${mid} calc(100% - var(--cds-scroll-fade-bottom) * 0.45)`,
    "transparent 100%)",
  ].join(", ");
  return { maskImage: gradient, WebkitMaskImage: gradient };
}

export function CdsScrollFade({
  children,
  className,
  edges = "both",
  size = DEFAULT_FADE_PX,
}: CdsScrollFadeProps) {
  const top = edges === "top" || edges === "both" ? size : 0;
  const bottom = edges === "bottom" || edges === "both" ? size : 0;

  return (
    <div
      data-cds="ScrollFade"
      className={[
        "relative",
        "transition-[mask-image] duration-[var(--cds-dur-snap)] ease-[var(--cds-ease-swift)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--cds-scroll-fade-top": `${top}px`,
          "--cds-scroll-fade-bottom": `${bottom}px`,
          ...maskFor(top, bottom),
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
