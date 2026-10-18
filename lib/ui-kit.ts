/**
 * Two-kit UI switching (pi / claude) — the pure model.
 *
 * Every visible surface renders through a *slot*. A slot resolves its kit from
 * three levels, most specific first:
 *
 *   slot override  →  scope override  →  global kit  →  "pi"
 *
 * The choice is a browser-only render preference (same class of setting as the
 * theme), stored in localStorage and mirrored into `html.dataset.*` by the
 * inline bootstrap script in `app/layout.tsx` so the first paint already has
 * the right kit and no React tree is needed to pick a stylesheet.
 *
 * This module is deliberately free of React and DOM imports: the bootstrap
 * script's data shape, the provider and the settings panel all share it.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export type KitId = "pi" | "claude";

/** A family of surfaces that can be switched as a group. */
export type ScopeId = "primitives" | "overlay" | "shell" | "conversation";

/** Density preset for control rows (composer chin, settings actions). */
export type LayoutPreset = "compact" | "standard" | "comfortable";

/** Where the sidebar collapse control lives. Both kits honour it. */
export type SidebarTogglePlacement = "sidebar" | "titlebar";

export const KIT_IDS: readonly KitId[] = ["pi", "claude"];

export const SCOPE_IDS: readonly ScopeId[] = ["primitives", "overlay", "shell", "conversation"];

/**
 * Every switchable surface. Order is grouped by scope for the settings panel;
 * `SLOT_SCOPES` below is the single source of truth for the grouping.
 */
export const SLOT_IDS = [
  // primitives — the atoms every other surface is built from
  "button",
  "segmented",
  "toggle",
  "status",
  "field",
  "scrollFade",
  // overlay — dialogs and their contents
  "dialogShell",
  "approvalCard",
  "planReview",
  "trustDialog",
  "queueRecovery",
  "palette",
  "imageLightbox",
  // shell — app chrome
  "titleBar",
  "sidebar",
  "sessionRow",
  "tabBar",
  "composer",
  "modelSwitcher",
  "fileViewer",
  // conversation — transcript and subagents
  "messageList",
  "messageShell",
  "thinking",
  "toolCard",
  "subagentRow",
  "subagentPanel",
  "compaction",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

export const SLOT_SCOPES: Record<SlotId, ScopeId> = {
  button: "primitives",
  segmented: "primitives",
  toggle: "primitives",
  status: "primitives",
  field: "primitives",
  scrollFade: "primitives",

  dialogShell: "overlay",
  approvalCard: "overlay",
  planReview: "overlay",
  trustDialog: "overlay",
  queueRecovery: "overlay",
  palette: "overlay",
  imageLightbox: "overlay",

  titleBar: "shell",
  sidebar: "shell",
  sessionRow: "shell",
  tabBar: "shell",
  composer: "shell",
  modelSwitcher: "shell",
  fileViewer: "shell",

  messageList: "conversation",
  messageShell: "conversation",
  thinking: "conversation",
  toolCard: "conversation",
  subagentRow: "conversation",
  subagentPanel: "conversation",
  compaction: "conversation",
};

/** Slots grouped by scope, in declaration order — used by the settings panel. */
export const SLOTS_BY_SCOPE: Record<ScopeId, readonly SlotId[]> = SCOPE_IDS.reduce(
  (acc, scope) => {
    acc[scope] = SLOT_IDS.filter((slot) => SLOT_SCOPES[slot] === scope);
    return acc;
  },
  {} as Record<ScopeId, SlotId[]>,
);

export const DEFAULT_KIT: KitId = "pi";

/**
 * The settings page is rebuilt in the Claude design only; it is not part of the
 * switch matrix and stays Claude regardless of the global kit. `KitScope` pins
 * it, and the model exposes the constant so tests can assert the pin.
 */
export const SETTINGS_PINNED_KIT: KitId = "claude";

// ─── Settings shape + storage keys ───────────────────────────────────────────

export interface UiKitSettings {
  kit: KitId;
  scopes: Partial<Record<ScopeId, KitId>>;
  slots: Partial<Record<SlotId, KitId>>;
  layout: LayoutPreset;
  sidebarToggle: SidebarTogglePlacement;
}

export const UI_KIT_STORAGE_KEYS = {
  kit: "pi-ui-kit",
  scopes: "pi-ui-kit-scopes",
  slots: "pi-ui-kit-slots",
  layout: "pi-ui-kit-layout",
  sidebarToggle: "pi-ui-kit-sidebar-toggle",
} as const;

/** `html.dataset` names the inline bootstrap script writes and the provider reads. */
export const UI_KIT_DATASET_KEYS = {
  kit: "uiKit",
  scopes: "uiKitScopes",
  slots: "uiKitSlots",
  layout: "uiKitLayout",
  sidebarToggle: "uiKitSidebarToggle",
} as const;

export const LAYOUT_PRESETS: readonly LayoutPreset[] = ["compact", "standard", "comfortable"];

export const SIDEBAR_TOGGLE_PLACEMENTS: readonly SidebarTogglePlacement[] = ["sidebar", "titlebar"];

export const DEFAULT_UI_KIT_SETTINGS: UiKitSettings = Object.freeze({
  kit: DEFAULT_KIT,
  scopes: {},
  slots: {},
  layout: "standard",
  sidebarToggle: "sidebar",
}) as UiKitSettings;

// ─── Guards ──────────────────────────────────────────────────────────────────

export function isKitId(value: unknown): value is KitId {
  return value === "pi" || value === "claude";
}

export function isScopeId(value: unknown): value is ScopeId {
  return typeof value === "string" && (SCOPE_IDS as readonly string[]).includes(value);
}

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && (SLOT_IDS as readonly string[]).includes(value);
}

