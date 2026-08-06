"use client";

import { useCallback, useEffect, useState } from "react";
import { SquaresFour } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingRowLast, SettingNote } from "./SettingCard";
import { SettingToggle } from "./SettingToggle";

interface FeaturesState {
  tasksBoard: boolean;
}

export function FeaturesConfig() {
  const { t } = useI18n();
  const [features, setFeatures] = useState<FeaturesState>({ tasksBoard: true });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current feature toggles on mount.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/features");
        if (res.ok) {
          const data = await res.json() as Partial<FeaturesState>;
          if (!cancelled) {
            setFeatures((prev) => ({ ...prev, ...data }));
            setLoaded(true);
          }
        }
      } catch {
        // Defaults remain.
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTasksBoard = useCallback(async (enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasksBoard: enabled }),
      });
      if (res.ok) {
        const data = await res.json() as { features?: Partial<FeaturesState> };
        setFeatures((prev) => ({ ...prev, ...data.features }));
      }
    } catch {
      // Keep current state; the switch will be out of sync until reload.
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div style={{ flex: 1, overflow: "auto", minWidth: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!loaded ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("desktop.featuresLoading")}
          </div>
        ) : (
          <SettingCard>
            <SettingRowLast>
              <SettingToggle
                checked={features.tasksBoard}
                onChange={(v) => void toggleTasksBoard(v)}
                label={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <SquaresFour size={14} aria-hidden="true" />
                    {t("desktop.featuresTasksBoard")}
                    <span style={{ borderRadius: 999, background: "rgba(37,99,235,0.12)", color: "var(--accent)", padding: "1px 7px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Beta
                    </span>
                  </span>
                }
                description={t("desktop.featuresTasksBoardDesc")}
              />
            </SettingRowLast>
          </SettingCard>
        )}
        <SettingNote>{t("desktop.featuresDesc")}</SettingNote>
        {saving && (
          <div style={{ padding: "0 2px", fontSize: 11, color: "var(--text-muted)" }}>
            {t("desktop.featuresSaving")}
          </div>
        )}
      </div>
    </div>
  );
}
