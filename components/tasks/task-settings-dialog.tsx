"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTasksView } from "@/contexts/tasks-view-context";
import { X } from "@phosphor-icons/react";
import {
  getTaskSettingsOwn,
  saveTaskSettings,
  deleteTaskSettings,
} from "@/lib/task-api";
import { defaultTaskSettings } from "@/lib/task-types";
import type { WorkTaskFolderSettings } from "@/lib/task-types";

interface TaskSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project whose settings are being edited; null = global defaults. */
  projectRoot: string | null;
}

const STAGES = ["work", "retry", "return", "merge"] as const;

/** Per-project task settings — opened from the board's title bar (separate
 *  from the main Settings modal). */
export function TaskSettingsDialog({
  open,
  onOpenChange,
  projectRoot,
}: TaskSettingsDialogProps) {
  const { t } = useI18n();
  const { projects } = useTasksView();

  const [selectedProject, setSelectedProject] = useState<string>("");
  const [settings, setSettings] = useState<WorkTaskFolderSettings>(() => defaultTaskSettings());
  const [hasOwn, setHasOwn] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const target = projectRoot ?? projects[0] ?? "";
    setSelectedProject(target);
    if (!target) return;
    void getTaskSettingsOwn(target)
      .then((own) => {
        setHasOwn(own != null);
        setSettings(own ?? defaultTaskSettings());
      })
      .catch(() => {
        setHasOwn(false);
        setSettings(defaultTaskSettings());
      });
  }, [open, projectRoot, projects]);

  if (!open) return null;

  const set = <K extends keyof WorkTaskFolderSettings>(key: K, value: WorkTaskFolderSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const save = async () => {
    if (!selectedProject || saving) return;
    setSaving(true);
    try {
      await saveTaskSettings(selectedProject, settings);
      setHasOwn(true);
      onOpenChange(false);
    } catch (error) {
      console.error("save settings failed", error);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!selectedProject) return;
    try {
      await deleteTaskSettings(selectedProject);
      setHasOwn(false);
      setSettings(defaultTaskSettings());
    } catch (error) {
      console.error("reset settings failed", error);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12,
    outline: "none", fontFamily: "inherit",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    padding: "10px 0", borderBottom: "1px solid var(--border)",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 960,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(560px, calc(100vw - 48px))",
        maxHeight: "82vh", overflowY: "auto",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("tasks.settingsTitle")}</h3>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("i18n.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{t("tasks.settingsProject")}</span>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} style={inputStyle}>
              {projects.map((p) => (
                <option key={p} value={p}>{p.split("/").filter(Boolean).pop() ?? p}</option>
              ))}
            </select>
          </label>

          {selectedProject ? (
            <>
              <div style={rowStyle}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsAutoProcess")}</span>
                <input
                  type="checkbox"
                  checked={settings.autoProcess}
                  onChange={(e) => set("autoProcess", e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
              </div>

              <div style={rowStyle}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsMaxConcurrent")}</span>
                <input
                  type="number"
                  min={0}
                  value={settings.maxConcurrent}
                  onChange={(e) => set("maxConcurrent", Math.max(0, Number(e.target.value) || 0))}
                  style={{ ...inputStyle, width: 90 }}
                />
              </div>

              <div style={rowStyle}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsMergeStrategy")}</span>
                <select
                  value={settings.mergeStrategy}
                  onChange={(e) => set("mergeStrategy", e.target.value as "squash" | "merge")}
                  style={{ ...inputStyle, width: 140 }}
                >
                  <option value="merge">{t("tasks.mergeStrategyMerge")}</option>
                  <option value="squash">{t("tasks.mergeStrategySquash")}</option>
                </select>
              </div>

              <div style={rowStyle}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsDeleteWorktree")}</span>
                <input
                  type="checkbox"
                  checked={settings.deleteWorktreeDefault}
                  onChange={(e) => set("deleteWorktreeDefault", e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsPreflightCommand")}</span>
                <input
                  value={settings.preflightCommand ?? ""}
                  onChange={(e) => set("preflightCommand", e.target.value || null)}
                  placeholder={t("tasks.settingsPreflightPlaceholder")}
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 11 }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12 }}>{t("tasks.settingsInitCommand")}</span>
                <input
                  value={settings.initCommand ?? ""}
                  onChange={(e) => set("initCommand", e.target.value || null)}
                  placeholder={t("tasks.settingsInitPlaceholder")}
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 11 }}
                />
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t("tasks.settingsStagePrompts")}</span>
                {STAGES.map((stage) => (
                  <label key={stage} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t(`tasks.stage.${stage}`)}</span>
                    <input
                      value={settings.stagePrompts?.[stage] ?? ""}
                      onChange={(e) => set("stagePrompts", {
                        ...(settings.stagePrompts ?? {}),
                        [stage]: e.target.value,
                      })}
                      style={{ ...inputStyle, fontSize: 11 }}
                    />
                  </label>
                ))}
              </div>

              {hasOwn && (
                <button
                  type="button"
                  onClick={() => void reset()}
                  style={{
                    alignSelf: "flex-start", padding: "6px 12px", borderRadius: 8,
                    background: "none", border: "1px solid var(--border)",
                    color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  {t("tasks.settingsReset")}
                </button>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 8 }}>
              {t("tasks.settingsNoProject")}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => onOpenChange(false)} style={{ padding: "8px 14px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {t("i18n.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!selectedProject || saving}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("tasks.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
