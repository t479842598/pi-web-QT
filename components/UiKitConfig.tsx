"use client";

import { useMemo, useState } from "react";

import { SettingCard, SettingNote, SettingRow } from "@/components/SettingCard";
import { Button, Segmented, Status, Toggle, useUiKit } from "@/components/ui-kit";
import { CLAUDE_PENDING } from "@/components/ui-kit/registry";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_UI_KIT_SETTINGS,
  LAYOUT_PRESETS,
  SCOPE_IDS,
  SETTINGS_PINNED_KIT,
  SLOTS_BY_SCOPE,
  SLOT_IDS,
  isSlotId,
  resolveSlotKit,
  type KitId,
  type LayoutPreset,
  type ScopeId,
  type SidebarTogglePlacement,
  type SlotId,
} from "@/lib/ui-kit";

/**
 * 「界面体系」— the only place the two kits are chosen.
 *
 * The settings page itself is rebuilt in the Claude design and fixed to it in
 * the CSS layer (`SETTINGS_PINNED_KIT` + the un-prefixed rules in
 * `app/settings-claude.css`), so this panel always renders with Claude
 * primitives while controlling what the *rest* of the app renders.
 *
 * The three levels are presented top-down: global → scope → individual slot,
 * because that is the resolution order. A level that would inherit the level
 * above shows "跟随全局" and is not persisted — switching the global kit later
 * therefore cannot leave a stale override behind.
 */

const INHERIT = "__inherit__";

interface SegmentedOption {
  id: string;
  label: string;
}

