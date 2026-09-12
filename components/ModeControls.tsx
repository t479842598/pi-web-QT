"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ChatMode, CollaborationMode, ToolApprovalMode } from "@/lib/modes";
import { chatModeAxes, chatModeFromAxes } from "@/lib/modes";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { TargetIcon } from "@phosphor-icons/react/Target";
import { Hand, NotepadText, ShieldAlert, ShieldCheck } from "lucide-react";

/**
 * Composer mode picker.
 *
 * The four primary modes mirror ZCode's picker one-for-one (same labels, same
 * lucide icons — see docs/web-mobile-style-reference.md): plan / build / edit /
 * yolo. Picking one writes BOTH persisted axes (collaboration + tool approval);
 * the displayed selection is derived back from those axes, so a settings-file
 * edit or another client keeps the picker honest.
 *
 * `goal` is pi-web's own continuous-goal mode with no ZCode counterpart, kept as
 * a fifth entry so it stays reachable.
 */

type IconCmp = typeof NotepadText;

interface MenuItem {
  value: ChatMode | "goal";
  Icon: IconCmp;
  titleKey: string;
  descKey: string;
  /** ZCode marks full-access with a warning color. */
  warning?: boolean;
}

const MODE_ITEMS: MenuItem[] = [
  { value: "plan", Icon: NotepadText, titleKey: "modes.collabPlanTitle", descKey: "modes.collabPlanDesc" },
  { value: "build", Icon: Hand, titleKey: "modes.chatBuildTitle", descKey: "modes.chatBuildDesc" },
  { value: "edit", Icon: ShieldCheck, titleKey: "modes.chatEditTitle", descKey: "modes.chatEditDesc" },
  { value: "yolo", Icon: ShieldAlert, titleKey: "modes.chatYoloTitle", descKey: "modes.chatYoloDesc", warning: true },
  { value: "goal", Icon: TargetIcon as unknown as IconCmp, titleKey: "modes.collabGoalTitle", descKey: "modes.collabGoalDesc" },
];

interface ModeControlsProps {
  collaborationMode: CollaborationMode;
  onCollaborationModeChange: (mode: CollaborationMode) => void;
  toolApprovalMode: ToolApprovalMode;
  onToolApprovalModeChange?: (mode: ToolApprovalMode) => void;
  /** True while the agent is running — mode switches are disabled. */
  disabled?: boolean;
}

export function ModeControls({
  collaborationMode,
  onCollaborationModeChange,
  toolApprovalMode,
  onToolApprovalModeChange,
  disabled = false,
}: ModeControlsProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [openMenu, setOpenMenu] = useState<"collab" | null>(null);
  const [closing, setClosing] = useState<"collab" | null>(null);
  const [rects, setRects] = useState<Record<string, { top: number; left: number; width: number }>>({});
  const collabRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);

  const trigger = (key: "collab", ref: React.RefObject<HTMLButtonElement | null>) => () => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRects((prev) => ({ ...prev, [key]: { top: r.top, left: r.left, width: r.width } }));
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const closeMenu = useCallback((key: "collab") => {
    setClosing(key);
    window.requestAnimationFrame(() => setOpenMenu((prev) => (prev === key ? null : prev)));
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setClosing(null), 150);
  }, []);

  // The picker projects the persisted axes; goal short-circuits because it has
  // no (collaboration, approval) pair of its own.
  const activeValue: ChatMode | "goal" = collaborationMode === "goal"
    ? "goal"
    : chatModeFromAxes(collaborationMode, toolApprovalMode);

  const pick = (value: ChatMode | "goal") => {
    closeMenu("collab");
    if (value === activeValue) return;
    if (value === "goal") {
      onCollaborationModeChange("goal");
      return;
    }
    const axes = chatModeAxes(value);
    if (axes.collaborationMode !== collaborationMode) onCollaborationModeChange(axes.collaborationMode);
    if (axes.toolApprovalMode !== toolApprovalMode) onToolApprovalModeChange?.(axes.toolApprovalMode);
  };

  const vh = () => window.visualViewport?.height ?? window.innerHeight;
  const vw = () => window.innerWidth;

  const renderMenu = () => {
    if (openMenu !== "collab") return null;
    const rect = rects.collab;
    if (!rect) return null;
    const panelW = Math.min(248, vw() - 16);
    const l = Math.min(rect.left, vw() - panelW - 8);
    const b = vh() - rect.top + 6;
    const maxH = Math.min(300, Math.max(120, vh() * 0.55));
    return (
      <div
        role="menu"
        style={{
          position: "fixed",
          bottom: b,
          left: l,
          zIndex: 2100,
          width: panelW,
          maxHeight: maxH,
          overflowY: "auto",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
          padding: 4,
          opacity: closing === "collab" ? 0 : 1,
          transition: "opacity 0.12s",
        }}
      >
        {MODE_ITEMS.map((item) => {
          const isActive = item.value === activeValue;
          const Icon = item.Icon;
          return (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => pick(item.value)}
              disabled={disabled}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "8px 10px",
                background: isActive ? "var(--bg-selected)" : "none",
                border: "none", borderRadius: 8,
                cursor: disabled ? "not-allowed" : "pointer",
                textAlign: "left",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (!isActive && !disabled) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? "var(--bg-selected)" : "none"; }}
            >
              <Icon size={16} color={isActive ? (item.warning ? "var(--accent-orange, #f59e0b)" : "var(--accent)") : "var(--text-muted)"} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 550, color: "var(--text)" }}>{t(item.titleKey)}</span>
                <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)", marginTop: 1, lineHeight: 1.4 }}>{t(item.descKey)}</span>
              </span>
              {isActive && <CheckIcon size={12} weight="bold" color="var(--accent)" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  };

  const activeItem = MODE_ITEMS.find((item) => item.value === activeValue) ?? MODE_ITEMS[1];
  const activeColor = activeValue === "build"
    ? "var(--text-muted)"
    : activeItem.warning
      ? "var(--accent-orange, #f59e0b)"
      : "var(--accent)";

  const triggerStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 0 : 5,
    padding: isMobile ? 0 : "0 6px",
    // The mode name shows on desktop; a phone keeps the icon only.
    width: isMobile ? 24 : undefined,
    height: 24,
    background: active ? "var(--bg-hover)" : "none",
    border: "none",
    // The toolbar normalizes its buttons to 4px with !important; matching it
    // here keeps the value in this file honest instead of silently overridden.
    borderRadius: 4,
    color: activeColor,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
    transition: "background 0.12s, color 0.12s",
  });

  const ActiveIcon = activeItem.Icon;
  const activeTitleKey = activeItem.titleKey;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          ref={collabRef}
          type="button"
          aria-label={t(activeTitleKey)}
          title={t(activeTitleKey)}
          aria-expanded={openMenu === "collab"}
          onClick={trigger("collab", collabRef)}
          disabled={disabled}
          style={triggerStyle(openMenu === "collab")}
        >
          <ActiveIcon size={14} color={activeColor} aria-hidden="true" />
          {!isMobile && (
            <span style={{ whiteSpace: "nowrap" }}>
              {t(activeTitleKey)}
            </span>
          )}
        </button>
      </div>
      {renderMenu()}
    </>
  );
}
