"use client";

/**
 * Where the sidebar collapse control lives.
 *
 * The choice is a browser preference (pi-ui-kit-sidebar-toggle), written into
 * html.dataset.uiKitSidebarToggle by the inline bootstrap script before first
 * paint. Reading it through useSyncExternalStore keeps SSR on the "sidebar"
 * default and switches after hydration, exactly like the theme toggle. A
 * MutationObserver picks up changes made from the settings panel, which is the
 * only writer after boot.
 */

import { useSyncExternalStore } from "react";

import { SIDEBAR_TOGGLE_PLACEMENTS, type SidebarTogglePlacement } from "@/lib/ui-kit";

const DATASET_KEY = "uiKitSidebarToggle";
const STORAGE_KEY = "pi-ui-kit-sidebar-toggle";
const SERVER_PLACEMENT: SidebarTogglePlacement = "sidebar";

function isPlacement(value: unknown): value is SidebarTogglePlacement {
  return typeof value === "string" && (SIDEBAR_TOGGLE_PLACEMENTS as readonly string[]).includes(value);
}

function readPlacement(): SidebarTogglePlacement {
  if (typeof document === "undefined") return SERVER_PLACEMENT;
  const fromDataset = document.documentElement.dataset[DATASET_KEY];
  if (isPlacement(fromDataset)) return fromDataset;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isPlacement(stored)) return stored;
  } catch {
    // Private mode: the dataset is the only source.
  }
  return SERVER_PLACEMENT;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-kit-sidebar-toggle"] });
  window.addEventListener("storage", onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

export function useSidebarTogglePlacement(): SidebarTogglePlacement {
  return useSyncExternalStore(subscribe, readPlacement, () => SERVER_PLACEMENT);
}
