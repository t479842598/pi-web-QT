"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { useUiKit } from "@/components/ui-kit";
import { SETTINGS_PINNED_KIT, type KitId } from "@/lib/ui-kit";

/**
 * Title-bar kit switch.
 *
 * Lives next to the theme toggle because it is the same kind of decision — a
 * whole-app appearance choice the user reaches for repeatedly, not a
 * configure-once setting. The settings page keeps its "界面体系" section for the
 * per-scope and per-slot overrides; this is the one-click version of the global
 * level.
 *
 * Rendered as a two-cell pill so the current kit is legible at a glance
 * ("Pi" vs "Claude"), instead of a single icon whose meaning changes with
 * state — the title bar already has five icon-only buttons.
 *
 * Deferred to the client on purpose: the kit is read from `html.dataset`, which
 * the bootstrap script fills before hydration. Rendering it on the server would
 * ship markup that disagrees with the saved choice.
 */

const OPTIONS: { id: KitId; label: string; titleKey: string }[] = [
  { id: "pi", label: "Pi", titleKey: "uiKit.kitPiDescription" },
  { id: "claude", label: "Claude", titleKey: "uiKit.kitClaudeDescription" },
];

export function UiKitSwitch({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const { settings, setKit } = useUiKit();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // On a phone the title bar has room for one more control, not 116px of it.
  // The same pill renders with tighter padding and a smaller label; the aria
  // label and title stay full so the control still reads correctly.
  const pillHeight = compact ? 24 : 26;
  const buttonHeight = compact ? 20 : 22;
  const buttonPad = compact ? "0 6px" : "0 9px";
  const fontSize = compact ? 10 : 11;

  if (!mounted) {
    // Reserve the same footprint so the title bar does not shift on hydration.
    return <span aria-hidden="true" style={{ width: compact ? 84 : 116, height: pillHeight, flexShrink: 0 }} />;
  }

  return (
    <div
      role="group"
      aria-label={t("uiKit.title")}
      className="app-no-drag"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        padding: 1,
        height: pillHeight,
        flexShrink: 0,
        borderRadius: 999,
        border: "0.5px solid var(--cds-hairline-1, var(--border))",
        background: "var(--cds-fill-secondary, var(--bg-hover))",
      }}
    >
      {OPTIONS.map(({ id, label, titleKey }) => {
        const active = settings.kit === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setKit(id)}
            aria-pressed={active}
            title={t(titleKey)}
            style={{
              height: buttonHeight,
              padding: buttonPad,
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              fontSize,
              fontWeight: active ? 600 : 400,
              lineHeight: 1,
              whiteSpace: "nowrap",
              color: active ? "var(--accent-fg, var(--bg))" : "var(--text-muted)",
              background: active ? "var(--accent)" : "transparent",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The settings page is pinned, so the switch never offers to change it there. */
export const UI_KIT_SWITCH_PINNED = SETTINGS_PINNED_KIT;
