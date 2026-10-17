"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keyboard containment for a modal surface.
 *
 * The pi tree leans on each dialog's own key handler; the Claude overlays add a
 * real focus trap so Tab cannot walk the page behind a modal. Behaviour:
 *
 *   - on activate, focus the element marked `data-claude-focus-anchor`, else the
 *     first focusable child — but only when focus is outside the root, so an
 *     `autoFocus` input the caller already focused wins;
 *   - Tab / Shift+Tab cycle between the first and last focusable child, and
 *     pull focus back in when it has escaped to the document;
 *   - on deactivate the previously focused element is restored when it is still
 *     connected, which is what every dialog here relies on for a clean close.
 *
 * A nested dialog (`[data-settings-child-dialog]`, the convention SettingsModal
 * already uses) owns its own keyboard handling, so the trap steps aside rather
 * than fighting it. Disabled, hidden and `aria-hidden` controls are skipped so
 * the cycle only ever lands on something the user can actually operate.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** True while a nested dialog is open anywhere in the document. */
export function childDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector("[data-settings-child-dialog]") !== null;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert]")) return false;
    return element.getClientRects().length > 0;
  });
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!root.contains(document.activeElement)) {
      // The anchor is the card itself (tabIndex={-1}), not its first button: a
      // dialog opening on "Trust project" would otherwise arm the destructive
      // half of the choice before the user has read the sentence above it.
      // `querySelector` never matches the element it is called on, so test the
      // root first — otherwise the anchor is silently skipped and focus lands
      // on that first button anyway.
      const anchor = root.matches("[data-claude-focus-anchor]")
        ? root
        : root.querySelector<HTMLElement>("[data-claude-focus-anchor]");
      (anchor ?? focusable(root)[0])?.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (childDialogOpen()) return;
      const items = focusable(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      if (!(current instanceof Node) || !root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
