"use client";

import type { ReactNode } from "react";

const TOGGLE_WIDTH = 40;
const TOGGLE_HEIGHT = 22;
const THUMB_SIZE = 16;
const THUMB_OFFSET = 3;

const toggleTrackStyle: React.CSSProperties = {
  position: "relative",
  width: TOGGLE_WIDTH,
  height: TOGGLE_HEIGHT,
  borderRadius: TOGGLE_HEIGHT / 2,
  border: "none",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
  transition: "background 0.18s ease",
  outline: "none",
};

const thumbStyle: React.CSSProperties = {
  position: "absolute",
  top: THUMB_OFFSET,
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  borderRadius: "50%",
  background: "var(--accent-fg)",
  transition: "left 0.18s ease, transform 0.18s ease",
  boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
};

export function SettingToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  const trackBg = checked ? "var(--accent)" : "color-mix(in srgb, var(--border) 70%, var(--bg))";
  const thumbLeft = checked ? TOGGLE_WIDTH - THUMB_SIZE - THUMB_OFFSET : THUMB_OFFSET;

  return (
    <label
      className="settings-content-row"
      style={{
        display: "flex",
        alignItems: description ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "var(--settings-content-row-padding, 12px 14px)",
        borderRadius: "var(--settings-content-row-radius, 7px)",
        cursor: "pointer",
        userSelect: "none",
        transition: "background 0.12s",
        margin: "var(--settings-content-row-margin, 0 -14px)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="settings-content-row-label" style={{ display: "block", fontSize: 13, fontWeight: 550, color: "var(--text)", lineHeight: 1.4 }}>
          {label}
        </span>
        {description && (
          <span className="settings-content-row-description" style={{ display: "block", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 2 }}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        style={{
          ...toggleTrackStyle,
          background: trackBg,
        }}
      >
        <span
          style={{
            ...thumbStyle,
            left: thumbLeft,
          }}
        />
      </button>
    </label>
  );
}

export function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-content-card settings-content-section" style={{ padding: "var(--settings-content-section-padding, 20px 22px)", borderBottom: "var(--settings-content-section-divider, 1px solid var(--border))" }}>
      <h2 className="settings-content-section-title" style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p className="settings-content-section-description" style={{ margin: "5px 0 14px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      <div className="settings-content-section-body">{children}</div>
    </section>
  );
}
