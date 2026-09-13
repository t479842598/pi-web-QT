/**
 * Viewport clamping for info-bar popovers on phones.
 *
 * The session-info bar wraps on narrow screens, so the anchor button can sit
 * anywhere in the row. An `absolute; right: 0` popover anchored to that button
 * then runs off the far edge (session ids were clipped mid-string). Anchoring
 * the panel to the viewport itself — full width minus side insets, parked just
 * above the anchor — keeps it fully visible without measuring the panel first.
 */

export interface PopoverViewport {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  left: number;
  right: number;
  width: number;
  bottom: number;
  maxHeight: number;
}

/** Smallest usable panel height; keeps the clamp from flattening the panel. */
const MIN_VISIBLE_HEIGHT = 120;

export function clampPopoverPlacement(
  anchorTop: number,
  viewport: PopoverViewport,
  inset = 8,
  gap = 4,
): PopoverPlacement {
  const width = Math.max(0, viewport.width - inset * 2);
  const aboveAnchor = Math.round(viewport.height - anchorTop + gap);
  // The floor keeps the panel off the very bottom edge; the ceiling keeps it
  // on screen when the anchor itself sits above the viewport (clipped host).
  const bottom = Math.max(inset, Math.min(aboveAnchor, viewport.height - inset - MIN_VISIBLE_HEIGHT));
  const maxHeight = Math.max(0, Math.round(viewport.height - bottom - inset));
  return { left: inset, right: inset, width, bottom, maxHeight };
}
