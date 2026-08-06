"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Circle, XCircle } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";

interface ProxyConfigData {
  enabled: boolean;
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username: string;
  password: string;
  noProxy: string;
  hasPassword: boolean;
}

type TestResult = {
  ok: boolean;
  message: string;
  latencyMs?: number;
};

export function ProxyConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ProxyConfigData>({
    enabled: false,
    protocol: "http",
    host: "127.0.0.1",
    port: 7890,
    username: "",
    password: "",
    noProxy: "localhost,127.0.0.1,.local",
    hasPassword: false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/proxy");
        if (res.ok) {
          const data = await res.json();
          setConfig((prev) => ({
            ...prev,
            ...data,
            password: "", // Never populate password from server
          }));
        }
      } catch {
        // Silent fail; use defaults
      }
    };
    loadConfig();
  }, []);

  const handleChange = useCallback(
    <K extends keyof ProxyConfigData>(
      key: K,
      value: ProxyConfigData[K]
    ) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      if (key === "password") setPasswordTouched(true);
      setDirty(true);
      setSaveSuccess(null);
      setSaveError(null);
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const body: { [K in keyof ProxyConfigData]?: ProxyConfigData[K] } = { ...config };
      // hasPassword is response metadata, never a config field.
      delete body.hasPassword;
      // Only send password when the user actually typed one. An empty
      // untouched field must not wipe the stored password; an explicitly
      // cleared field sends "" to remove it.
      if (!passwordTouched) delete body.password;
      const res = await fetch("/api/proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveSuccess(true);
        setDirty(false);
        setPasswordTouched(false);
        // Reload config to get hasPassword state
        const reloadRes = await fetch("/api/proxy");
        if (reloadRes.ok) {
          const reloadData = await reloadRes.json();
          setConfig((prev) => ({
            ...prev,
            ...reloadData,
            password: "",
          }));
        }
      } else {
        setSaveSuccess(false);
        setSaveError(data.error || t("desktop.proxySaveFailed"));
      }
    } catch (error) {
      setSaveSuccess(false);
      setSaveError(error instanceof Error ? error.message : t("desktop.proxySaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [config, passwordTouched, t]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    // Save first if dirty
    if (dirty) {
      await handleSave();
    }
    try {
      const res = await fetch("/api/proxy/test", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          ok: true,
          message: `${t("desktop.proxyTestSuccess")} · ${data.latencyMs}ms`,
          latencyMs: data.latencyMs,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || t("desktop.proxyTestFailed"),
        });
      }
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : t("desktop.proxyTestFailed"),
      });
    } finally {
      setTesting(false);
    }
  }, [dirty, handleSave, t]);

  const buildPreviewUrl = useCallback(() => {
    if (!config.enabled || !config.host || !config.port) return null;
    let auth = "";
    if (config.username && config.password) {
      auth = `${config.username}:${"•".repeat(Math.min(config.password.length, 8))}@`;
    } else if (config.username) {
      auth = `${config.username}@`;
    }
    return `${config.protocol}://${auth}${config.host}:${config.port}`;
  }, [config.enabled, config.host, config.port, config.protocol, config.username, config.password]);

  const previewUrl = buildPreviewUrl();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "16px 20px",
        overflow: "auto",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => handleChange("enabled", e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
          />
          {t("desktop.proxyEnable")}
        </label>
        {config.enabled && previewUrl && (
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              backgroundColor: "var(--bg-hover)",
              padding: "2px 10px",
              borderRadius: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "60%",
            }}
            title={previewUrl}
          >
            {previewUrl}
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px 16px",
          opacity: config.enabled ? 1 : 0.5,
          pointerEvents: config.enabled ? "auto" : "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.proxyProtocol")}</label>
          <select
            value={config.protocol}
            onChange={(e) => handleChange("protocol", e.target.value as ProxyConfigData["protocol"])}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.proxyHost")}</label>
          <input
            type="text"
            value={config.host}
            onChange={(e) => handleChange("host", e.target.value)}
            placeholder="127.0.0.1"
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.proxyPort")}</label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => handleChange("port", parseInt(e.target.value, 10) || 0)}
            placeholder="7890"
            min={1}
            max={65535}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.proxyUsername")}</label>
          <input
            type="text"
            value={config.username}
            onChange={(e) => handleChange("username", e.target.value)}
            placeholder={config.username ? "" : t("desktop.proxyUsername")}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.proxyPassword")}</label>
          <input
            type="password"
            value={config.password}
            onChange={(e) => handleChange("password", e.target.value)}
            placeholder={config.hasPassword ? "••••••••" : t("desktop.proxyPassword")}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("desktop.proxyNoProxy")}
          </label>
          <input
            type="text"
            value={config.noProxy}
            onChange={(e) => handleChange("noProxy", e.target.value)}
            placeholder="localhost,127.0.0.1,.local"
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "6px 18px",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.5 : 1,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            if (!saving) e.currentTarget.style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (!saving) e.currentTarget.style.background = "var(--accent)";
          }}
        >
          {saving ? t("desktop.proxySaving") : t("desktop.proxySave")}
        </button>

        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !config.enabled}
          style={{
            padding: "6px 18px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: config.enabled ? "var(--text)" : "var(--text-muted)",
            fontSize: 13,
            fontWeight: 500,
            cursor: config.enabled ? "pointer" : "not-allowed",
            opacity: config.enabled ? 1 : 0.5,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            if (config.enabled) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (config.enabled) e.currentTarget.style.background = "var(--bg)";
          }}
        >
          {testing ? t("desktop.proxyTesting") : t("desktop.proxyTest")}
        </button>
      </div>

      {/* Status messages */}
      {saveSuccess === true && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 6,
            backgroundColor: "rgba(34, 197, 94, 0.12)",
            color: "#22c55e",
            fontSize: 13,
          }}
        >
          <CheckCircle size={16} weight="fill" />
          {t("desktop.proxySaved")}
        </div>
      )}

      {saveSuccess === false && saveError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 6,
            backgroundColor: "rgba(239, 68, 68, 0.10)",
            color: "#ef4444",
            fontSize: 13,
          }}
        >
          <XCircle size={16} weight="fill" />
          {saveError}
        </div>
      )}

      {testResult && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 6,
            backgroundColor: testResult.ok
              ? "rgba(34, 197, 94, 0.10)"
              : "rgba(239, 68, 68, 0.10)",
            color: testResult.ok ? "#22c55e" : "#ef4444",
            fontSize: 13,
          }}
        >
          {testResult.ok ? (
            <CheckCircle size={16} weight="fill" />
          ) : (
            <XCircle size={16} weight="fill" />
          )}
          {testResult.message}
          {testResult.latencyMs !== undefined && (
            <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 4 }}>
              ({testResult.latencyMs}ms)
            </span>
          )}
        </div>
      )}

      {dirty && !saveSuccess && !saveError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 12px",
            borderRadius: 6,
            backgroundColor: "var(--bg-hover)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <Circle size={12} weight="fill" />
          {t("desktop.proxyUnsaved")}
        </div>
      )}
    </div>
  );
}
