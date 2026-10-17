"use client";

/**
 * pi kit — ScrollFade.
 *
 * The pi fade is already implemented as a mask on `.chat-scroll-fade`
 * (app/globals.css, 7-stop non-linear ramp) driven by two custom properties:
 * `--chat-fade-top` / `--chat-fade-bottom`. This adapter is therefore only a
 * container: it puts the class on the div and sets those two variables from
 * `edges` / `size`. It does not add overflow — the caller owns the scroll
 * container so the panel keeps its own gutter and scrollbar styling.
 */

import type { CSSProperties } from "react";

import type { ScrollFadeSlotProps } from "../types";

const DEFAULT_FADE_PX = 28;

export function PiScrollFade({
  children,
  className,
  edges = "both",
  size = DEFAULT_FADE_PX,
}: ScrollFadeSlotProps) {
  const top = edges === "top" || edges === "both" ? size : 0;
  const bottom = edges === "bottom" || edges === "both" ? size : 0;
  const vars = {
    "--chat-fade-top": `${top}px`,
    "--chat-fade-bottom": `${bottom}px`,
  } as CSSProperties;

  return (
    <div className={["chat-scroll-fade", className].filter(Boolean).join(" ")} style={vars}>
      {children}
    </div>
  );
}
