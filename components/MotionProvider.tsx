"use client";

import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from "framer-motion";

/**
 * Single animation root for the whole app.
 *
 * `LazyMotion` + `features={domAnimation}` loads only the DOM animation
 * feature bundle (~15 kB gz) instead of the full `motion` component set, and
 * `strict` makes the saving enforceable: children may only use `m.*`, and any
 * `motion.*` element throws instead of silently pulling the full bundle in.
 *
 * Reduced motion is gated twice: `MotionConfig` turns transformations off for
 * every descendant, and `useReducedMotion` re-renders the provider when the OS
 * setting flips so the switch happens live rather than at first paint.
 *
 * Everything that animates must render inside this provider — `AppShell` and
 * its subtree included — otherwise `strict` throws at render time.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>
    </LazyMotion>
  );
}
