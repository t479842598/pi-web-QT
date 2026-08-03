"use client";

import { useState, useEffect, useCallback } from "react";
import { Moon, PaintBrush, Sun, ArrowSquareOut } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";

interface ThemeSetInfo {
  name: string;
  variants: Array<{ variant: "dark" | "light" | "base"; file: string }>;
}

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

// ── Variant availability dots ───────────────────────────────────────────────

function VariantDots({ hasDark, hasLight, t }: { hasDark: boolean; hasLight: boolean; t: (key: string) => string }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {hasDark && (
        <span title={t("desktop.darkVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#7c6f64" }} />
      )}
      {hasLight && (
        <span title={t("desktop.lightVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#f2e5bc", border: "1px solid var(--border)" }} />
      )}
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { theme: themeName, isDark, setTheme, toggleTheme } = useTheme();
  const { locale: language, setLocale: setLanguage, t } = useI18n();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/theme-sets")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { themeSets: ThemeSetInfo[] } | null) => {
        if (cancelled || !data) return;
        setThemeSets(data.themeSets);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleThemeChange = useCallback((name: string) => {
    setTheme(name as typeof themeName);
  }, [setTheme]);

  const openThemeDocs = useCallback(() => {
    window.open("https://pi.dev/docs/latest/themes", "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.display")}</h1>
      </header>

      {/* ── Theme ── */}
      <ConfigSection title={t("desktop.theme")} description={t("desktop.themeDescription")}>
        <SectionLabel
          icon={<PaintBrush size={14} weight="fill" />}
          label={t("desktop.colorScheme")}
          actions={
            <button
              type="button"
              onClick={openThemeDocs}
              style={textActionButtonStyle}
              {...underlineOnHover}
            >
              <ArrowSquareOut size={12} weight="regular" aria-hidden="true" />
              {t("desktop.learnPiThemes")}
            </button>
          }
        />
        {loading ? (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.loadingThemes")}</span>
        ) : (
          <div style={tagGroupStyle}>
            <button
              type="button" onClick={() => handleThemeChange("gruvbox")}
              style={tagStyle(themeName === "gruvbox", hoveredTag === "__default__")}
              onMouseEnter={() => setHoveredTag("__default__")}
              onMouseLeave={() => setHoveredTag(null)}
            >
              {t("desktop.defaultTheme")}
            </button>

            {themeSets.map((ts) => (
              <button
                key={ts.name} type="button"
                onClick={() => handleThemeChange(ts.name)}
                style={tagStyle(themeName === ts.name, hoveredTag === ts.name)}
                onMouseEnter={() => setHoveredTag(ts.name)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {ts.name}
                <VariantDots
                  hasDark={ts.variants.some((v) => v.variant === "dark")}
                  hasLight={ts.variants.some((v) => v.variant === "light")}
                  t={t}
                />
              </button>
            ))}
          </div>
        )}

        {/* Appearance Mode — light / dark toggle */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={isDark ? <Moon size={14} weight="fill" /> : <Sun size={14} weight="fill" />}
            label={t("desktop.appearanceMode")}
          />
          <div style={tagGroupStyle}>
            <button
              type="button" onClick={() => { if (isDark) toggleTheme(); }}
              style={tagStyle(!isDark, hoveredTag === "mode:light")}
              onMouseEnter={() => setHoveredTag("mode:light")}
              onMouseLeave={() => setHoveredTag(null)}
            >
              <Sun size={15} aria-hidden="true" />
              {t("desktop.lightVariant")}
            </button>
            <button
              type="button" onClick={() => { if (!isDark) toggleTheme(); }}
              style={tagStyle(isDark, hoveredTag === "mode:dark")}
              onMouseEnter={() => setHoveredTag("mode:dark")}
              onMouseLeave={() => setHoveredTag(null)}
            >
              <Moon size={15} aria-hidden="true" />
              {t("desktop.darkVariant")}
            </button>
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
    </div>
  );
}
