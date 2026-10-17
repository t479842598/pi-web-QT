"use client";

/**
 * pi kit — Status.
 *
 * Today's status point is `ConfigStatusDot` (components/SettingsUi.tsx):
 * a 7px span with `.config-status-dot`, defaulting to `--ds-text-muted` and
 * switching to `--accent` via `.is-active`. This adapter keeps that element
 * and class, and adds the four tones the contract needs on top of it by
 * painting the semantic token inline — inline beats the class rule, so the
 * idle and active dots stay pixel-identical to today.
 *
 * The breathing run state reuses the existing `tab-breathe` keyframes
 * (app/globals.css) — the same 1.8s fade the process tabs already use — rather
 * than adding a new stylesheet or an inline <style> block.
 */

import type { CSSProperties } from "react";

import type { StatusSlotProps, StatusTone } from "../types";

/** Tones that already have a class in settings.css and must not be repainted. */
const CLASS_TONES: ReadonlySet<StatusTone> = new Set<StatusTone>(["idle", "running"]);

const TONE_COLOR: Record<StatusTone, string> = {
  idle: "var(--ds-text-muted)",
  queued: "var(--status-info)",
  running: "var(--accent)",
  success: "var(--status-success)",
  warning: "var(--status-warning)",
  error: "var(--status-error)",
};

/** Today's dot is 7px, so `sm` must emit no size at all. */
const SIZE_PX: Record<NonNullable<StatusSlotProps["size"]>, number> = { xs: 5, sm: 7, md: 9 };

export function PiStatus({
  tone,
  size = "sm",
  pulse = false,
  title,
  label,
  className,
}: StatusSlotProps) {
  const accent = tone === "running";
  const style: CSSProperties = {};

  if (!CLASS_TONES.has(tone)) style.background = TONE_COLOR[tone];
  const px = SIZE_PX[size];
  if (px !== 7) {
    style.width = px;
    style.height = px;
  }
  if (pulse) style.animation = "tab-breathe 1.8s ease-in-out infinite";

  const name = label ?? title;
  return (
    <span
      aria-hidden={name ? undefined : true}
      role={name ? "img" : undefined}
      aria-label={name}
      title={title}
      className={["config-status-dot", accent ? "is-active" : null, className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
