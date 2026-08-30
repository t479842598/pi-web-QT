"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CollaborationMode } from "@/lib/modes";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { ListDashesIcon } from "@phosphor-icons/react/ListDashes";
import { TargetIcon } from "@phosphor-icons/react/Target";

type IconCmp = typeof ArrowRightIcon;

interface MenuItem<M extends string> {
  value: M;
  Icon: IconCmp;
  titleKey: string;
  descKey: string;
}

interface ModeControlsProps {
  collaborationMode: CollaborationMode;
  onCollaborationModeChange: (mode: CollaborationMode) => void;
  /** True while the agent is running — mode switches are disabled. */
  disabled?: boolean;
}

/**
 * Composer mode controls — ONLY the collaboration mode (常规/计划/目标) lives
 * here now. The run tier (运行档位) and tool approval (工具权限) selectors
 * were removed from the composer: their values come from the system settings
 * defaults (FeaturesConfig → /api/modes) and new sessions inherit them; the
 * per-session override API stays available for anything that still needs it.
 */

const COLLAB_ITEMS: MenuItem<CollaborationMode>[] = [
  { value: "normal", Icon: ArrowRightIcon, titleKey: "modes.collabNormalTitle", descKey: "modes.collabNormalDesc" },
  { value: "plan", Icon: ListDashesIcon, titleKey: "modes.collabPlanTitle", descKey: "modes.collabPlanDesc" },
  { value: "goal", Icon: TargetIcon, titleKey: "modes.collabGoalTitle", descKey: "modes.collabGoalDesc" },
];

const COLLAB_ICONS: Record<CollaborationMode, IconCmp> = {
  normal: ArrowRightIcon,
  plan: ListDashesIcon,
  goal: TargetIcon,
};

export function ModeControls({
  collaborationMode,
  onCollaborationModeChange,
  disabled = false,
}: ModeControlsProps) {
  const { t } = useI18n();
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

  const pick = (value: string) => {
    closeMenu("collab");
    if (value !== collaborationMode) onCollaborationModeChange(value as CollaborationMode);
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
        {COLLAB_ITEMS.map((item) => {
          const isActive = item.value === collaborationMode;
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
              <Icon size={16} weight={isActive ? "fill" : "regular"} color={isActive ? "var(--accent)" : "var(--text-muted)"} aria-hidden="true" />
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

  const triggerStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 3,
    padding: "3px 6px",
    height: 24,
    background: active ? "var(--bg-hover)" : "none",
    border: "none",
    borderRadius: 6,
    color: collaborationMode !== "normal" ? "var(--accent)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
    transition: "background 0.12s, color 0.12s",
  });

  const CollabIcon = COLLAB_ICONS[collaborationMode];
  const collabLabel = collaborationMode === "plan" ? t("modes.collabPlan") : collaborationMode === "goal" ? t("modes.collabGoal") : t("modes.collabNormal");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          ref={collabRef}
          type="button"
          aria-label={t("modes.collabNormalTitle")}
          title={t("modes.collabNormalTitle")}
          aria-expanded={openMenu === "collab"}
          onClick={trigger("collab", collabRef)}
          disabled={disabled}
          style={triggerStyle(openMenu === "collab")}
        >
          <CollabIcon size={13} weight={collaborationMode !== "normal" ? "fill" : "regular"} color={collaborationMode !== "normal" ? "var(--accent)" : "var(--text-muted)"} aria-hidden="true" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{collabLabel}</span>
          <CaretDownIcon size={10} weight="bold" aria-hidden="true" style={{ transform: openMenu === "collab" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s", flexShrink: 0 }} />
        </button>
      </div>
      {renderMenu()}
    </>
  );
}
