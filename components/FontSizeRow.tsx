"use client";

import { useI18n } from "@/hooks/useI18n";
import {
  useFontScale,
  FONT_SCALE_PRESETS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  FONT_SCALE_STEP,
  fontScalePercent,
  type FontScalePreset,
} from "@/hooks/useFontScale";

const PRESET_ORDER: FontScalePreset[] = ["small", "default", "large", "xl"];
const PRESET_LABEL_KEY: Record<FontScalePreset, string> = {
  small: "desktop.fontScaleSmall",
  default: "desktop.fontScaleDefault",
  large: "desktop.fontScaleLarge",
  xl: "desktop.fontScaleXl",
};

/**
 * Global UI font scale row: four named presets plus a percentage slider.
 * Mirrors PI-Desktop's FontSizeRow — the same 0.8–1.5 range and step.
 */
export function FontSizeRow() {
  const { t } = useI18n();
  const { scale, setScale, saving, error } = useFontScale();

  return (
    <div className="settings-row is-stacked" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, cursor: "default" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="settings-row-copy">
          <span className="settings-row-title">{t("desktop.fontSize")}</span>
          <span className="settings-row-description">{t("desktop.fontSizeDescription")}</span>
        </div>
        <span
          aria-live="polite"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            minWidth: 46,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {saving ? "…" : fontScalePercent(scale)}
        </span>
      </div>

      <div className="settings-segmented" role="group" aria-label={t("desktop.fontSize")}>
        {PRESET_ORDER.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={Math.abs(scale - FONT_SCALE_PRESETS[preset]) < 1e-6}
            onClick={() => setScale(FONT_SCALE_PRESETS[preset])}
          >
            {t(PRESET_LABEL_KEY[preset])}
          </button>
        ))}
      </div>

      <input
        type="range"
        min={MIN_FONT_SCALE}
        max={MAX_FONT_SCALE}
        step={FONT_SCALE_STEP}
        value={scale}
        aria-label={t("desktop.fontSize")}
        onChange={(event) => setScale(Number(event.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
      />

      {error && <span style={{ fontSize: 11, color: "var(--status-error)" }}>{error}</span>}
    </div>
  );
}
