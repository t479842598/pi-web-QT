"use client";

/**
 * pi kit — Toggle.
 *
 * `components/SettingToggle.tsx` renders a whole row (title + description +
 * switch); the slot contract carries no title, so the row belongs to the call
 * site and only the switch itself is a primitive. This is the minimal wrapper
 * the brief allows: the same element, roles and classes as SettingToggle's
 * inner button, byte-identical markup, with SettingToggle itself untouched.
 */

import type { ToggleSlotProps } from "../types";

export function PiToggle({ checked, onChange, disabled, ariaLabel, id, className }: ToggleSlotProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={["settings-toggle", className].filter(Boolean).join(" ")}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}
