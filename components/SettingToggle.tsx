"use client";

import type { ReactNode } from "react";

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
  return (
    <div
      className="settings-row is-hoverable"
      onClick={() => onChange(!checked)}
      style={{ alignItems: description ? "flex-start" : "center", cursor: "pointer", userSelect: "none" }}
    >
      <span className="settings-row-copy">
        <span className="settings-row-title">{label}</span>
        {description && <span className="settings-row-description">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className="settings-toggle"
      >
        <span className="settings-toggle-knob" />
      </button>
    </div>
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
    <section className="settings-content-card settings-content-section" style={{ padding: "var(--settings-content-section-padding, 20px 22px)" }}>
      <h2 className="settings-content-section-title" style={{ margin: 0, fontSize: 'var(--text-ui-base)', fontWeight: 650, color: "var(--ds-text-primary)" }}>{title}</h2>
      <p className="settings-content-section-description" style={{ margin: "5px 0 14px", fontSize: 'var(--text-ui-sm)', lineHeight: 1.5, color: "var(--ds-text-secondary)" }}>{description}</p>
      <div className="settings-content-section-body">{children}</div>
    </section>
  );
}
