"use client";

/**
 * Claude Design System — segmented control.
 *
 * Adapted from open-claude-ui `code-examples/SegmentedControl.tsx` (MIT, see
 * ../../vendor/NOTICE.md). Kept: the 1px track padding and the pure-geometry
 * indicator formula `left = 1px + index * (100% - 2px) / count`.
 *
 * What changed: the framer-motion `layoutId` thumb is replaced by the upstream
 * CSS branch — one absolutely positioned indicator whose `left`/`width` are
 * computed from the index, transitioned with `--cds-dur-snap` /
 * `--cds-ease-snap`. No motion library is imported, so `LazyMotion strict`
 * stays satisfied. Roles follow this repo's slot contract (`group` +
 * `aria-pressed` for a toggle group, with `ariaLabel` as the accessible name)
 * rather than upstream's `tablist`, because the contract's call site treats the
 * control as a set of pressed buttons. Container-query label collapsing is not
 * carried over: the shell already sizes these tracks.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { SegmentedSlotProps } from "@/components/ui-kit/types";

const MOTION = "duration-[var(--cds-dur-snap)] ease-[var(--cds-ease-snap)]";

export function CdsSegmented({
  items,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className,
}: SegmentedSlotProps) {
  const found = items.findIndex((item) => item.id === value);
  const index = found >= 0 ? found : 0;

  // The indicator has to measure the active button, not divide the track.
  // The upstream formula (`index * (100% - 2px) / count`) assumes every chip is
  // an equal share, which stopped being true when the labels were allowed their
  // intrinsic width — the result was a pill sitting under the wrong chip, drawn
  // over "Claude" while "原版 Pi" was the pressed option.
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [indicator, setIndicator] = useState<CSSProperties>({
    left: 1,
    width: 0,
    opacity: 0,
  });

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      const button = buttonRefs.current[index];
      if (!button) return;
      // offsetLeft/offsetWidth are relative to the padded track and are not
      // affected by the track's own scroll offset, which a bounding-rect
      // subtraction is. A first layout pass can report 0 while the modal is
      // still mounting, so the observer below re-runs this once it has a box.
      setIndicator({
        left: button.offsetLeft,
        width: button.offsetWidth,
        opacity: 1,
        transition:
          "left var(--cds-dur-snap) var(--cds-ease-snap), width var(--cds-dur-snap) var(--cds-ease-snap)",
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const button of buttonRefs.current) {
      if (button) observer.observe(button);
    }
    return () => observer.disconnect();
  }, [index, items.length]);

  return (
    <div
      data-cds="SegmentedControl"
      data-segmented=""
      role="group"
      aria-label={ariaLabel}
      ref={trackRef}
      className={[
        "relative inline-flex max-w-full select-none items-stretch overflow-x-auto rounded-full p-px transition-colors [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        size === "sm" ? "h-7 text-[11.5px]" : "h-8 text-xs",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: "var(--cds-segmented-track, var(--cds-fill-secondary))" }}
    >
      <div
        aria-hidden="true"
        data-cds-part="indicator"
        // The thumb must read as *raised*: a surface darker than the track reads
        // as a hole. surface-3 is the lightest step, which is what makes the
        // selected chip look lifted instead of carved out.
        className="pointer-events-none absolute top-px bottom-px rounded-full bg-[var(--cds-surface-3)] shadow-[0_0_0_0.5px_var(--cds-hairline-2)]"
        style={indicator}
      />

      {items.map((item, idx) => {
        const active = idx === index;
        return (
          <button
            key={item.id}
            type="button"
            ref={(node) => {
              buttonRefs.current[idx] = node;
            }}
            aria-pressed={active}
            data-active={active ? "" : undefined}
            onClick={() => onChange(item.id)}
            className={[
              // No `truncate` here: a segmented control that ellipsises its own
              // labels ("侧边栏内" -> "侧边…") hides which option is which, which is
              // worse than a track that scrolls. `flex-none` + nowrap keeps every
              // label readable and lets the track size to its content.
              "relative z-10 flex h-full flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3",
              "transition-colors",
              MOTION,
              active
                ? "font-medium text-[var(--text)]"
                : "font-normal text-[var(--text-muted)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {item.icon ? (
              <span className="flex shrink-0 items-center justify-center">{item.icon}</span>
            ) : null}
            <span>{item.label}</span>
            {item.badge !== undefined ? (
              <span className="rounded-full bg-[var(--cds-fill-secondary)] px-1.5 text-[10px] leading-tight tabular-nums">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
