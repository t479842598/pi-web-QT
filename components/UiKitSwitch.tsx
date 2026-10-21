"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/hooks/useI18n";
import { useUiKit } from "@/components/ui-kit";
import { kitSwitchImpact, type KitId, type KitSwitchImpact } from "@/lib/ui-kit";

/**
 * Title-bar kit switch.
 *
 * Lives next to the theme toggle because it is the same kind of decision — a
 * whole-app appearance choice the user reaches for repeatedly, not a
 * configure-once setting. The settings page keeps its 界面体系 section for the
 * per-scope and per-slot overrides; this is the one-click version of the global
 * level.
 *
 * Rendered as a two-cell pill so the current kit is legible at a glance
 * ("Pi" vs "Claude"), instead of a single icon whose meaning changes with
 * state — the title bar already has five icon-only buttons.
 *
 * Deferred to the client on purpose: the kit is read from html.dataset, which
 * the bootstrap script fills before hydration. Rendering it on the server would
 * ship markup that disagrees with the saved choice.
 *
 * S4-A — what a switch absorbs, made visible.
 *
 * Switching the global kit drops every override that would then repeat what it
 * inherits (normalizeUiKitSettings). That semantics is unchanged here; what was
 * missing was that the user could not see it. So the pill reports it twice,
 * both without a dialog:
 *
 *   - before the click: the title of each cell names the counts for that target
 *     kit, computed by the pure kitSwitchImpact;
 *   - after the click: a transient role="status" line under the title bar, only
 *     when the switch actually absorbed something, auto-dismissing and
 *     pointer-events: none so it can never block the app.
 *
 * The notice is portalled to document.body because the title bar right zone is
 * overflow: hidden — an inline notice would be clipped on a narrow window, and
 * the pill must not grow or shift the chrome.
 */

const OPTIONS: { id: KitId; label: string; titleKey: string }[] = [
  { id: "pi", label: "Pi", titleKey: "uiKit.kitPiDescription" },
  { id: "claude", label: "Claude", titleKey: "uiKit.kitClaudeDescription" },
];

/** Long enough to read, short enough not to linger over the chrome. */
const NOTICE_MS = 5000;

export function UiKitSwitch({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const { settings, setKit } = useUiKit();
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const kitLabel = useCallback(
    (id: KitId) => (id === "claude" ? t("uiKit.kitClaude") : t("uiKit.kitPi")),
    [t],
  );

  /** Counts for the switch this cell would perform; null for the active kit. */
  const impactOf = useCallback((id: KitId): KitSwitchImpact | null => {
    if (settings.kit === id) return null;
    return kitSwitchImpact(settings, id);
  }, [settings]);

  const absorbSuffix = useCallback((impact: KitSwitchImpact | null) => (
    impact === null || !impact.hasImpact
      ? ""
      : " " + t("uiKit.absorbPreview", {
          kit: kitLabel(impact.nextKit),
          scopes: impact.scopeCount,
          slots: impact.slotCount,
        })
  ), [kitLabel, t]);

  const handleSwitch = useCallback((id: KitId) => {
    const impact = impactOf(id);
    setKit(id);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (impact === null || !impact.hasImpact) {
      setNotice(null);
      return;
    }
    setNotice(t("uiKit.absorbedNotice", {
      kit: kitLabel(id),
      scopes: impact.scopeCount,
      slots: impact.slotCount,
    }));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, [impactOf, kitLabel, setKit, t]);

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
    <>
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
              onClick={() => handleSwitch(id)}
              aria-pressed={active}
              title={t(titleKey) + absorbSuffix(impactOf(id))}
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
      {notice !== null && <AbsorbNotice text={notice} />}
    </>
  );
}

/**
 * The transient absorb notice, hung under the title bar. Same fixed geometry as
 * DesktopServerHint (the only other title-bar bubble), minus the dismiss action:
 * it reports what already happened, so it only fades out on its own.
 */
function AbsorbNotice({ text }: { text: string }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 52,
        right: 12,
        zIndex: 700,
        maxWidth: "min(360px, calc(100vw - 24px))",
        padding: "8px 12px",
        borderRadius: 10,
        background: "var(--bg-panel)",
        border: "0.5px solid var(--border)",
        boxShadow: "var(--cds-shadow-popover, 0 12px 36px rgb(0 0 0 / 32%))",
        color: "var(--text-muted)",
        fontSize: "var(--text-ui-sm, 12px)",
        lineHeight: 1.45,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>,
    document.body,
  );
}
