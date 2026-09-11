"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Check, Copy, Link, X } from "@phosphor-icons/react";

interface PairDevice {
  label: string;
  createdAt: number;
  expiresAt: number | null;
  state: "live" | "used" | "revoked";
}

interface CreatedPair {
  url: string;
  qrSvg: string;
  expiresInMs: number;
  relayReady: boolean;
}

/** Only ever render a QR for an http(s) link; anything else is a bug upstream. */
function isSafePairUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pair-device panel: generate a one-time QR, list pairings, revoke.
 *
 * Rendered both embedded in Settings and as a standalone dialog, so the body is
 * split from the chrome — the caller decides which wrapper it wants.
 */
export function PairDevicePanel() {
  const { t } = useI18n();
  const [created, setCreated] = useState<CreatedPair | null>(null);
  const [devices, setDevices] = useState<PairDevice[]>([]);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pair", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { devices?: PairDevice[]; relayUrl?: string | null };
      setDevices(data.devices ?? []);
      setRelayUrl(data.relayUrl ?? null);
    } catch {
      // Keep the previous list; a create attempt will surface the real error.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json() as CreatedPair & { error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setCreated(data);
        setCopied(false);
        await refresh();
      }    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setError(t("pair.copyFailed"));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {t("pair.description")}
      </p>

      {relayUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <Link size={13} aria-hidden="true" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{relayUrl}</span>
        </div>
      ) : (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-muted)" }}>
          {t("pair.noRelay")}
        </div>
      )}

      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        style={{
          alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
          padding: "7px 14px", borderRadius: 8,
          background: "var(--accent)", color: "var(--accent-fg)",
          border: "none", fontSize: 12, fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? t("pair.generating") : created ? t("pair.regenerate") : t("pair.generate")}
      </button>

      {error && (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.10)", color: "var(--status-error)", fontSize: 12, wordBreak: "break-word" }}>
          {error}
        </div>
      )}

      {created && isSafePairUrl(created.url) && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          {/* Server-rendered SVG: the raw token never has to be re-encoded client-side. */}
          <div
            aria-label={t("pair.qrAlt")}
            role="img"
            style={{ width: 200, height: 200, background: "#fff", borderRadius: 10, padding: 8 }}
            dangerouslySetInnerHTML={{ __html: created.qrSvg }}
          />
          <button
            type="button"
            onClick={() => void copy()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
              background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)",
            }}
          >
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? t("pair.copied") : t("pair.copyLink")}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("pair.expiresIn")} {Math.max(1, Math.round(created.expiresInMs / 60000))} {t("pair.minutes")}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{t("pair.devices")} ({devices.length})</div>
        {devices.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("pair.noDevices")}</div>
        ) : (
          devices.map((device, index) => (
            <div
              key={`${device.createdAt}-${index}`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                padding: "7px 10px", borderRadius: 8,
                background: "var(--bg)", border: "1px solid var(--border)", fontSize: 12,
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {device.label || t("pair.unnamedDevice")}
              </span>
              <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 11 }}>
                {device.state === "live" ? t("pair.stateLive") : device.state === "used" ? t("pair.stateUsed") : t("pair.stateRevoked")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface PairDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Standalone dialog wrapper around the panel. */
export function PairDeviceDialog({ open, onOpenChange }: PairDeviceDialogProps) {
  const { t } = useI18n();
  useEscapeKey(open, () => onOpenChange(false));
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 950,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div style={{
        width: "min(460px, calc(100vw - 32px))",
        maxHeight: "min(80vh, 620px)",
        overflow: "auto",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("pair.title")}</h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("i18n.close")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <PairDevicePanel />
      </div>
    </div>
  );
}
