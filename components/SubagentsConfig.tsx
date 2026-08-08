"use client";

import { useCallback, useEffect, useState } from "react";
import { Robot } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingNote, SettingRow, SettingRowLast } from "./SettingCard";
import { SettingToggle } from "./SettingToggle";
import type { SubagentsConfig, SubagentsConfigResponse } from "@/lib/api-types";

const JOIN_MODES = ["async", "group", "smart"] as const;
const TOOL_MODES = ["full", "compact", "custom"] as const;
const WIDGET_MODES = ["all", "background", "off"] as const;

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  width: "min(200px, 100%)",
  fontFamily: "var(--font-mono)",
};

function labelStyle(): React.CSSProperties {
  return { fontSize: 12, color: "var(--text-muted)" };
}

export function SubagentsConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<SubagentsConfig>({});
  const [agents, setAgents] = useState<SubagentsConfigResponse["agents"]>([]);
  const [filePath, setFilePath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/subagents");
      const data = (await res.json()) as SubagentsConfigResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfig(data.config ?? {});
      setAgents(data.agents ?? []);
      setFilePath(data.filePath);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const patch = useCallback((key: keyof SubagentsConfig, value: unknown) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/subagents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = (await res.json()) as { error?: string; config?: SubagentsConfig };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfig(data.config ?? {});
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [config]);

  const numberField = (key: "maxConcurrent" | "defaultMaxTurns" | "graceTurns", labelKey: string) => (
    <SettingRow key={key}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 240px) 1fr", gap: "8px 12px", alignItems: "center", padding: "8px 0" }}>
        <span style={labelStyle()}>{t(labelKey)}</span>
        <input
          type="number"
          min={0}
          value={config[key] ?? ""}
          onChange={(event) => patch(key, event.target.value === "" ? undefined : Number(event.target.value))}
          placeholder={key === "defaultMaxTurns" ? "0 = 不限" : ""}
          style={inputStyle}
        />
      </div>
    </SettingRow>
  );

  const selectField = (
    key: "defaultJoinMode" | "toolDescriptionMode" | "widgetMode",
    labelKey: string,
    options: readonly string[],
  ) => (
    <SettingRow key={key}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 240px) 1fr", gap: "8px 12px", alignItems: "center", padding: "8px 0" }}>
        <span style={labelStyle()}>{t(labelKey)}</span>
        <select
          value={config[key] ?? options[0]}
          onChange={(event) => patch(key, event.target.value)}
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        >
          {options.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </SettingRow>
  );

  const toggleField = (
    key: "schedulingEnabled" | "scopeModels" | "disableDefaultAgents" | "fleetView" | "outputTranscript",
    labelKey: string,
    descKey?: string,
  ) => (
    <SettingRow key={key}>
      <SettingToggle
        checked={config[key] ?? false}
        onChange={(value) => patch(key, value)}
        label={t(labelKey)}
        description={descKey ? t(descKey) : undefined}
      />
    </SettingRow>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", minWidth: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!loaded ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loading")}</div>
        ) : loadError ? (
          <div style={{ fontSize: 12, color: "#ef4444" }}>{loadError}</div>
        ) : (
          <>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("desktop.subagents")}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {filePath || "~/.pi/agent/subagents.json"}
              </div>
            </div>

            <SettingNote>{t("desktop.subagentsDesc")}</SettingNote>

            <SettingCard>
              {numberField("maxConcurrent", "desktop.subagentsMaxConcurrent")}
              {numberField("defaultMaxTurns", "desktop.subagentsDefaultMaxTurns")}
              {numberField("graceTurns", "desktop.subagentsGraceTurns")}
              {selectField("defaultJoinMode", "desktop.subagentsJoinMode", JOIN_MODES)}
              {selectField("widgetMode", "desktop.subagentsWidgetMode", WIDGET_MODES)}
              {selectField("toolDescriptionMode", "desktop.subagentsToolDescMode", TOOL_MODES)}
              {toggleField("schedulingEnabled", "desktop.subagentsScheduling", "desktop.subagentsSchedulingDesc")}
              {toggleField("scopeModels", "desktop.subagentsScopeModels", "desktop.subagentsScopeModelsDesc")}
              {toggleField("disableDefaultAgents", "desktop.subagentsDisableDefault", "desktop.subagentsDisableDefaultDesc")}
              {toggleField("fleetView", "desktop.subagentsFleetView", "desktop.subagentsFleetViewDesc")}
              <SettingRowLast>
                {toggleField("outputTranscript", "desktop.subagentsOutputTranscript", "desktop.subagentsOutputTranscriptDesc")}
              </SettingRowLast>
            </SettingCard>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                style={{
                  padding: "7px 12px",
                  border: "none",
                  borderRadius: 6,
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: saving ? "wait" : "pointer",
                  fontSize: 12,
                }}
              >
                {saving ? t("desktop.saving") : t("desktop.mcpSave")}
              </button>
              {saved && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.subagentsSaved")}</span>}
              {saveError && <span style={{ color: "#ef4444", fontSize: 12 }}>{saveError}</span>}
            </div>

            {agents.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                  <Robot size={15} aria-hidden="true" />
                  {t("desktop.subagentsDiscovered")}
                </div>
                <SettingCard>
                  {agents.map((agent, index) => (
                    <SettingRowLast key={agent.name}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: index === agents.length - 1 ? "12px 0" : "12px 0 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                            {agent.name}
                          </span>
                          {agent.displayName && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{agent.displayName}</span>
                          )}
                          {agent.model && (
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                              {agent.model}
                            </span>
                          )}
                        </div>
                        {agent.description && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{agent.description}</div>
                        )}
                      </div>
                    </SettingRowLast>
                  ))}
                </SettingCard>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}