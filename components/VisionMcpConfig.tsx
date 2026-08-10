"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingRow, SettingRowLast, SettingNote } from "./SettingCard";
import type { McpConfigResponse, McpServerConfig } from "@/lib/api-types";
import type { SafeVisionConfig } from "@/lib/vision-config";

export const VISION_SERVER_NAME = "deepseek-vision";

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  width: "100%",
  boxSizing: "border-box",
};

function labelStyle(): React.CSSProperties {
  return { fontSize: 12, color: "var(--text-muted)" };
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 12px",
  border: "none",
  borderRadius: 6,
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

/**
 * Dedicated configuration card for the built-in deepseek-vision MCP server.
 *
 * It manages two independent configuration layers:
 *  1. MCP registration (mcp.json) — command / lifecycle.
 *  2. Model configuration (.env next to the plugin) — provider / baseUrl /
 *     apiKey / model / maxTokens, persisted via /api/vision-config.
 *
 * The generic server list in McpConfig hides this entry so the built-in
 * server can only be managed here (no accidental delete from the generic UI).
 */
export function VisionMcpConfig({ sessionId }: { sessionId?: string | null }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Restart (immediate effect)
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartDone, setRestartDone] = useState(false);

  // MCP registration (mcp.json)
  const [servers, setServers] = useState<Record<string, McpServerConfig>>({});
  const [mcpFilePath, setMcpFilePath] = useState("");
  const [command, setCommand] = useState("");
  const [lifecycle, setLifecycle] = useState<"eager" | "lazy">("eager");
  const [savingReg, setSavingReg] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSaved, setRegSaved] = useState(false);
  const [regRemoved, setRegRemoved] = useState(false);

  // Model configuration (.env)
  const [vision, setVision] = useState<SafeVisionConfig>({
    provider: "custom",
    baseUrl: "",
    apiKey: "",
    model: "",
    maxTokens: 4096,
    hasApiKey: false,
  });
  const [visionKey, setVisionKey] = useState("");
  const [envPath, setEnvPath] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelSaved, setModelSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadError(null);
      try {
        const [mcpRes, visionRes] = await Promise.all([
          fetch("/api/mcp"),
          fetch("/api/vision-config"),
        ]);
        const mcpData = (await mcpRes.json()) as McpConfigResponse & { error?: string };
        if (!mcpRes.ok || mcpData.error) throw new Error(mcpData.error ?? `HTTP ${mcpRes.status}`);
        const visionData = (await visionRes.json()) as SafeVisionConfig & { path?: string; error?: string };
        if (!visionRes.ok || visionData.error) throw new Error(visionData.error ?? `HTTP ${visionRes.status}`);
        if (cancelled) return;
        setServers(mcpData.mcpServers ?? {});
        setMcpFilePath(mcpData.filePath);
        const entry = (mcpData.mcpServers ?? {})[VISION_SERVER_NAME];
        setCommand(entry?.command ?? "");
        setLifecycle(entry?.lifecycle === "lazy" ? "lazy" : "eager");
        setVision({
          provider: visionData.provider,
          baseUrl: visionData.baseUrl,
          apiKey: "",
          model: visionData.model,
          maxTokens: visionData.maxTokens,
          hasApiKey: visionData.hasApiKey,
        });
        if (visionData.path) setEnvPath(visionData.path);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveRegistration = useCallback(async () => {
    if (!command.trim()) {
      setRegError(t("desktop.mcpVisionCommandRequired"));
      return;
    }
    setSavingReg(true);
    setRegError(null);
    setRegSaved(false);
    setRegRemoved(false);
    try {
      const existing = servers[VISION_SERVER_NAME];
      const next: Record<string, McpServerConfig> = {
        ...servers,
        [VISION_SERVER_NAME]: {
          ...(existing ?? {}),
          command: command.trim(),
          args: Array.isArray(existing?.args) ? existing.args : [],
          transport: "stdio",
          lifecycle,
        },
      };
      const res = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(next);
      setRegSaved(true);
    } catch (error) {
      setRegError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingReg(false);
    }
  }, [servers, command, lifecycle, t]);

  const removeRegistration = useCallback(async () => {
    setSavingReg(true);
    setRegError(null);
    setRegSaved(false);
    setRegRemoved(false);
    try {
      const next = { ...servers };
      delete next[VISION_SERVER_NAME];
      const res = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(next);
      setCommand("");
      setLifecycle("eager");
      setRegRemoved(true);
    } catch (error) {
      setRegError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingReg(false);
    }
  }, [servers]);

  const saveModel = useCallback(async () => {
    setSavingModel(true);
    setModelError(null);
    setModelSaved(false);
    try {
      const res = await fetch("/api/vision-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...vision, ...(visionKey ? { apiKey: visionKey } : {}) }),
      });
      const data = (await res.json()) as SafeVisionConfig & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setVision({ ...data, apiKey: "", hasApiKey: data.hasApiKey });
      setVisionKey("");
      setModelSaved(true);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingModel(false);
    }
  }, [vision, visionKey]);

  /** Restart the running server so .env changes take effect immediately. */
  const restartServer = useCallback(async () => {
    if (!sessionId) return;
    setRestarting(true);
    setRestartError(null);
    setRestartDone(false);
    try {
      const res = await fetch("/api/mcp/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name: VISION_SERVER_NAME }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRestartDone(true);
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, [sessionId]);

  const registered = Boolean(servers[VISION_SERVER_NAME]);

  return (
    <SettingCard>
      <SettingRow>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 0" }}>
          <Eye size={15} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("desktop.mcpVisionTitle")}</span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: registered ? "rgba(37,99,235,0.12)" : "rgba(245,158,11,0.12)",
                  color: registered ? "var(--accent)" : "#d97706",
                  textTransform: "capitalize",
                }}
              >
                {registered ? t("desktop.mcpVisionRegistered") : t("desktop.mcpVisionNotRegistered")}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("desktop.mcpVisionDesc")}</div>
          </div>
        </div>
      </SettingRow>

      {!loaded ? (
        <SettingRowLast>
          <div style={{ padding: "8px 0", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loading")}</div>
        </SettingRowLast>
      ) : loadError ? (
        <SettingRowLast>
          <div style={{ padding: "8px 0", fontSize: 12, color: "#ef4444" }}>{loadError}</div>
        </SettingRowLast>
      ) : (
        <>
          {/* ---- MCP registration ---- */}
          <SettingRow>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", padding: "10px 0 2px" }}>
              {t("desktop.mcpVisionRegistration")}
            </div>
          </SettingRow>
          <SettingRow>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: 8, alignItems: "center", padding: "6px 0" }}>
              <span style={labelStyle()}>{t("desktop.mcpVisionCommand")} *</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="/path/to/deepseek-vision-mcp"
                style={inputStyle}
              />
              <span style={labelStyle()}>{t("desktop.mcpVisionLifecycle")}</span>
              <select
                value={lifecycle}
                onChange={(event) => setLifecycle(event.target.value as "eager" | "lazy")}
                style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              >
                <option value="eager">eager</option>
                <option value="lazy">lazy</option>
              </select>
              <span style={labelStyle()}>{t("desktop.mcpVisionTransport")}</span>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", padding: "7px 0" }}>
                {t("desktop.mcpVisionTransportFixed")}
              </div>
            </div>
          </SettingRow>
          <SettingRow>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void saveRegistration()}
                disabled={savingReg}
                style={{ ...primaryButtonStyle, cursor: savingReg ? "wait" : "pointer" }}
              >
                {savingReg ? t("desktop.saving") : t("desktop.mcpVisionSaveReg")}
              </button>
              {registered && (
                <button
                  type="button"
                  onClick={() => void removeRegistration()}
                  disabled={savingReg}
                  title={t("desktop.mcpVisionRemove")}
                  style={{
                    padding: "7px 12px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "#ef4444",
                    cursor: savingReg ? "not-allowed" : "pointer",
                    fontSize: 12,
                  }}
                >
                  {t("desktop.mcpVisionRemove")}
                </button>
              )}
              {regSaved && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.mcpVisionSavedReg")}</span>}
              {regRemoved && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.mcpVisionRemoved")}</span>}
              {regError && <span style={{ color: "#ef4444", fontSize: 12 }}>{regError}</span>}
            </div>
          </SettingRow>

          {/* ---- Model configuration ---- */}
          <SettingRow>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", padding: "10px 0 2px" }}>
              {t("desktop.mcpVisionModelConfig")}
            </div>
          </SettingRow>
          <SettingRow>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: 8, alignItems: "center", padding: "6px 0" }}>
              <span style={labelStyle()}>{t("desktop.mcpVisionProvider")}</span>
              <input value={vision.provider} onChange={(event) => setVision((current) => ({ ...current, provider: event.target.value }))} style={inputStyle} />
              <span style={labelStyle()}>{t("desktop.mcpVisionBaseUrl")}</span>
              <input value={vision.baseUrl} onChange={(event) => setVision((current) => ({ ...current, baseUrl: event.target.value }))} style={inputStyle} />
              <span style={labelStyle()}>{t("desktop.mcpVisionApiKey")}</span>
              <input
                type="password"
                value={visionKey}
                onChange={(event) => setVisionKey(event.target.value)}
                placeholder={vision.hasApiKey ? "••••••••" : "API key"}
                style={inputStyle}
              />
              <span style={labelStyle()}>{t("desktop.mcpVisionModel")}</span>
              <input value={vision.model} onChange={(event) => setVision((current) => ({ ...current, model: event.target.value }))} style={inputStyle} />
              <span style={labelStyle()}>{t("desktop.mcpVisionMaxTokens")}</span>
              <input
                type="number"
                min={1}
                value={vision.maxTokens}
                onChange={(event) => setVision((current) => ({ ...current, maxTokens: Number(event.target.value) || 1 }))}
                style={inputStyle}
              />
            </div>
          </SettingRow>
          <SettingRowLast>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void saveModel()}
                  disabled={savingModel}
                  style={{ ...primaryButtonStyle, cursor: savingModel ? "wait" : "pointer" }}
                >
                  {savingModel ? t("desktop.saving") : t("desktop.mcpVisionSaveModel")}
                </button>
                <button
                  type="button"
                  onClick={() => void restartServer()}
                  disabled={restarting || !sessionId || !registered}
                  title={sessionId ? t("desktop.mcpVisionRestartTitle") : t("desktop.mcpVisionRestartNoSession")}
                  style={{
                    padding: "7px 12px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text-muted)",
                    cursor: restarting || !sessionId || !registered ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: restarting || !sessionId || !registered ? 0.5 : 1,
                  }}
                >
                  {restarting ? t("desktop.mcpVisionRestarting") : t("desktop.mcpVisionRestart")}
                </button>
                {modelSaved && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.mcpVisionSavedModel")}</span>}
                {restartDone && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.mcpVisionRestarted")}</span>}
                {modelError && <span style={{ color: "#ef4444", fontSize: 12 }}>{modelError}</span>}
                {restartError && <span style={{ color: "#ef4444", fontSize: 12 }}>{restartError}</span>}
              </div>
              <SettingNote>
                {t("desktop.mcpVisionModelNote")}
                {envPath && <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 10 }}>{envPath}</div>}
                {mcpFilePath && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{mcpFilePath}</div>}
              </SettingNote>
            </div>
          </SettingRowLast>
        </>
      )}
    </SettingCard>
  );
}
