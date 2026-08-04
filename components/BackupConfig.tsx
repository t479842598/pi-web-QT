"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Download, Upload, Warning } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";

interface AdaptedServer {
  name: string;
  original: { command: string; args: string[] };
  adapted: { command: string; args: string[] } | null;
  action: "restore-script" | "generate-cmd" | "keep" | "keep-with-warning" | "manual";
  platform: string;
  reason?: string;
  installPrompt?: string;
}

interface BackupManifest {
  createdAt: string;
  piWebVersion: string;
  piSdkVersion: string;
  sourcePlatform: string;
  includeSecrets: boolean;
  includeSessions: boolean;
  localPackages: string[];
  mcpBinScripts: string[];
}

interface BackupPreview {
  manifest: BackupManifest;
  categories: string[];
  servers: AdaptedServer[];
  warnings: string[];
  npmPackages: string[];
}

interface RestoreReport {
  restored: string[];
  needsRestart: string[];
  manual: Array<{ server: string; message: string }>;
  warnings: string[];
}

interface PreviewResponse {
  phase: "preview";
  token: string;
  preview: BackupPreview;
}

interface ReportResponse {
  phase: "report";
  report: RestoreReport;
}

const ACTION_LABELS: Record<AdaptedServer["action"], string> = {
  "restore-script": "restore",
  "generate-cmd": "cmd",
  keep: "keep",
  "keep-with-warning": "warning",
  manual: "manual",
};

