"use client";

import { useEffect } from "react";

/**
 * Close a modal on Escape.
 *
 * Backdrop clicks no longer dismiss dialogs (an accidental click outside must
 * not discard a half-filled form), so Escape is the keyboard affordance for
 * "I meant to close this". Pass `active: false` (e.g. while a submit is in
 * flight) to leave the dialog open.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}
