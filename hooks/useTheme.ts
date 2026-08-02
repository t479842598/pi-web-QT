"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeName =
  | "gruvbox"
  | "nord"
  | "tokyo"
  | "solarized"
  | "onedark"
  | "dracula"
  | "catppuccin";

type ThemeMode = "light" | "dark";

// All available themes, in display order. gruvbox is the default.
export const THEMES: ThemeName[] = [
  "gruvbox",
  "nord",
  "tokyo",
  "solarized",
  "onedark",
  "dracula",
  "catppuccin",
];

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readThemeName(): ThemeName {
  if (typeof document === "undefined") return "gruvbox";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr && (THEMES as string[]).includes(attr)) return attr as ThemeName;
  return "gruvbox";
}

function readThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getThemeSnapshot(): ThemeName {
  return readThemeName();
}

function getThemeServerSnapshot(): ThemeName {
  return "gruvbox";
}

function getModeSnapshot(): ThemeMode {
  return readThemeMode();
}

function getModeServerSnapshot(): ThemeMode {
  return "light";
}

/**
 * Apply a theme + mode to the DOM and persist to localStorage.
 * gruvbox is the built-in default palette (no data-theme attribute needed);
 * other themes set html[data-theme].
 */
export function applyTheme(name: ThemeName, mode: ThemeMode) {
  if (name === "gruvbox") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", name);
  }
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem("pi-theme", name);
    localStorage.setItem("pi-theme-mode", mode);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  listeners.forEach((cb) => cb());
}

function runWithViewTransition(apply: () => void, origin?: { x: number; y: number }) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const supportsVT = typeof document.startViewTransition === "function";

  if (!supportsVT || reduceMotion) {
    apply();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(apply);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 450,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // transition cancelled — ignore
    });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getThemeServerSnapshot);
  const mode = useSyncExternalStore(subscribe, getModeSnapshot, getModeServerSnapshot);
  const isDark = mode === "dark";

  /** Switch palette (keeps current light/dark mode). */
  const setTheme = useCallback((next: ThemeName, origin?: { x: number; y: number }) => {
    runWithViewTransition(() => applyTheme(next, readThemeMode()), origin);
  }, []);

  /** Toggle light/dark (keeps current palette). */
  const toggleTheme = useCallback((origin?: { x: number; y: number }) => {
    runWithViewTransition(
      () => applyTheme(readThemeName(), readThemeMode() === "dark" ? "light" : "dark"),
      origin,
    );
  }, []);

  return { theme, isDark, setTheme, toggleTheme, THEMES };
}
