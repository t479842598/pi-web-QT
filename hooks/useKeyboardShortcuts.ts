"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** Toggle the command palette (Cmd/Ctrl+K, Cmd/Ctrl+Shift+P). */
  onOpenCommandPalette?: () => void;
  /** Whether the palette is currently open — the shortcut closes it when true. */
  commandPaletteOpen?: boolean;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, onOpenCommandPalette, commandPaletteOpen } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Cmd/Ctrl+K and Cmd/Ctrl+Shift+P: command palette ----
      // Handled before Esc so the palette's own Escape reaches Radix, and
      // accepted from inside inputs too: the palette is a global entry point.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || (e.shiftKey && (e.key === "p" || e.key === "P")))) {
        if (!onOpenCommandPalette) return;
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      // ---- Esc: stop agent ----
      // Guarded by `commandPaletteOpen`: Radix closes the palette on Esc, and
      // without this the same keypress would bubble on and abort the running
      // agent (the palette's focus can sit on a plain button, so the tagName
      // check below does not cover it).
      if (e.key === "Escape") {
        if (commandPaletteOpen) return;
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
        return;
      }

      // ---- Ctrl+Alt+N: new session ----
      if (e.key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession, onOpenCommandPalette, commandPaletteOpen]);
}
