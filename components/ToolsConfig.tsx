"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import type { ToolEntry } from "@/lib/tool-presets";
import { SettingCard, SettingRow, SettingRowLast, SettingNote } from "./SettingCard";
import { SettingToggle } from "./SettingToggle";
import { ToolDefinitionsPanel } from "./ToolDefinitionsPanel";

interface Props {
  sessionId: string | null;
  onSessionReloaded: () => void;
}

/** Coding builtins — everything else in the list comes from an extension/MCP. */
const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

/**
 * Tools settings tab: the Windows PowerShell shell toggle (mirrors upstream
 * pi-web v0.8.11), per-extension-tool switches, and a read-only view of the
 * tools the live session exposes.
 *
 * Extension and MCP tools are injected into the active set regardless of the
 * composer's tool preset (that is deliberate — the preset governs coding
 * tools). Switching one off here is therefore the only way to keep e.g. a
 * write-capable extension tool out of a read-only session.
 */
export function ToolsConfig({ sessionId, onSessionReloaded }: Props) {
  const { t } = useI18n();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [disabledError, setDisabledError] = useState<string | null>(null);
  const [savingDisabled, setSavingDisabled] = useState(false);

  const extensionTools = useMemo(
    () => (tools ?? []).filter((tool) => !BUILTIN_TOOL_NAMES.has(tool.name)),
    [tools],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/extension-tools")
      .then(async (response) => {
        const data = await response.json() as { disabled?: string[]; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setDisabledTools(data.disabled ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setDisabledError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const toggleExtensionTool = useCallback(async (name: string, enabled: boolean) => {
    const next = enabled
      ? disabledTools.filter((entry) => entry !== name)
      : [...new Set([...disabledTools, name])];
    setDisabledTools(next);
    setDisabledError(null);
    setSavingDisabled(true);
    try {
      const response = await fetch("/api/tools/extension-tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: next }),
      });
      const data = await response.json() as { disabled?: string[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDisabledTools(data.disabled ?? next);
      // Tool activation is applied when the wrapper (re)builds its tool set, so
      // reload the live session to make the change take effect.
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setDisabledError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingDisabled(false);
    }
  }, [disabledTools, onSessionReloaded, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setTools(null);
      return;
    }
    let cancelled = false;
    setToolsLoading(true);
    void sendAgentCommand<ToolEntry[]>(sessionId, { type: "get_tools" })
      .then((list) => { if (!cancelled) setTools(list ?? []); })
      .catch(() => { if (!cancelled) setTools([]); })
      .finally(() => { if (!cancelled) setToolsLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

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

      {/* Per-extension-tool switches. These tools are injected regardless of
          the composer's tool preset, so this is the only way to keep a
          write-capable one out of a read-only session. */}
      <SettingCard>
        <SettingRow>
          <div style={{ padding: "12px 0 4px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("desktop.extensionToolsTitle")}
          </div>
          <div style={{ paddingBottom: 8, fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
            {sessionId ? t("desktop.extensionToolsHint") : t("desktop.toolsListNoSession")}
          </div>
          {extensionTools.length === 0 && sessionId && !toolsLoading && (
            <div style={{ paddingBottom: 8, fontSize: 11, color: "var(--text-dim)" }}>
              {t("desktop.extensionToolsEmpty")}
            </div>
          )}
          {extensionTools.map((tool) => (
            <SettingToggle
              key={tool.name}
              label={tool.name}
              description={tool.description?.slice(0, 140)}
              checked={!disabledTools.includes(tool.name)}
              onChange={(enabled) => void toggleExtensionTool(tool.name, enabled)}
            />
          ))}
        </SettingRow>
        <SettingRowLast>
          <div style={{ padding: "8px 0 10px", fontSize: 11, lineHeight: 1.5, color: disabledError ? "var(--status-error)" : "var(--text-dim)" }}>
            {disabledError ?? (savingDisabled ? t("desktop.saving") : t("desktop.extensionToolsApplyNote"))}
          </div>
        </SettingRowLast>
      </SettingCard>

      {/* Read-only inventory of the tools the live session exposes. */}
      <SettingCard>
        <SettingRowLast>
          <div style={{ padding: "12px 0 4px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("tools.title")}
          </div>
          <div style={{ paddingBottom: 10, fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
            {sessionId ? t("desktop.toolsListHint") : t("desktop.toolsListNoSession")}
          </div>
        </SettingRowLast>
      </SettingCard>
      {sessionId && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <ToolDefinitionsPanel loading={toolsLoading} tools={tools} translate={t} />
        </div>
      )}
    </div>
  );
}