export function isLayoutPreset(value: unknown): value is LayoutPreset {
  return typeof value === "string" && (LAYOUT_PRESETS as readonly string[]).includes(value);
}

export function isSidebarTogglePlacement(value: unknown): value is SidebarTogglePlacement {
  return typeof value === "string" && (SIDEBAR_TOGGLE_PLACEMENTS as readonly string[]).includes(value);
}

// ─── Pair-list codec ("button=claude,sidebar=pi") ────────────────────────────

/**
 * Decode a `key=kit` list. Unknown keys and invalid kit ids are dropped rather
 * than thrown: a stored value written by a newer build must not break an older
 * one, and a corrupt string must degrade to "inherit".
 */
export function parsePairList<T extends string>(
  raw: string | null | undefined,
  isValidKey: (value: string) => value is T,
): Partial<Record<T, KitId>> {
  const out: Partial<Record<T, KitId>> = {};
  if (typeof raw !== "string" || raw.length === 0) return out;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim();
    const kit = trimmed.slice(at + 1).trim();
    if (!isValidKey(key) || !isKitId(kit)) continue;
    out[key] = kit;
  }
  return out;
}

/** Encode a pair list with sorted keys so serialization is stable. */
export function serializePairList<T extends string>(map: Partial<Record<T, KitId>> | undefined): string {
  if (!map) return "";
  const keys = Object.keys(map).filter((key) => isKitId(map[key as T])) as T[];
  keys.sort();
  return keys.map((key) => `${key}=${map[key]}`).join(",");
}

// ─── Full settings ───────────────────────────────────────────────────────────

export interface UiKitSettingsInput {
  kit?: unknown;
  scopes?: unknown;
  slots?: unknown;
  layout?: unknown;
  sidebarToggle?: unknown;
}

/** Parse raw storage strings (or already-parsed values) into normalized settings. */
export function parseUiKitSettings(input: UiKitSettingsInput | null | undefined): UiKitSettings {
  const raw = input ?? {};
  const scopes = typeof raw.scopes === "string"
    ? parsePairList(raw.scopes, isScopeId)
    : isPlainRecord(raw.scopes)
      ? pickValid(raw.scopes, isScopeId)
      : {};
  const slots = typeof raw.slots === "string"
    ? parsePairList(raw.slots, isSlotId)
    : isPlainRecord(raw.slots)
      ? pickValid(raw.slots, isSlotId)
      : {};

  return normalizeUiKitSettings({
    kit: isKitId(raw.kit) ? raw.kit : DEFAULT_KIT,
    scopes,
    slots,
    layout: isLayoutPreset(raw.layout) ? raw.layout : DEFAULT_UI_KIT_SETTINGS.layout,
    sidebarToggle: isSidebarTogglePlacement(raw.sidebarToggle)
      ? raw.sidebarToggle
      : DEFAULT_UI_KIT_SETTINGS.sidebarToggle,
  });
}

/**
 * Drop entries that repeat what they would inherit anyway.
 *
 * Without this the same truth is stored twice (`kit=claude` plus
 * `shell=claude`), and switching the global kit later silently keeps a stale
 * override that the user never chose.
 */
export function normalizeUiKitSettings(input: UiKitSettings): UiKitSettings {
  const kit = isKitId(input.kit) ? input.kit : DEFAULT_KIT;

  const scopes: Partial<Record<ScopeId, KitId>> = {};
  for (const scope of SCOPE_IDS) {
    const value = input.scopes?.[scope];
    if (isKitId(value) && value !== kit) scopes[scope] = value;
  }

  const slots: Partial<Record<SlotId, KitId>> = {};
  for (const slot of SLOT_IDS) {
    const value = input.slots?.[slot];
    if (!isKitId(value)) continue;
    const inherited = scopes[SLOT_SCOPES[slot]] ?? kit;
    if (value !== inherited) slots[slot] = value;
  }

  return {
    kit,
    scopes,
    slots,
    layout: isLayoutPreset(input.layout) ? input.layout : DEFAULT_UI_KIT_SETTINGS.layout,
    sidebarToggle: isSidebarTogglePlacement(input.sidebarToggle)
      ? input.sidebarToggle
      : DEFAULT_UI_KIT_SETTINGS.sidebarToggle,
  };
}