export function BackupConfig({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Export ──
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ── Import preview ──
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [skippedServers, setSkippedServers] = useState<Set<string>>(new Set());
  const [reinstallNpm, setReinstallNpm] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);

  // ── AI install session ──
  const [availableModels, setAvailableModels] = useState<Array<{ provider: string; id: string; name: string }>>([]);
  const [installModel, setInstallModel] = useState("");
  const [installingServer, setInstallingServer] = useState<string | null>(null);
  const [installDone, setInstallDone] = useState<{ server: string; sessionId: string } | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models?: Array<{ id: string; name: string; provider: string }> }) => {
        const models = d.models ?? [];
        setAvailableModels(models);
        if (models.length > 0) {
          setInstallModel(`${models[0].provider}/${models[0].id}`);
        }
      })
      .catch(() => {});
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/backup/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeSecrets, includeSessions }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setExportError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "pi-backup.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(String(t("desktop.backupExportFailed")));
    } finally {
      setExporting(false);
    }
  }, [includeSecrets, includeSessions, t]);

  const handleFileSelected = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setReport(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("phase", "parse");
      form.append("file", file);
      const res = await fetch("/api/backup/import", { method: "POST", body: form });
      const data = (await res.json()) as { error?: string } & Partial<PreviewResponse>;
      if (!res.ok || data.error) {
        setImportError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.phase !== "preview" || !data.preview) {
        setImportError(String(t("desktop.backupImportFailed")));
        return;
      }
      setPreview(data as PreviewResponse);
      setSelectedCategories(new Set(data.preview.categories));
      setSkippedServers(new Set());
      setReinstallNpm(false);
    } catch {
      setImportError(String(t("desktop.backupImportFailed")));
    }
  }, [t]);

  const handleRestore = useCallback(async () => {
    if (!preview) return;
    setRestoring(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("phase", "restore");
      form.append("token", preview.token);
      form.append(
        "selections",
        JSON.stringify({
          categories: [...selectedCategories],
          skippedMcpServers: [...skippedServers],
          reinstallNpm,
        }),
      );
      const res = await fetch("/api/backup/import", { method: "POST", body: form });
      const data = (await res.json()) as { error?: string } & Partial<ReportResponse>;
      if (!res.ok || data.error) {
        setImportError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.phase !== "report" || !data.report) {
        setImportError(String(t("desktop.backupRestoreFailed")));
        return;
      }
      setReport(data.report);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setImportError(String(t("desktop.backupRestoreFailed")));
    } finally {
      setRestoring(false);
    }
  }, [preview, selectedCategories, skippedServers, reinstallNpm, t]);

  const handleCreateInstallSession = useCallback(async (server: AdaptedServer) => {
    if (!server.installPrompt || !cwd) return;
    setInstallingServer(server.name);
    setInstallDone(null);
    try {
      const slash = installModel.indexOf("/");
      const provider = slash > 0 ? installModel.slice(0, slash) : undefined;
      const modelId = slash > 0 ? installModel.slice(slash + 1) : undefined;
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: server.installPrompt, provider, modelId }),
      });
      const d = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || d.error) {
        setImportError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setInstallDone({ server: server.name, sessionId: d.sessionId! });
    } catch {
      setImportError(String(t("desktop.backupInstallSessionFailed")));
    } finally {
      setInstallingServer(null);
    }
  }, [cwd, installModel, t]);

  const platformLabel = (platform: string) =>
    platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.backup")}</h1>
      </header>

      {/* ── Export ── */}
      <section style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {t("desktop.backupExportTitle")}
        </h2>
        <p style={{ margin: "6px 0 12px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("desktop.backupExportDescription")}
        </p>

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={includeSecrets}
            onChange={(e) => setIncludeSecrets(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 12, color: "var(--text)" }}>
            {t("desktop.backupIncludeSecrets")}
            <span style={{ display: "block", fontSize: 11, color: "#ef4444" }}>{t("desktop.backupSecretsWarning")}</span>
          </span>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={includeSessions}
            onChange={(e) => setIncludeSessions(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 12, color: "var(--text)" }}>
            {t("desktop.backupIncludeSessions")}
            <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.backupSessionsHint")}</span>
          </span>
        </label>

        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", background: "var(--accent)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: exporting ? "wait" : "pointer" }}
        >
          <Download size={15} aria-hidden="true" />
          {exporting ? t("desktop.backupExporting") : t("desktop.backupExportButton")}
        </button>
        {exportError && (
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#ef4444" }}>{exportError}</p>
        )}
      </section>

      {/* ── Import ── */}
      <section style={{ padding: "18px 22px" }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {t("desktop.backupImportTitle")}
        </h2>
        <p style={{ margin: "6px 0 12px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("desktop.backupImportDescription")}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => handleFileSelected(e.target.files?.[0])}
          style={{ fontSize: 12, marginBottom: 14, color: "var(--text)" }}
        />

        {importError && (
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>{importError}</p>
        )}

        {/* Preview */}
        {preview && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{t("desktop.backupManifest")}:</span>{" "}
              {new Date(preview.preview.manifest.createdAt).toLocaleString()} · {platformLabel(preview.preview.manifest.sourcePlatform)} →
              {platformLabel(navigator.platform.includes("Win") ? "win32" : "darwin")} · pi-web {preview.preview.manifest.piWebVersion}
              {preview.preview.manifest.includeSecrets ? "" : ` · ${t("desktop.backupNoSecrets")}`}
            </div>

            {/* Categories */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                {t("desktop.backupCategories")}
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {preview.preview.categories.map((cat) => (
                  <label key={cat} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(cat)}
                      onChange={(e) => {
                        const next = new Set(selectedCategories);
                        if (e.target.checked) next.add(cat);
                        else next.delete(cat);
                        setSelectedCategories(next);
                      }}
                    />
                    {t(`desktop.backupCategory${cat}`)}
                  </label>
                ))}
              </div>
            </div>

            {/* MCP servers */}
            {preview.preview.servers.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {t("desktop.backupMcpServers")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {preview.preview.servers.map((server) => (
                    <div key={server.name} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={!skippedServers.has(server.name)}
                        onChange={(e) => {
                          const next = new Set(skippedServers);
                          if (!e.target.checked) next.add(server.name);
                          else next.delete(server.name);
                          setSkippedServers(next);
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{server.name}</code>
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: server.action === "manual" || server.action === "keep-with-warning" ? "rgba(239,68,68,0.15)" : "var(--bg-selected)", color: server.action === "manual" || server.action === "keep-with-warning" ? "#ef4444" : "var(--text-muted)" }}>
                            {ACTION_LABELS[server.action]}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <code style={{ fontFamily: "var(--font-mono)" }}>{server.original.command}</code>
                          {server.adapted && server.adapted.command !== server.original.command && (
                            <> → <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{server.adapted.command}</code></>
                          )}
                        </div>
                        {server.reason && <div style={{ fontSize: 11, color: "#ef4444" }}>{server.reason}</div>}
                        {server.action === "manual" && server.installPrompt && cwd && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                            <select
                              value={installModel}
                              onChange={(e) => setInstallModel(e.target.value)}
                              style={{ fontSize: 11, padding: "4px 6px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", maxWidth: 220 }}
                              title={t("desktop.backupInstallModel")}
                            >
                              {availableModels.map((m) => (
                                <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                                  {m.provider}/{m.name || m.id}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={installingServer === server.name}
                              onClick={() => handleCreateInstallSession(server)}
                              style={{ padding: "4px 10px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: installingServer === server.name ? "wait" : "pointer" }}
                            >
                              {installingServer === server.name ? "…" : t("desktop.backupInstallSession")}
                            </button>
                            {installDone?.server === server.name && (
                              <a
                                href={`?session=${encodeURIComponent(installDone.sessionId)}`}
                                style={{ fontSize: 11, color: "var(--accent)" }}
                              >
                                {t("desktop.backupOpenSession")}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* npm packages (opt-in reinstall) */}
            {preview.preview.npmPackages.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {t("desktop.backupNpmPackages")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                  {preview.preview.npmPackages.map((spec) => (
                    <code key={spec} style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{spec}</code>
                  ))}
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer", fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>
                  <input
                    type="checkbox"
                    checked={reinstallNpm}
                    onChange={(e) => setReinstallNpm(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    {t("desktop.backupReinstallNpm")}
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
                      {t("desktop.backupReinstallNpmHint")}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Warnings */}
            {preview.preview.warnings.length > 0 && (
              <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>
                {preview.preview.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring || selectedCategories.size === 0}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", background: "var(--accent)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: restoring ? "wait" : "pointer", opacity: selectedCategories.size === 0 ? 0.5 : 1 }}
              >
                <Upload size={15} aria-hidden="true" />
                {restoring ? t("desktop.backupRestoring") : t("desktop.backupRestoreButton")}
              </button>
              <button
                type="button"
                onClick={() => { setPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                disabled={restoring}
                style={{ padding: "8px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
              >
                {t("desktop.cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Report */}
        {report && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              <Database size={16} aria-hidden="true" />
              {t("desktop.backupRestoreReport")}
            </div>

            {report.restored.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#4ade80", marginBottom: 4 }}>✓ {t("desktop.backupReportRestored")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                  {report.restored.join("\n")}
                </div>
              </div>
            )}
            {report.needsRestart.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>🔄 {t("desktop.backupReportRestart")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
                  {report.needsRestart.join("\n")}
                </div>
              </div>
            )}
            {report.manual.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", marginBottom: 4 }}>
                  <Warning size={12} style={{ verticalAlign: -2 }} aria-hidden="true" /> {t("desktop.backupReportManual")}
                </div>
                {report.manual.map((m, i) => (
                  <div key={i} style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--text)" }}>{m.server}</strong>: {m.message}
                  </div>
                ))}
              </div>
            )}
            {report.warnings.length > 0 && (
              <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.6 }}>
                {report.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            {report.needsRestart.length > 0 && (
              <p style={{ margin: 0, fontSize: 11, color: "#fbbf24", lineHeight: 1.5 }}>
                {t("desktop.backupRestartHint")}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
