"use client";

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
} from "react";

import {
  DEFAULT_UI_KIT_SETTINGS,
  datasetFromSettings,
  normalizeUiKitSettings,
  parseUiKitSettings,
  resolveScopeKit,
  resolveSlotKit,
  serializeUiKitSettings,
  settingsFromDataset,
  UI_KIT_DATASET_KEYS,
  UI_KIT_STORAGE_KEYS,
  withKit,
  withLayout,
  withScope,
  withSidebarToggle,
  withSlot,
  type KitId,
  type LayoutPreset,
  type ScopeId,
  type SidebarTogglePlacement,
  type SlotId,
  type UiKitSettings,
} from "@/lib/ui-kit";
import { slotComponent } from "./registry";
import type { SlotPropsMap } from "./types";

// ─── Store (localStorage + html.dataset, one source of truth) ────────────────

let snapshot: UiKitSettings | null = null;
const listeners = new Set<() => void>();

function datasetSource(): Record<string, string | undefined> {
  if (typeof document === "undefined") return {};
  const data = document.documentElement.dataset;
  return {
    [UI_KIT_DATASET_KEYS.kit]: data[UI_KIT_DATASET_KEYS.kit],
    [UI_KIT_DATASET_KEYS.scopes]: data[UI_KIT_DATASET_KEYS.scopes],
    [UI_KIT_DATASET_KEYS.slots]: data[UI_KIT_DATASET_KEYS.slots],
    [UI_KIT_DATASET_KEYS.layout]: data[UI_KIT_DATASET_KEYS.layout],
    [UI_KIT_DATASET_KEYS.sidebarToggle]: data[UI_KIT_DATASET_KEYS.sidebarToggle],
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * The inline bootstrap script in `app/layout.tsx` already wrote the saved
 * choice into `html.dataset` before hydration, so the first client read is
 * synchronous and matches what CSS is already painting. Falling back to
 * localStorage covers the case where the script's write was skipped.
 */
function readSettings(): UiKitSettings {
  if (snapshot) return snapshot;
  if (typeof document === "undefined") return DEFAULT_UI_KIT_SETTINGS;

  const fromDataset = datasetSource();
  const hasDataset = Object.values(fromDataset).some((value) => typeof value === "string" && value.length > 0);
  if (hasDataset) {
    snapshot = settingsFromDataset(fromDataset);
    return snapshot;
  }

  try {
    snapshot = parseUiKitSettings({
      kit: localStorage.getItem(UI_KIT_STORAGE_KEYS.kit),
      scopes: localStorage.getItem(UI_KIT_STORAGE_KEYS.scopes),
      slots: localStorage.getItem(UI_KIT_STORAGE_KEYS.slots),
      layout: localStorage.getItem(UI_KIT_STORAGE_KEYS.layout),
      sidebarToggle: localStorage.getItem(UI_KIT_STORAGE_KEYS.sidebarToggle),
    });
  } catch {
    snapshot = DEFAULT_UI_KIT_SETTINGS;
  }
  return snapshot;
}

function writeSettings(next: UiKitSettings): void {
  const normalized = normalizeUiKitSettings(next);
  snapshot = normalized;

  const dataset = datasetFromSettings(normalized);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(dataset)) root.dataset[key] = value;
  }

  const stored = serializeUiKitSettings(normalized);
  try {
    for (const [key, value] of Object.entries(stored)) {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    }
  } catch {
    // Private mode / quota: the in-memory snapshot still drives this session.
  }

  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cross-tab / cross-window sync (a second window changes the kit). */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith("pi-ui-kit")) return;
    snapshot = null;
    readSettings();
    notify();
  });
}

function getSnapshot(): UiKitSettings {
  return readSettings();
}

function getServerSnapshot(): UiKitSettings {
  return DEFAULT_UI_KIT_SETTINGS;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
//
// The settings page is fixed to the Claude design in the CSS layer, not here.
// The `KitScope` component that used to sit in this section had no render site
// anywhere in the repo, so its `pinned` context was always `null` and every
// `pinned ?? …` branch below was dead code. `SETTINGS_PINNED_KIT` and the CSS
// contract test `components/ui-kit/settings-page-pinned.test.mjs` are now the
// honest statement of that pin.

export interface UiKitApi {
  settings: UiKitSettings;
  /** The global kit. Scope/slot overrides are read through the resolvers. */
  kit: KitId;
  layout: LayoutPreset;
  sidebarToggle: SidebarTogglePlacement;
  setKit: (kit: KitId) => void;
  setScope: (scope: ScopeId, kit: KitId | null) => void;
  setSlot: (slot: SlotId, kit: KitId | null) => void;
  setLayout: (layout: LayoutPreset) => void;
  setSidebarToggle: (placement: SidebarTogglePlacement) => void;
  reset: () => void;
  resolveScope: (scope: ScopeId) => KitId;
  resolveSlot: (slot: SlotId) => KitId;
}

export function useUiKit(): UiKitApi {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setKit = useCallback((kit: KitId) => writeSettings(withKit(readSettings(), kit)), []);
  const setScope = useCallback(
    (scope: ScopeId, kit: KitId | null) => writeSettings(withScope(readSettings(), scope, kit)),
    [],
  );
  const setSlot = useCallback(
    (slot: SlotId, kit: KitId | null) => writeSettings(withSlot(readSettings(), slot, kit)),
    [],
  );
  const setLayout = useCallback((layout: LayoutPreset) => writeSettings(withLayout(readSettings(), layout)), []);
  const setSidebarToggle = useCallback(
    (placement: SidebarTogglePlacement) => writeSettings(withSidebarToggle(readSettings(), placement)),
    [],
  );
  const reset = useCallback(() => writeSettings(DEFAULT_UI_KIT_SETTINGS), []);

  const resolveScope = useCallback((scope: ScopeId) => resolveScopeKit(settings, scope), [settings]);
  const resolveSlot = useCallback((slot: SlotId) => resolveSlotKit(settings, slot), [settings]);

  return {
    settings,
    kit: settings.kit,
    layout: settings.layout,
    sidebarToggle: settings.sidebarToggle,
    setKit,
    setScope,
    setSlot,
    setLayout,
    setSidebarToggle,
    reset,
    resolveScope,
    resolveSlot,
  };
}

/** The kit a single slot must render with: slot override → scope → global kit. */
export function useSlotKit(slot: SlotId): KitId {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return resolveSlotKit(settings, slot);
}

/**
 * The component for a slot. Falls back to the pi implementation when the
 * active kit has not implemented the slot yet, so a half-migrated slot can
 * never blank out the UI.
 */
export function useSlot<S extends SlotId>(slot: S): ComponentType<SlotPropsMap[S]> | null {
  const kit = useSlotKit(slot);
  return useMemo(() => slotComponent(slot, kit), [slot, kit]);
}

export { useSyncExternalStore as __useSyncExternalStoreForTests };