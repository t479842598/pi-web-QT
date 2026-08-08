"use client";

import { useCallback, useEffect, useState } from "react";
import { PencilSimple, PlusIcon, Trash } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingNote, SettingRow, SettingRowLast } from "./SettingCard";
import type { McpConfigResponse, McpServerConfig } from "@/lib/api-types";

const TRANSPORTS = ["stdio", "sse", "http"] as const;
const LIFECYCLES = ["eager", "lazy"] as const;

interface FormState {
  name: string;
  command: string;
  args: string; // one per line
  transport: string;
  lifecycle: string;
  requestTimeoutMs: string;
  env: string; // JSON
}

const emptyForm: FormState = {
  name: "",
  command: "",
  args: "",
  transport: "stdio",
  lifecycle: "eager",
  requestTimeoutMs: "",
  env: "",
};

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

function badgeStyle(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 3,
    background: bg,
    color,
    flexShrink: 0,
    textTransform: "capitalize",
  };
}

function serverToForm(name: string, server: McpServerConfig): FormState {
  return {
    name,
    command: server.command ?? "",
    args: Array.isArray(server.args) ? server.args.join("\n") : "",
    transport: typeof server.transport === "string" ? server.transport : "stdio",
    lifecycle: typeof server.lifecycle === "string" ? server.lifecycle : "eager",
    requestTimeoutMs:
      typeof server.requestTimeoutMs === "number" ? String(server.requestTimeoutMs) : "",
    env:
      server.env !== undefined ? JSON.stringify(server.env, null, 2) : "",
  };
}

