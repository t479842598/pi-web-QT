"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";

/**
 * "Apply now" button for settings whose changes only take effect after pi
 * reloads its configuration (MCP servers, skills, plugins, models, subagents…).
 *
 * It triggers AgentSession.reload(), which reloads settings.json, API
 * providers and the resource loader, then fires session_start so extensions
 * (pi-mcp-extension re-reads mcp.json and restarts servers, etc.) pick up the
 * new configuration — no pi restart required.
 */
export function ApplyNowButton({
  sessionId,
  onApplied,
}: {
  sessionId?: string | null;
  /** Called after a successful reload so the page can refresh its data. */
  onApplied?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setDone(true);
      await onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [sessionId, onApplied]);

  const disabled = busy || !sessionId;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => void apply()}
        disabled={disabled}
        title={sessionId ? t("desktop.applyNowTitle") : t("desktop.applyNowNoSession")}
        style={{
          padding: "7px 12px",
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? t("desktop.applyNowApplying") : t("desktop.applyNow")}
      </button>
      {done && <span style={{ color: "#22c55e", fontSize: 12 }}>{t("desktop.applyNowDone")}</span>}
      {error && <span style={{ color: "#ef4444", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
