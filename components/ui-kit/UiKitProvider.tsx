"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
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

// ─── Scope pinning (the settings page is always Claude) ─────────────────────

interface KitScopeValue {
  scope: ScopeId | null;
  pinned: KitId | null;
}

const KitScopeContext = createContext<KitScopeValue>({ scope: null, pinned: null });

export function KitScope({
  scope,
  pinned = null,
  children,
}: {
  scope?: ScopeId;
  pinned?: KitId | null;
  children: ReactNode;
}) {
  const value = useMemo<KitScopeValue>(() => ({ scope: scope ?? null, pinned }), [scope, pinned]);
  return (
    <KitScopeContext.Provider value={value}>
      <div data-kit={pinned ?? undefined} data-kit-scope={scope ?? undefined} className="contents">
        {children}
      </div>
    </KitScopeContext.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export interface UiKitApi {
  settings: UiKitSettings;
  /** Global kit, unless a pinned subtree overrides it. */
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
  const { pinned } = useContext(KitScopeContext);

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

  const resolveScope = useCallback(
    (scope: ScopeId) => pinned ?? resolveScopeKit(settings, scope),
    [pinned, settings],
  );
  const resolveSlot = useCallback(
    (slot: SlotId) => pinned ?? resolveSlotKit(settings, slot),
    [pinned, settings],
  );

  return {
    settings,
    kit: pinned ?? settings.kit,
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

/** The kit a single slot must render with, honoring any pinned subtree. */
export function useSlotKit(slot: SlotId): KitId {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { pinned } = useContext(KitScopeContext);
  return pinned ?? resolveSlotKit(settings, slot);
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

/** Marks a rendered surface for the coverage assertions in tests/e2e. */
export function surfaceProps(slot: SlotId, kit: KitId): { "data-surface": SlotId; "data-kit": KitId } {
  return { "data-surface": slot, "data-kit": kit };
}

export { useSyncExternalStore as __useSyncExternalStoreForTests };
