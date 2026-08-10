"use client";

import { useCallback, useEffect, useState } from "react";
import { SquaresFour } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingRow, SettingRowLast, SettingNote } from "./SettingCard";
import { SettingToggle } from "./SettingToggle";
import type { CollaborationMode, TokenMode, ToolApprovalMode, ModeSettings } from "@/lib/modes";
import { normalizeCollaborationMode, normalizeTokenMode, normalizeToolApprovalMode } from "@/lib/modes";

interface FeaturesState {
  tasksBoard: boolean;
}

/** Broadcast when a feature toggle is saved so AppShell can react in real time. */
export const FEATURES_CHANGED_EVENT = "pi:features-changed";
/** Broadcast when mode defaults change so open chats refresh immediately. */
export const MODES_CHANGED_EVENT = "pi:modes-changed";

const COLLAB_OPTIONS: Array<{ value: CollaborationMode; labelKey: string }> = [
  { value: "normal", labelKey: "modes.collabNormal" },
  { value: "plan", labelKey: "modes.collabPlan" },
  { value: "goal", labelKey: "modes.collabGoal" },
];

const TOKEN_OPTIONS: Array<{ value: TokenMode; labelKey: string }> = [
  { value: "economy", labelKey: "modes.tokenEconomy" },
  { value: "full", labelKey: "modes.tokenFull" },
  { value: "delivery", labelKey: "modes.tokenDelivery" },
];

const APPROVAL_OPTIONS: Array<{ value: ToolApprovalMode; labelKey: string }> = [
  { value: "ask", labelKey: "modes.approvalAsk" },
  { value: "auto", labelKey: "modes.approvalAuto" },
  { value: "yolo", labelKey: "modes.approvalYolo" },
];

function SegmentedModeSelector<M extends string>({
  options,
  value,
  onChange,
  disabled,
  accentFor,
}: {
  options: Array<{ value: M; labelKey: string }>;
  value: M;
  onChange: (value: M) => void;
  disabled?: boolean;
  accentFor?: (value: M) => string | undefined;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        height: 28,
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const accent = accentFor?.(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => { if (option.value !== value) onChange(option.value); }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", padding: "0 12px",
              background: isActive ? "var(--bg-selected)" : "none",
              border: "none",
              color: isActive ? (accent ?? "var(--accent)") : "var(--text-muted)",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 11.5, fontWeight: isActive ? 650 : 500,
              opacity: disabled ? 0.5 : 1,
              whiteSpace: "nowrap",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!isActive && !disabled) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

export function FeaturesConfig() {
  const { t } = useI18n();
  const [features, setFeatures] = useState<FeaturesState>({ tasksBoard: true });
  const [modes, setModes] = useState<ModeSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current feature toggles on mount.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [featuresRes, modesRes] = await Promise.all([
          fetch("/api/features"),
          fetch("/api/modes"),
        ]);
        if (!cancelled && featuresRes.ok) {
          const data = await featuresRes.json() as Partial<FeaturesState>;
          setFeatures((prev) => ({ ...prev, ...data }));
        }
        if (!cancelled && modesRes.ok) {
          const data = await modesRes.json() as Partial<ModeSettings>;
          setModes({
            collaborationMode: normalizeCollaborationMode(data.collaborationMode),
            tokenMode: normalizeTokenMode(data.tokenMode),
            toolApprovalMode: normalizeToolApprovalMode(data.toolApprovalMode),
            permissionRules: data.permissionRules ?? { allow: [], ask: [], deny: [] },
          });
        }
        if (!cancelled) setLoaded(true);
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
        window.dispatchEvent(new CustomEvent(FEATURES_CHANGED_EVENT));
      }
    } catch {
      // Keep current state; the switch will be out of sync until reload.
    } finally {
      setSaving(false);
    }
  }, []);

  const updateMode = useCallback(async (patch: Partial<ModeSettings>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/modes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json() as { modes?: Partial<ModeSettings> };
        setModes((prev) => prev ? {
          ...prev,
          collaborationMode: normalizeCollaborationMode(data.modes?.collaborationMode ?? prev.collaborationMode),
          tokenMode: normalizeTokenMode(data.modes?.tokenMode ?? prev.tokenMode),
          toolApprovalMode: normalizeToolApprovalMode(data.modes?.toolApprovalMode ?? prev.toolApprovalMode),
          permissionRules: data.modes?.permissionRules ?? prev.permissionRules,
        } : prev);
        window.dispatchEvent(new CustomEvent(MODES_CHANGED_EVENT));
      }
    } catch {
      // Keep current state.
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
          <>
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

            {modes && (
              <SettingCard>
                <SettingRow>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 0" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("desktop.featuresCollabDefault")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("desktop.featuresCollabDefaultDesc")}</div>
                    </div>
                    <SegmentedModeSelector
                      options={COLLAB_OPTIONS}
                      value={modes.collaborationMode}
                      onChange={(value) => void updateMode({ collaborationMode: value })}
                      disabled={saving}
                    />
                  </div>
                </SettingRow>
                <SettingRow>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 0" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("desktop.featuresTokenDefault")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("desktop.featuresTokenDefaultDesc")}</div>
                    </div>
                    <SegmentedModeSelector
                      options={TOKEN_OPTIONS}
                      value={modes.tokenMode}
                      onChange={(value) => void updateMode({ tokenMode: value })}
                      disabled={saving}
                    />
                  </div>
                </SettingRow>
                <SettingRowLast>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 0" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("desktop.featuresApprovalDefault")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("desktop.featuresApprovalDefaultDesc")}</div>
                    </div>
                    <SegmentedModeSelector
                      options={APPROVAL_OPTIONS}
                      value={modes.toolApprovalMode}
                      onChange={(value) => void updateMode({ toolApprovalMode: value })}
                      disabled={saving}
                      accentFor={(value) => value === "yolo" ? "var(--accent-red, #ef4444)" : undefined}
                    />
                  </div>
                </SettingRowLast>
              </SettingCard>
            )}
          </>
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
