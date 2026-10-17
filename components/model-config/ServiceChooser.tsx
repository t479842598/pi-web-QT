"use client";

/**
 * The first step of adding a provider: pick a service.
 *
 * WHY this replaces the old grid: the previous picker listed pi's built-in
 * providers plus one "custom" card, so every vendor pi does not broker (Kimi,
 * DeepSeek's first-party endpoint, a self-hosted gateway) started from an empty
 * form. Discovery only works against a known endpoint, so the endpoint has to
 * be chosen before the key is typed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useI18n } from "@/hooks/useI18n";
import type { NamedEndpointPreset } from "@/lib/provider-presets";
import {
  NAMED_ENDPOINT_PRESETS,
  filterServiceOptions,
  presetHaystack,
} from "@/lib/provider-presets";

export interface ServiceChooserOAuthEntry {
  id: string;
  name: string;
  loggedIn: boolean;
}

export interface ServiceChooserApiKeyEntry {
  id: string;
  displayName: string;
  configured: boolean;
  modelCount: number;
}

export interface ServiceChooserProps {
  open: boolean;
  onClose: () => void;
  oauthProviders: ServiceChooserOAuthEntry[];
  apiKeyProviders: ServiceChooserApiKeyEntry[];
  onPickOAuth: (id: string) => void;
  onPickApiKey: (id: string) => void;
  onPickPreset: (preset: NamedEndpointPreset) => void;
  onPickCustom: () => void;
}

/** The host plus path of a preset endpoint, which is what tells two vendors apart. */
function endpointSummary(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return baseUrl;
  }
}

const groupTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-ui-xs)",
  fontWeight: 600,
  color: "var(--ds-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  padding: "4px 2px 2px",
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  padding: "9px 11px",
  border: "1px solid var(--ds-border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--ds-bg-secondary)",
  color: "var(--ds-text-primary)",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

/**
 * A service chooser for "add provider".
 *
 * Every card is a `<button>` styled through CSS variables, never a hover
 * handler that writes colors inline: `app/settings.css` owns the surfaces, and
 * a JS hover that overwrites `background` leaves the row stuck on the hover
 * color after the pointer leaves through a child node.
 */
export function ServiceChooser({
  open,
  onClose,
  oauthProviders,
  apiKeyProviders,
  onPickOAuth,
  onPickApiKey,
  onPickPreset,
  onPickCustom,
}: ServiceChooserProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(open, onClose);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  const subscriptions = oauthProviders.filter((provider) => !provider.loggedIn);
  const apiKeys = apiKeyProviders.filter((provider) => !provider.configured);

  // Presets carry their own search haystack (name, id, vendor, aliases, host and
  // path); the other two groups are searched with the same helper so one query
  // filters all three groups identically.
  const presetOptions = useMemo(
    () => NAMED_ENDPOINT_PRESETS.map((preset) => ({ preset, haystack: presetHaystack(preset) })),
    [],
  );
  const subscriptionOptions = useMemo(
    () => subscriptions.map((provider) => ({
      provider,
      haystack: `${provider.name} ${provider.id}`.toLocaleLowerCase(),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oauthProviders],
  );
  const apiKeyOptions = useMemo(
    () => apiKeys.map((provider) => ({
      provider,
      haystack: `${provider.displayName} ${provider.id}`.toLocaleLowerCase(),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKeyProviders],
  );

  const visibleSubscriptions = filterServiceOptions(subscriptionOptions, query);
  const visibleApiKeys = filterServiceOptions(apiKeyOptions, query);
  const visiblePresets = filterServiceOptions(presetOptions, query);
  const customHaystack = `${t("desktop.modelsServiceGroupCustom")} ${t("desktop.modelsServiceCustomEndpoint")} custom openai-compatible anthropic-compatible`.toLocaleLowerCase();
  const customNeedle = query.trim().toLocaleLowerCase();
  const showCustom = !customNeedle || customHaystack.includes(customNeedle);

  const card = (key: string, label: string, detail: string, onClick: () => void, icon?: React.ReactNode) => (
    <button key={key} type="button" style={cardStyle} onClick={onClick} className="settings-row is-hoverable">
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: "var(--text-ui-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: "var(--text-ui-xs)", color: "var(--ds-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      </span>
      {icon}
    </button>
  );

  if (!open) return null;

  const hasAny = visibleSubscriptions.length + visibleApiKeys.length + visiblePresets.length + (showCustom ? 1 : 0) > 0;

  return (
    <div
      data-settings-child-dialog="true"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: 760, maxWidth: "calc(100vw - 32px)", maxHeight: "min(78vh, calc(100vh - 32px))", display: "flex", flexDirection: "column", background: "var(--ds-bg-primary)", border: "1px solid var(--ds-border-default)", borderRadius: "var(--radius-md-plus)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <MagnifyingGlassIcon size={13} style={{ color: "var(--ds-text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("desktop.modelsServiceChooserSearch")}
            aria-label={t("desktop.modelsServiceChooserTitle")}
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--ds-text-primary)", fontSize: "var(--text-ui-base)", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {!hasAny && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ds-text-muted)", fontSize: "var(--text-ui-sm)" }}>
              {t("desktop.modelsServiceNoMatch")}
            </div>
          )}

          {visibleSubscriptions.length > 0 && (
            <>
              <div style={groupTitleStyle}>{t("desktop.modelsServiceGroupSubscriptions")}</div>
              {visibleSubscriptions.map(({ provider }) => card(
                `oauth:${provider.id}`,
                provider.name,
                "OAuth",
                () => onPickOAuth(provider.id),
              ))}
            </>
          )}

          {visibleApiKeys.length > 0 && (
            <>
              <div style={groupTitleStyle}>{t("desktop.modelsServiceGroupApiKey")}</div>
              {visibleApiKeys.map(({ provider }) => card(
                `apikey:${provider.id}`,
                provider.displayName,
                t("desktop.modelsCount", { count: provider.modelCount }),
                () => onPickApiKey(provider.id),
              ))}
            </>
          )}

          {visiblePresets.length > 0 && (
            <>
              <div style={groupTitleStyle}>{t("desktop.modelsServiceGroupPresets")}</div>
              {visiblePresets.map(({ preset }) => card(
                `preset:${preset.id}`,
                preset.name,
                endpointSummary(preset.baseUrl),
                () => onPickPreset(preset),
              ))}
            </>
          )}

          {showCustom && (
            <>
              <div style={groupTitleStyle}>{t("desktop.modelsServiceGroupCustom")}</div>
              {card(
                "custom",
                t("desktop.modelsServiceCustomEndpoint"),
                t("desktop.modelsCustomEndpointFormat"),
                onPickCustom,
                <PlusIcon size={13} style={{ color: "var(--ds-text-muted)", flexShrink: 0 }} />,
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
