"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Check, Copy, Link, X } from "@phosphor-icons/react";

interface PairDevice {
  label: string;
  createdAt: number;
  expiresAt: number | null;
  reusable: boolean;
  connections: number;
  state: "live" | "used" | "expired" | "revoked";
}

interface SavedLink {
  url: string;
  createdAt: number;
  label: string;
}

/**
 * Pairing panel: one permanent link plus a device list.
 *
 * The link is deliberately not single-use and does not expire — it is meant to
 * be saved and opened from several devices. Access is withdrawn by revoking it
 * (which drops every connected device), not by letting it age out.
 */
export function PairDevicePanel() {
  const { t } = useI18n();
  const [link, setLink] = useState<SavedLink | null>(null);
  const [devices, setDevices] = useState<PairDevice[]>([]);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [relayState, setRelayState] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pair", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as {
        devices?: PairDevice[];
        relayUrl?: string | null;
        relayState?: string;
        link?: SavedLink | null;
      };
      setDevices(data.devices ?? []);
      setRelayUrl(data.relayUrl ?? null);
      setRelayState(data.relayState ?? "");
      setLink(data.link ?? null);
    } catch {
      // Keep the previous list; an action will surface the real error.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Creates the permanent link on first use; reuses it afterwards. */
  const ensureLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setCopied(false);
        await refresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Replaces the link with a new one and revokes the previous. */
  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) setError(data.error ?? `HTTP ${res.status}`);
      else { setCopied(false); await refresh(); }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Drops the link and every device that entered through it. */
  const revokeLink = async () => {
    const raw = link?.url ? decodeURIComponent(/\/r\/([^?]+)/.exec(link.url)?.[1] ?? "") : "";
    if (!raw) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", token: raw }),
      });
      setLink(null);
      setCopied(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError(t("pair.copyFailed"));
    }
  };

  const totalDevices = devices.reduce((sum, device) => sum + (device.connections || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {t("pair.description")}
      </p>

      {relayUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <Link size={13} aria-hidden="true" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{relayUrl}</span>
          <span style={{ flexShrink: 0, color: relayState === "registered" ? "var(--status-success)" : "var(--status-warning)" }}>
            {relayState === "registered" ? t("pair.relayReady") : relayState || "—"}
          </span>
        </div>
      ) : (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-muted)" }}>
          {t("pair.noRelay")}
        </div>
      )}

      {link?.url ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* The link is the primary affordance, so it is shown in full and is
              selectable even if the clipboard API is unavailable. */}
          <input
            readOnly
            value={link.url}
            aria-label={t("pair.linkLabel")}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 8,
              background: "var(--bg)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void copy()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: "var(--accent)", color: "var(--accent-fg)", border: "none", cursor: "pointer",
              }}
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? t("pair.copied") : t("pair.copyLink")}
            </button>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={busy}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
                background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)",
              }}
            >
              {t("pair.regenerate")}
            </button>
            <button
              type="button"
              onClick={() => void revokeLink()}
              disabled={busy}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
                background: "var(--bg)", color: "var(--status-error)", border: "1px solid var(--border)",
              }}
            >
              {t("pair.revoke")}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("pair.permanentHint")}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void ensureLink()}
          disabled={busy}
          style={{
            alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--accent)", color: "var(--accent-fg)",
            border: "none", fontSize: 12, fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? t("pair.generating") : t("pair.generate")}
        </button>
      )}

      {error && (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.10)", color: "var(--status-error)", fontSize: 12, wordBreak: "break-word" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {t("pair.devices")} ({totalDevices} {t("pair.connectedNow")})
        </div>
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
                {device.label || (device.reusable ? t("pair.permanentLink") : t("pair.unnamedDevice"))}
              </span>
              <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 11 }}>
                {device.connections > 0 ? `${device.connections} ${t("pair.devicesOnline")}` : ""}
                {device.state === "revoked" ? ` ${t("pair.stateRevoked")}` : device.state === "expired" ? ` ${t("pair.stateExpired")}` : ""}
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
