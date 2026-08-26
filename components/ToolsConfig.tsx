"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import { SettingCard, SettingRow, SettingRowLast, SettingNote } from "./SettingCard";
import { SettingToggle } from "./SettingToggle";

interface Props {
  sessionId: string | null;
  onSessionReloaded: () => void;
}

/**
 * Tools settings tab. Currently hosts the Windows PowerShell shell toggle
 * (mirrors upstream pi-web v0.8.11); non-Windows platforms show a note.
 */
export function ToolsConfig({ sessionId, onSessionReloaded }: Props) {
  const { t } = useI18n();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = useCallback(async (enabled: boolean) => {
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onSessionReloaded, sessionId]);

  return (
    <div style={{ padding: 16, overflowY: "auto", minHeight: 0, flex: 1 }}>
      <SettingCard>
        <SettingRow>
          <SettingToggle
            label={t("desktop.usePowerShell")}
            description={t("desktop.shellToolDescription")}
            checked={shellSettings?.powerShellEnabled ?? false}
            onChange={(enabled) => void togglePowerShell(enabled)}
          />
        </SettingRow>
        <SettingRowLast>
          <div style={{ padding: "10px 0", fontSize: 12, lineHeight: 1.5, color: "var(--text-dim)" }}>
            {shellSettings?.isWindows
              ? t("desktop.shellToolWindowsOnly")
              : (shellError ?? t("desktop.shellToolMacOnly"))}
          </div>
        </SettingRowLast>
      </SettingCard>
    </div>
  );
}