/** Storage-ready strings; an empty string means "remove this key". */
export function serializeUiKitSettings(settings: UiKitSettings): Record<string, string> {
  const normalized = normalizeUiKitSettings(settings);
  return {
    [UI_KIT_STORAGE_KEYS.kit]: normalized.kit,
    [UI_KIT_STORAGE_KEYS.scopes]: serializePairList(normalized.scopes),
    [UI_KIT_STORAGE_KEYS.slots]: serializePairList(normalized.slots),
    [UI_KIT_STORAGE_KEYS.layout]: normalized.layout,
    [UI_KIT_STORAGE_KEYS.sidebarToggle]: normalized.sidebarToggle,
  };
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/** Kit for a whole scope (slot overrides are not consulted). */
export function resolveScopeKit(settings: UiKitSettings, scope: ScopeId): KitId {
  return settings.scopes?.[scope] ?? settings.kit ?? DEFAULT_KIT;
}

/** Kit for one slot: slot override → scope override → global kit. */
export function resolveSlotKit(settings: UiKitSettings, slot: SlotId): KitId {
  const direct = settings.slots?.[slot];
  if (isKitId(direct)) return direct;
  return resolveScopeKit(settings, SLOT_SCOPES[slot]);
}

/**
 * Effective settings for a subtree pinned to one kit (the settings page).
 * Pinning wins over every override inside the subtree.
 */
/**
 * Settings as they apply inside a pinned subtree (the settings page itself).
 *
 * Exported and covered by `ui-kit.test.mjs` because the pinning rule is a
 * contract, not an implementation detail: whatever the user's kit, scope and
 * slot overrides say, a pinned subtree resolves to one kit.
 */
export function withPinnedKit(settings: UiKitSettings, kit: KitId): UiKitSettings {
  return { kit, scopes: {}, slots: {}, layout: settings.layout, sidebarToggle: settings.sidebarToggle };
}

// ─── html.dataset bridge ─────────────────────────────────────────────────────

export function datasetFromSettings(settings: UiKitSettings): Record<string, string> {
  const normalized = normalizeUiKitSettings(settings);
  return {
    [UI_KIT_DATASET_KEYS.kit]: normalized.kit,
    [UI_KIT_DATASET_KEYS.scopes]: serializePairList(normalized.scopes),
    [UI_KIT_DATASET_KEYS.slots]: serializePairList(normalized.slots),
    [UI_KIT_DATASET_KEYS.layout]: normalized.layout,
    [UI_KIT_DATASET_KEYS.sidebarToggle]: normalized.sidebarToggle,
  };
}

export function settingsFromDataset(source: Record<string, string | undefined> | null | undefined): UiKitSettings {
  const raw = source ?? {};
  return parseUiKitSettings({
    kit: raw[UI_KIT_DATASET_KEYS.kit],
    scopes: raw[UI_KIT_DATASET_KEYS.scopes],
    slots: raw[UI_KIT_DATASET_KEYS.slots],
    layout: raw[UI_KIT_DATASET_KEYS.layout],
    sidebarToggle: raw[UI_KIT_DATASET_KEYS.sidebarToggle],
  });
}

// ─── Pure setters (used by the settings panel) ───────────────────────────────

export function withKit(settings: UiKitSettings, kit: KitId): UiKitSettings {
  return normalizeUiKitSettings({ ...settings, kit });
}

export function withScope(settings: UiKitSettings, scope: ScopeId, kit: KitId | null): UiKitSettings {
  const scopes = { ...settings.scopes };
  if (kit) scopes[scope] = kit;
  else delete scopes[scope];
  return normalizeUiKitSettings({ ...settings, scopes });
}

export function withSlot(settings: UiKitSettings, slot: SlotId, kit: KitId | null): UiKitSettings {
  const slots = { ...settings.slots };
  if (kit) slots[slot] = kit;
  else delete slots[slot];
  return normalizeUiKitSettings({ ...settings, slots });
}

export function withLayout(settings: UiKitSettings, layout: LayoutPreset): UiKitSettings {
  return normalizeUiKitSettings({ ...settings, layout });
}

export function withSidebarToggle(
  settings: UiKitSettings,
  placement: SidebarTogglePlacement,
): UiKitSettings {
  return normalizeUiKitSettings({ ...settings, sidebarToggle: placement });
}

// ─── Internals ───────────────────────────────────────────────────────────────

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickValid<T extends string>(
  source: Record<string, unknown>,
  isValidKey: (value: string) => value is T,
): Partial<Record<T, KitId>> {
  const out: Partial<Record<T, KitId>> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isValidKey(key) || !isKitId(value)) continue;
    out[key] = value;
  }
  return out;
}