export function UiKitConfig() {
  const { t } = useI18n();
  const {
    settings,
    setKit,
    setScope,
    setSlot,
    setLayout,
    setSidebarToggle,
    reset,
    resolveSlot,
  } = useUiKit();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetFlash, setResetFlash] = useState(false);

  const overrideOptions = useMemo<SegmentedOption[]>(
    () => [
      { id: INHERIT, label: t("uiKit.followGlobal") },
      { id: "pi", label: t("uiKit.kitPi") },
      { id: "claude", label: t("uiKit.kitClaude") },
    ],
    [t],
  );

  const layoutOptions = useMemo<SegmentedOption[]>(
    () => [
      { id: "compact", label: t("uiKit.layoutCompact") },
      { id: "standard", label: t("uiKit.layoutStandard") },
      { id: "comfortable", label: t("uiKit.layoutComfortable") },
    ],
    [t],
  );

  const togglePlacementOptions = useMemo<SegmentedOption[]>(
    () => [
      { id: "sidebar", label: t("uiKit.sidebarToggleSidebar") },
      { id: "titlebar", label: t("uiKit.sidebarToggleTitlebar") },
    ],
    [t],
  );

  const scopeOptions: Record<ScopeId, SegmentedOption[]> = {
    primitives: overrideOptions,
    overlay: overrideOptions,
    shell: overrideOptions,
    conversation: overrideOptions,
  };

  const handleReset = () => {
    reset();
    setResetFlash(true);
    window.setTimeout(() => setResetFlash(false), 1600);
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--cds-gap-3, 10px)" }}>
      <SettingNote>{t("uiKit.description")}</SettingNote>

      {/* 1 · global kit — read-only mirror.
             The switch itself lives in the title bar (`UiKitSwitch`): it is a
             whole-app appearance choice users reach for often, not a
             configure-once setting, and two controls for one value is a bug
             waiting to happen. This row reports the current level so the
             override list below has something concrete to "follow". */}
      <SettingCard>
        <SettingRow>
          <div className="flex w-full flex-col" style={{ gap: 6, minWidth: 0 }}>
            <div className="flex items-baseline justify-between" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="text-sm text-text">{t("uiKit.title")}</span>
              <span className="text-xs text-text-muted">{t("uiKit.switchInTitleBar")}</span>
            </div>
            <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <span
                className="text-xs"
                style={{
                  // The badge must never be squeezed: on a phone the description
                  // beside it is long enough to compress a shrinkable pill into
                  // an ellipsis.
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--cds-fill-secondary, var(--bg-hover))",
                  color: "var(--cds-text-primary, var(--text))",
                  fontWeight: 600,
                }}
              >
                {settings.kit === "claude" ? t("uiKit.kitClaude") : t("uiKit.kitPi")}
              </span>
              <span className="text-xs text-text-dim">
                {settings.kit === "claude" ? t("uiKit.kitClaudeDescription") : t("uiKit.kitPiDescription")}
              </span>
            </div>
          </div>
        </SettingRow>
      </SettingCard>

      {/* 2 · scope overrides */}
      <div className="flex flex-col" style={{ gap: 6 }}>
        {SCOPE_IDS.map((scope) => (
          <SettingCard key={scope}>
            <SettingRow>
              <div className="flex w-full flex-col" style={{ gap: 8, minWidth: 0 }}>
                <div className="flex flex-wrap items-baseline" style={{ gap: 6 }}>
                  <span className="text-sm text-text">{t(`uiKit.scope${cap(scope)}`)}</span>
                  <span className="text-xs text-text-dim">{t(`uiKit.scope${cap(scope)}Description`)}</span>
                </div>
                <Segmented
                  ariaLabel={t(`uiKit.scope${cap(scope)}`)}
                  items={scopeOptions[scope]}
                  value={settings.scopes[scope] ?? INHERIT}
                  onChange={(id) =>
                    setScope(scope, id === INHERIT ? null : (id as KitId))
                  }
                />
              </div>
            </SettingRow>
          </SettingCard>
        ))}
      </div>

      {/* 3 · density + sidebar toggle placement */}
      <SettingCard>
        <SettingRow>
          <div className="flex w-full items-center justify-between" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="text-sm text-text">{t("uiKit.layout")}</span>
            <Segmented
              ariaLabel={t("uiKit.layout")}
              items={layoutOptions}
              value={settings.layout}
              onChange={(id) => setLayout(id as LayoutPreset)}
            />
          </div>
        </SettingRow>
        <SettingRow>
          <div className="flex w-full items-center justify-between" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="text-sm text-text">{t("uiKit.sidebarToggle")}</span>
            <Segmented
              ariaLabel={t("uiKit.sidebarToggle")}
              items={togglePlacementOptions}
              value={settings.sidebarToggle}
              onChange={(id) => setSidebarToggle(id as SidebarTogglePlacement)}
            />
          </div>
        </SettingRow>
      </SettingCard>

      {/* 4 · live preview of the primitives currently in effect */}
      <SettingCard>
        <SettingRow>
          <div className="flex w-full flex-col" style={{ gap: 10, minWidth: 0 }}>
            <span className="text-xs uppercase tracking-wider text-text-muted">{t("uiKit.preview")}</span>
            <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <Button variant="primary" size="sm">{t("uiKit.kitClaude")}</Button>
              <Button variant="secondary" size="sm">{t("uiKit.kitPi")}</Button>
              <Button variant="ghost" size="sm">{t("uiKit.reset")}</Button>
              <Status tone="running" pulse label={t("uiKit.kitClaude")} />
              <Status tone="success" label={t("uiKit.kitPi")} />
              <Toggle
                checked={settings.kit === "claude"}
                onChange={(checked) => setKit(checked ? "claude" : "pi")}
                ariaLabel={t("uiKit.kitClaude")}
              />
            </div>
          </div>
        </SettingRow>
      </SettingCard>

      {/* 5 · per-slot overrides (advanced) */}
      <SettingCard>
        <SettingRow>
          <div className="flex w-full flex-col" style={{ gap: 8, minWidth: 0 }}>
            <button
              type="button"
              className="flex items-center justify-between text-left text-sm text-text"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <span>{t("uiKit.advanced")}</span>
              <span className="text-xs text-text-dim">{advancedOpen ? "▾" : "▸"}</span>
            </button>
            {advancedOpen && (
              <div className="flex flex-col" style={{ gap: 6 }}>
                {SCOPE_IDS.map((scope) => (
                  <div key={scope} className="flex flex-col" style={{ gap: 4 }}>
                    <span className="text-xs uppercase tracking-wider text-text-dim">
                      {t(`uiKit.scope${cap(scope)}`)}
                    </span>
                    {SLOTS_BY_SCOPE[scope].map((slot) => {
                      const pendingWave = CLAUDE_PENDING[slot];
                      const resolved = resolveSlot(slot);
                      return (
                        <div
                          key={slot}
                          className="flex items-center justify-between"
                          style={{ gap: 8, flexWrap: "wrap" }}
                        >
                          <code
                            className="text-xs text-text-muted"
                            title={pendingWave ? t("uiKit.slotPending") : undefined}
                            style={{ fontFamily: "var(--font-mono)", minWidth: 0 }}
                          >
                            {slot}
                            {pendingWave ? " *" : ""}
                          </code>
                          <Segmented
                            ariaLabel={slot}
                            size="sm"
                            items={overrideOptions}
                            value={settings.slots[slot] ?? INHERIT}
                            onChange={(id) =>
                              setSlot(slot, id === INHERIT ? null : (id as KitId))
                            }
                          />
                          <span className="text-[10px] text-text-dim">{resolved}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingRow>
      </SettingCard>

      <div className="flex items-center justify-between" style={{ gap: 8, flexWrap: "wrap" }}>
        {/* The copy names the kit the page is fixed to, so the constant is what
            drives the label — if SETTINGS_PINNED_KIT ever changes, the note
            changes with it instead of quietly lying. */}
        <span className="text-xs text-text-dim">
          {t("uiKit.settingsPinned", {
            kit: SETTINGS_PINNED_KIT === "claude" ? t("uiKit.kitClaude") : t("uiKit.kitPi"),
          })}
        </span>
        <Button variant="secondary" size="sm" onClick={handleReset}>
          {resetFlash ? t("uiKit.resetDone") : t("uiKit.reset")}
        </Button>
      </div>
    </div>
  );
}

function cap(scope: ScopeId): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

/** Exported for the settings-panel test: the slot list must cover the registry. */
export const UI_KIT_PANEL_SLOTS: readonly SlotId[] = SLOT_IDS;

export const UI_KIT_PANEL_DEFAULTS = DEFAULT_UI_KIT_SETTINGS;
export const UI_KIT_PANEL_LAYOUTS = LAYOUT_PRESETS;
export const UI_KIT_PANEL_IS_SLOT = isSlotId;
export const UI_KIT_PANEL_RESOLVE = resolveSlotKit;