function formToServer(form: FormState): { error?: string; server?: McpServerConfig } {
  if (!form.command.trim()) return { error: "Command is required" };
  const args = form.args
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const server: McpServerConfig = {
    command: form.command.trim(),
    args,
    transport: (TRANSPORTS as readonly string[]).includes(form.transport)
      ? form.transport as McpServerConfig["transport"]
      : "stdio",
    lifecycle: (LIFECYCLES as readonly string[]).includes(form.lifecycle)
      ? form.lifecycle as McpServerConfig["lifecycle"]
      : "eager",
  };
  if (form.requestTimeoutMs.trim() !== "") {
    const ms = Number(form.requestTimeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return { error: "Request timeout must be a positive number" };
    server.requestTimeoutMs = ms;
  }
  if (form.env.trim() !== "") {
    try {
      server.env = JSON.parse(form.env) as unknown;
    } catch {
      return { error: "Environment must be valid JSON" };
    }
  }
  return { server };
}

export function McpConfig() {
  const { t } = useI18n();
  const [servers, setServers] = useState<Record<string, McpServerConfig>>({});
  const [filePath, setFilePath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string; isNew: boolean } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/mcp");
      const data = (await res.json()) as McpConfigResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(data.mcpServers ?? {});
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

  const startAdd = useCallback(() => {
    setForm(emptyForm);
    setEditing({ name: "", isNew: true });
    setSaveError(null);
    setSaved(false);
  }, []);

  const startEdit = useCallback((name: string, server: McpServerConfig) => {
    setForm(serverToForm(name, server));
    setEditing({ name, isNew: false });
    setSaveError(null);
    setSaved(false);
  }, []);

  const saveServer = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const name = form.name.trim();
      if (editing.isNew && !name) {
        setSaveError("Server name is required");
        return;
      }
      if (editing.isNew && !/^[a-zA-Z0-9_-]+$/.test(name)) {
        setSaveError("Allowed characters: a-z, A-Z, 0-9, _ and -");
        return;
      }
      const built = formToServer(form);
      if (built.error || !built.server) {
        setSaveError(built.error ?? "Invalid server");
        return;
      }
      const next = { ...servers };
      if (editing.isNew) {
        next[name] = built.server;
      } else {
        delete next[editing.name];
        next[form.name.trim() || editing.name] = built.server;
      }
      const res = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(next);
      setEditing(null);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [editing, form, servers]);

  const deleteServer = useCallback(async (name: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const next = { ...servers };
      delete next[name];
      const res = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(next);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [servers]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const entries = Object.entries(servers);

  return (
    <div style={{ flex: 1, overflow: "auto", minWidth: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!loaded ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loading")}</div>
        ) : loadError ? (
          <div style={{ fontSize: 12, color: "#ef4444" }}>{loadError}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("desktop.mcpServers")}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {filePath}
                </div>
              </div>
              <button
                type="button"
                onClick={startAdd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  border: "none",
                  borderRadius: 6,
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                <PlusIcon size={13} aria-hidden="true" />
                {t("desktop.mcpAddServer")}
              </button>
            </div>

            <SettingNote>{t("desktop.mcpRestartNote")}</SettingNote>

            {entries.length === 0 && !editing ? (
              <SettingCard>
                <SettingRowLast>
                  <div style={{ padding: "14px 0", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("desktop.mcpEmpty")}
                  </div>
                </SettingRowLast>
              </SettingCard>
            ) : (
              entries.map(([name, server]) => (
                <SettingCard key={name}>
                  <SettingRowLast>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", minWidth: 0 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                            {name}
                          </span>
                          <span style={badgeStyle("var(--accent)", "rgba(37,99,235,0.12)")}>
                            {server.transport ?? "stdio"}
                          </span>
                          <span style={badgeStyle("#d97706", "rgba(245,158,11,0.12)")}>
                            {server.lifecycle ?? "lazy"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {server.command}
                          {Array.isArray(server.args) && server.args.length > 0
                            ? ` ${server.args.map((arg) => arg.includes(" ") ? `"${arg}"` : arg).join(" ")}`
                            : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => startEdit(name, server)}
                          disabled={saving}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 10px",
                            background: "none",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text-muted)",
                            cursor: saving ? "not-allowed" : "pointer",
                            fontSize: 12,
                            opacity: saving ? 0.5 : 1,
                          }}
                        >
                          <PencilSimple size={12} aria-hidden="true" />
                          {t("desktop.mcpEdit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteServer(name)}
                          disabled={saving}
                          title={t("desktop.mcpDelete")}
                          aria-label={t("desktop.mcpDelete")}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "6px 9px",
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "#ef4444",
                            cursor: saving ? "not-allowed" : "pointer",
                            fontSize: 12,
                            opacity: saving ? 0.5 : 1,
                          }}
                        >
                          <Trash size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </SettingRowLast>
                </SettingCard>
              ))
            )}

            {editing && (
              <SettingCard>
                <SettingRow>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", padding: "12px 0 4px" }}>
                    {editing.isNew ? t("desktop.mcpNewServer") : t("desktop.mcpEditServer", { name: editing.name })}
                  </div>
                </SettingRow>
                <SettingRow>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 220px) 1fr", gap: "8px 12px", alignItems: "center", padding: "8px 0" }}>
                    <span style={labelStyle()}>{t("desktop.mcpServerName")}</span>
                    <input
                      value={form.name}
                      onChange={(event) => setField("name", event.target.value)}
                      disabled={!editing.isNew}
                      placeholder="my-server"
                      style={{ ...inputStyle, opacity: editing.isNew ? 1 : 0.5 }}
                    />
                    <span style={labelStyle()}>{t("desktop.mcpCommand")} *</span>
                    <input
                      value={form.command}
                      onChange={(event) => setField("command", event.target.value)}
                      placeholder="npx @modelcontextprotocol/server-foo"
                      style={inputStyle}
                    />
                    <span style={labelStyle()}>{t("desktop.mcpArgs")}</span>
                    <textarea
                      value={form.args}
                      onChange={(event) => setField("args", event.target.value)}
                      placeholder={"--port 3000\n--verbose"}
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                    />
                    <span style={labelStyle()}>{t("desktop.mcpTransport")}</span>
                    <select
                      value={form.transport}
                      onChange={(event) => setField("transport", event.target.value)}
                      style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    >
                      {TRANSPORTS.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <span style={labelStyle()}>{t("desktop.mcpLifecycle")}</span>
                    <select
                      value={form.lifecycle}
                      onChange={(event) => setField("lifecycle", event.target.value)}
                      style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    >
                      {LIFECYCLES.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <span style={labelStyle()}>{t("desktop.mcpRequestTimeoutMs")}</span>
                    <input
                      type="number"
                      min={1}
                      value={form.requestTimeoutMs}
                      onChange={(event) => setField("requestTimeoutMs", event.target.value)}
                      placeholder="300000"
                      style={inputStyle}
                    />
                    <span style={labelStyle()}>{t("desktop.mcpEnv")}</span>
                    <textarea
                      value={form.env}
                      onChange={(event) => setField("env", event.target.value)}
                      placeholder={'{\n  "API_KEY": "..."\n}'}
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                    />
                  </div>
                </SettingRow>
                <SettingRowLast>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
                    <button
                      type="button"
                      onClick={() => void saveServer()}
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
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      disabled={saving}
                      style={{
                        padding: "7px 12px",
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text-muted)",
                        cursor: saving ? "not-allowed" : "pointer",
                        fontSize: 12,
                      }}
                    >
                      {t("desktop.mcpCancel")}
                    </button>
                    {saveError && <span style={{ color: "#ef4444", fontSize: 12 }}>{saveError}</span>}
                  </div>
                </SettingRowLast>
              </SettingCard>
            )}

            {saved && !editing && (
              <div style={{ fontSize: 12, color: "#22c55e" }}>{t("desktop.mcpSavedRestart")}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}