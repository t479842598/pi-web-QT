"use client";

import { useState, useEffect, useCallback } from "react";
import { Moon, PaintBrush, Sun, Monitor, ArrowSquareOut, Link, CheckCircle } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import type { ThemeSetInfo, ThemePreviewColors } from "@/lib/theme";

// ── Tag / chip helpers ───────────────────────────────────────────────────────

const tagGroupStyle: React.CSSProperties = {
  display: "flex", gap: 6, flexWrap: "wrap",
};

function tagStyle(active: boolean, hovered: boolean, disabled?: boolean): React.CSSProperties {
  const borderColor = active
    ? "var(--accent)"
    : hovered
      ? "var(--border-hover)"
      : "var(--border)";
  const bg = active
    ? "color-mix(in srgb, var(--accent) 12%, var(--bg))"
    : hovered
      ? "var(--bg-hover)"
      : "var(--bg-card)";
  const color = active ? "var(--accent)" : hovered ? "var(--text)" : "var(--text-muted)";

  return {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "7px 14px",
    border: `1px solid ${borderColor}`,
    borderRadius: 8,
    background: bg,
    color,
    fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color 0.15s, background 0.15s, color 0.15s",
    outline: "none", whiteSpace: "nowrap",
  };
}

function SectionLabel({ icon, label, actions }: { icon: React.ReactNode; label: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, width: "100%" }}>
      <span style={{ color: "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {actions && <span style={{ display: "inline-flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>{actions}</span>}
    </div>
  );
}

const textActionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "var(--accent)",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Underline the label while hovering a text action button. */
const underlineOnHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.textDecoration = "underline";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.textDecoration = "none";
  },
};

function ConfigSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 16px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      {children}
    </section>
  );
}

// ── Border depth icon ───────────────────────────────────────────────────────

function BorderIcon({ depth }: { depth: number }) {
  const n = depth / 100;
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <rect
        x={1.5} y={1.5} width={11} height={11} rx={2.5}
        style={{
          fill: "none",
          stroke: "var(--text-dim)",
          strokeWidth: 1 + n * 2,
          opacity: 0.2 + n * 0.8,
        }}
      />
      <rect
        x={4} y={4} width={6} height={6} rx={1}
        style={{
          fill: "var(--text-dim)",
          opacity: 0.05 + n * 0.35,
        }}
      />
    </svg>
  );
}

// ── Variant availability dots ───────────────────────────────────────────────

