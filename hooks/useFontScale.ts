"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_PRESETS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  FONT_SCALE_STEP,
  fontScalePercent,
  normalizeFontScale,
  type FontScalePreset,
} from "@/lib/font-scale";

/**
 * Apply the global scale.
 *
 * The codebase sizes almost all text with literal `px` (969 call sites), so a
 * `--text-*` ramp alone would scale nothing visible. `zoom` on the root
 * element scales the whole rendered UI — including those px values — exactly
 * like browser page zoom, and fixed-position overlays (the settings dialog)
 * still fill the viewport because they resolve against the zoomed coordinate
 * space. `--font-scale` is kept in step for any CSS that multiplies a token.
 */
export function applyFontScale(scale: number): void {
  if (typeof document === "undefined") return;
  const normalized = normalizeFontScale(scale);
  const root = document.documentElement;
  root.style.setProperty("--font-scale", String(normalized));
  root.style.setProperty("zoom", normalized === DEFAULT_FONT_SCALE ? "" : String(normalized));
}

/**
 * Mount-only read of the persisted font scale, applied to :root. Use this at
 * the app root so the whole UI scales; useFontScale() is the interactive
 * controller for the settings row.
 */
export function useFontScaleInitialise(): void {
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/appearance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { fontScale?: number } | null) => {
        if (cancelled) return;
        applyFontScale(data?.fontScale ?? DEFAULT_FONT_SCALE);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
}

export interface FontScaleController {
  scale: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Set locally + persist to ~/.pi/agent/settings.json. */
  setScale: (value: number) => void;
  /** Which named preset the current scale matches, if any. */
  preset: FontScalePreset | null;
}

/**
 * Global UI font scale, persisted in ~/.pi/agent/settings.json. Reads once on
 * mount, applies to :root immediately, and writes through on change.
 */
export function useFontScale(): FontScaleController {
  const [scale, setScaleState] = useState<number>(DEFAULT_FONT_SCALE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/appearance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { fontScale?: number } | null) => {
        if (cancelled) return;
        const next = normalizeFontScale(data?.fontScale ?? DEFAULT_FONT_SCALE);
        setScaleState(next);
        applyFontScale(next);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setScale = useCallback((value: number) => {
    const next = normalizeFontScale(value);
    setScaleState(next);
    applyFontScale(next);
    setSaving(true);
    setError(null);
    fetch("/api/settings/appearance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fontScale: next }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({} as { error?: string }));
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setSaving(false));
  }, []);

  const preset = (Object.keys(FONT_SCALE_PRESETS) as FontScalePreset[]).find(
    (key) => FONT_SCALE_PRESETS[key] === scale,
  ) ?? null;

  return { scale, loading, saving, error, setScale, preset };
}

export { FONT_SCALE_PRESETS, MAX_FONT_SCALE, MIN_FONT_SCALE, FONT_SCALE_STEP, fontScalePercent };
export type { FontScalePreset };
