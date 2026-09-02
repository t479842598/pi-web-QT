"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ProcessDisplayMode = "timeline" | "tabs";

// Per-tab preference: a display-mode click in another browser window must not
// silently flip the active conversation. The v2 key intentionally ignores the
// old cross-window localStorage value that could strand users in timeline mode.
const STORAGE_KEY = "pi-process-display-mode-v2";
const DEFAULT_MODE: ProcessDisplayMode = "tabs";
const CHANGE_EVENT = "pi-process-display-mode-change";

function getStoredMode(): ProcessDisplayMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const storedMode = window.sessionStorage.getItem(STORAGE_KEY);
    return storedMode === "timeline" || storedMode === "tabs" ? storedMode : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

function getServerSnapshot(): ProcessDisplayMode {
  return DEFAULT_MODE;
}

export function useProcessDisplayMode() {
  const displayMode = useSyncExternalStore(subscribe, getStoredMode, getServerSnapshot);

  const setDisplayMode = useCallback((mode: ProcessDisplayMode) => {
    try { window.sessionStorage.setItem(STORAGE_KEY, mode); } catch { /* display still updates in-memory */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { displayMode, setDisplayMode };
}