function VariantDots({ hasDark, hasLight, darkColor, lightColor, t }: {
  hasDark: boolean; hasLight: boolean; darkColor?: string; lightColor?: string; t: (key: string) => string;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {hasDark && (
        <span title={t("desktop.darkVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: darkColor ?? "#7c6f64" }} />
      )}
      {hasLight && (
        <span title={t("desktop.lightVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: lightColor ?? "#d5c4a1", border: "1px solid rgba(0,0,0,0.1)" }} />
      )}
    </span>
  );
}

// ── Theme card ──────────────────────────────────────────────────────────────

/** Miniature of the app rendered in a theme's own colors.
 *
 * Uses the preview palette the server ships with each theme set instead of
 * fetching the theme's full token set, so cards render instantly and a
 * never-before-seen theme still previews correctly (the old hover preview only
 * worked for themes that had already been loaded once). */
function ThemeCardPreview({ colors }: { colors: ThemePreviewColors }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        height: 62,
        borderRadius: 6,
        overflow: "hidden",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Sidebar */}
      <div style={{ width: 26, flexShrink: 0, background: colors.panel, borderRight: `1px solid ${colors.border}`, padding: "5px 4px", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ height: 3, borderRadius: 2, background: colors.accent, width: "70%" }} />
        <span style={{ height: 3, borderRadius: 2, background: colors.muted, opacity: 0.5, width: "100%" }} />
        <span style={{ height: 3, borderRadius: 2, background: colors.muted, opacity: 0.5, width: "82%" }} />
        <span style={{ height: 3, borderRadius: 2, background: colors.muted, opacity: 0.5, width: "60%" }} />
      </div>
      {/* Conversation */}
      <div style={{ flex: 1, minWidth: 0, padding: "5px 6px", display: "flex", flexDirection: "column", gap: 4 }}>
        {/* user bubble */}
        <div style={{ alignSelf: "flex-end", maxWidth: "78%", borderRadius: 5, background: colors.userBg, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ height: 2.5, borderRadius: 2, background: colors.text, opacity: 0.75, width: 34 }} />
          <span style={{ height: 2.5, borderRadius: 2, background: colors.text, opacity: 0.5, width: 22 }} />
        </div>
        {/* assistant text */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ height: 2.5, borderRadius: 2, background: colors.text, opacity: 0.7, width: "86%" }} />
          <span style={{ height: 2.5, borderRadius: 2, background: colors.muted, opacity: 0.65, width: "64%" }} />
        </div>
        {/* tool block */}
        <div style={{ borderRadius: 4, background: colors.toolBg, borderLeft: `2px solid ${colors.accent}`, padding: "3px 5px", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors.accent, flexShrink: 0 }} />
          <span style={{ height: 2.5, borderRadius: 2, background: colors.muted, opacity: 0.7, width: "52%" }} />
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  active,
  hovered,
  disabled,
  displayName,
  colors,
  hasDark,
  hasLight,
  onClick,
  onHoverStart,
  onHoverEnd,
}: {
  active: boolean;
  hovered: boolean;
  disabled: boolean;
  displayName: string;
  colors?: ThemePreviewColors;
  hasDark: boolean;
  hasLight: boolean;
  onClick: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const borderColor = active
    ? "var(--accent)"
    : hovered ? "var(--border-hover)" : "var(--border)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      aria-pressed={active}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: 8,
        border: `1px solid ${borderColor}`,
        borderRadius: 9,
        background: hovered && !active ? "var(--bg-hover)" : "var(--bg-card)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
        minWidth: 0,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      {colors
        ? <ThemeCardPreview colors={colors} />
        : <div aria-hidden="true" style={{ height: 62, borderRadius: 6, background: "var(--bg-panel)", border: "1px solid var(--border)" }} />}
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: active ? 600 : 400, color: active ? "var(--accent)" : "var(--text)" }}>
          {displayName}
        </span>
        <VariantDots hasDark={hasDark} hasLight={hasLight} darkColor={colors?.accent} lightColor={colors?.accent} t={() => ""} />
        {active && <CheckCircle size={13} weight="fill" color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />}
      </span>
    </button>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { mode, resolvedMode, themeName, setMode, setTheme, borderDepth, setBorderDepth } = useTheme();
  const { locale: language, setLocale: setLanguage, t } = useI18n();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [defaultPreview, setDefaultPreview] = useState<ThemePreviewColors | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  const logOut = useCallback(async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    // The server picks the variant whose palette each card should show, so it
    // needs to know which mode the user is currently looking at.
    fetch(`/api/themes?mode=${resolvedMode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { themeSets: ThemeSetInfo[]; defaultPreview?: ThemePreviewColors } | null) => {
        if (cancelled || !data) return;
        setThemeSets(data.themeSets);
        setDefaultPreview(data.defaultPreview);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resolvedMode]);

  const handleThemeChange = useCallback((name: string) => {
    setApplying(name);
    setTheme(name).finally(() => setApplying(null));
  }, [setTheme]);

  /** Hover preview: 防抖 160ms + 仅预览已缓存主题（未缓存需点击加载），
   *  避免鼠标扫过列表时触发大量 fetch 与全量 CSS 变量重算导致卡顿。 */
  /**
   * Hover only highlights the card now. The old live whole-page preview was
   * removed with the chip row: it only worked for themes already in the fetch
   * cache (a first hover on any other theme silently did nothing), and each
   * successful preview recomputed every CSS variable on the page. The card's
   * own mini preview conveys the palette without either problem.
   */
  const handleThemeHover = useCallback((name: string | null) => {
    setHoveredTag(name);
  }, []);

  const handleModeChange = useCallback((m: ThemeMode) => {
    setMode(m);
  }, [setMode]);

  const openThemeFolder = useCallback(() => {
    window.piDesktop?.openThemeFolder();
  }, []);

  const openThemeDocs = useCallback(() => {
    if (window.piDesktop) {
      window.piDesktop.openThemeDocs();
      return;
    }
    window.open("https://pi.dev/docs/latest/themes", "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.display")}</h1>
      </header>

      {/* ── Theme ── */}
      <ConfigSection title={t("desktop.theme")} description={t("desktop.themeDescription")}>
        {/* Color Scheme */}
        <SectionLabel
          icon={<PaintBrush size={14} weight="fill" />}
          label={t("desktop.colorScheme")}
          actions={
            <>
              <button
                type="button"
                onClick={openThemeFolder}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <Link size={12} weight="regular" aria-hidden="true" />
                {t("desktop.openThemeFolder")}
              </button>
              <button
                type="button"
                onClick={openThemeDocs}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <ArrowSquareOut size={12} weight="regular" aria-hidden="true" />
                {t("desktop.learnPiThemes")}
              </button>
            </>
          }
        />
        {loading ? (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.loadingThemes")}</span>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            <ThemeCard
              active={themeName === ""}
              hovered={hoveredTag === "__default__"}
              disabled={applying !== null}
              displayName={t("desktop.defaultTheme")}
              colors={defaultPreview}
              hasDark
              hasLight
              onClick={() => handleThemeChange("")}
              onHoverStart={() => handleThemeHover("")}
              onHoverEnd={() => handleThemeHover(null)}
            />

            {themeSets.map((ts) => (
              <ThemeCard
                key={ts.name}
                active={themeName === ts.name}
                hovered={hoveredTag === ts.name}
                disabled={applying !== null}
                displayName={ts.displayName}
                colors={ts.preview}
                hasDark={ts.hasDark}
                hasLight={ts.hasLight}
                onClick={() => handleThemeChange(ts.name)}
                onHoverStart={() => handleThemeHover(ts.name)}
                onHoverEnd={() => handleThemeHover(null)}
              />
            ))}
          </div>
        )}

        {/* Border depth */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={<BorderIcon depth={borderDepth} />}
            label={`${t("desktop.borderVisibility")} (${borderDepth})`}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.borderSubtle")}</span>
            <input
              type="range"
              min={0} max={100} step={1}
              value={borderDepth}
              onChange={(e) => setBorderDepth(Number(e.target.value))}
              style={{
                flex: 1,
                accentColor: "var(--accent)",
                height: 6,
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.borderBold")}</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            {[0, 25, 50, 75, 100].map((d) => {
              const active = borderDepth === d;
              const previewBorder = d <= 50
                ? `color-mix(in srgb, var(--border-orig) ${d * 2}%, var(--bg) ${100 - d * 2}%)`
                : `color-mix(in srgb, var(--border-orig) ${100 - (d - 50) * 2}%, var(--text) ${(d - 50) * 2}%)`;
              return (
                <div
                  key={d}
                  onClick={() => setBorderDepth(d)}
                  style={{
                    width: 28, height: 20,
                    border: `2px solid ${active ? "var(--accent)" : previewBorder}`,
                    borderRadius: 5,
                    background: "var(--bg-card)",
                    cursor: "pointer",
                    transition: "border-color 0.1s",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Appearance Mode */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={resolvedMode === "dark" ? <Moon size={14} weight="fill" /> : <Sun size={14} weight="fill" />}
            label={t("desktop.appearanceMode")}
          />
          <div style={tagGroupStyle}>
            {([
              { value: "light" as ThemeMode, icon: <Sun size={15} weight={mode === "light" ? "fill" : "regular"} /> },
              { value: "dark" as ThemeMode, icon: <Moon size={15} weight={mode === "dark" ? "fill" : "regular"} /> },
              { value: "system" as ThemeMode, icon: <Monitor size={15} weight={mode === "system" ? "fill" : "regular"} /> },
            ]).map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value} type="button" onClick={() => handleModeChange(opt.value)}
                  style={tagStyle(active, hoveredTag === `mode:${opt.value}`)}
                  onMouseEnter={() => setHoveredTag(`mode:${opt.value}`)}
                  onMouseLeave={() => setHoveredTag(null)}
                >
                  {opt.icon}
                  {t(`desktop.${opt.value}`)}
                </button>
              );
            })}
          </div>

        </div>

        {!loading && themeSets.length === 0 && (
          <p style={{ margin: "14px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("desktop.noCustomThemes")}{" "}
            {t("desktop.noCustomThemesHint")}{" "}
            <code style={{ fontSize: 10, background: "var(--bg-secondary)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>~/.pi/agent/themes/*.json</code>{" "}
            {t("desktop.noCustomThemesHint2")}
          </p>
        )}
      </ConfigSection>

      {/* ── Language ── */}
      <ConfigSection title={t("desktop.language")} description={t("desktop.languageDescription")}>
        <div style={tagGroupStyle}>
          {(["en", "zh-CN"] as const).map((lang) => {
            const active = (lang === "zh-CN") ? language === "zh-CN" : language !== "zh-CN";
            return (
              <button
                key={lang} type="button"
                onClick={() => setLanguage(lang === "zh-CN" ? "zh-CN" : "en")}
                style={tagStyle(active, hoveredTag === `lang:${lang}`)}
                onMouseEnter={() => setHoveredTag(`lang:${lang}`)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {lang === "en" ? t("desktop.english") : t("desktop.chinese")}
              </button>
            );
          })}
        </div>
      </ConfigSection>

      {/* ── Browser session ── */}
      {webAuthEnabled && (
        <ConfigSection title={t("auth.prompt")} description={t("desktop.accessDescription")}>
          <div style={tagGroupStyle}>
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => void logOut()}
              style={tagStyle(false, hoveredTag === "logout")}
              onMouseEnter={() => setHoveredTag("logout")}
              onMouseLeave={() => setHoveredTag(null)}
            >
              {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
            </button>
          </div>
          {logoutError && <p role="alert" style={{ margin: "8px 0 0", color: "var(--status-error)", fontSize: 12 }}>{logoutError}</p>}
        </ConfigSection>
      )}
    </div>
  );
}
