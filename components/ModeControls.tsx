"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { CollaborationMode, TokenMode, ToolApprovalMode } from "@/lib/modes";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CrosshairIcon } from "@phosphor-icons/react/Crosshair";
import { EqualsIcon } from "@phosphor-icons/react/Equals";
import { FlagIcon } from "@phosphor-icons/react/Flag";
import { GaugeIcon } from "@phosphor-icons/react/Gauge";
import { LightningIcon } from "@phosphor-icons/react/Lightning";
import { ListDashesIcon } from "@phosphor-icons/react/ListDashes";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { ShieldIcon } from "@phosphor-icons/react/Shield";
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
  tokenMode: TokenMode;
  toolApprovalMode: ToolApprovalMode;
  onCollaborationModeChange: (mode: CollaborationMode) => void;
  onTokenModeChange: (mode: TokenMode) => void;
  onToolApprovalModeChange: (mode: ToolApprovalMode) => void;
  /** True while the agent is running — mode switches are disabled. */
  disabled?: boolean;
}

const COLLAB_ITEMS: MenuItem<CollaborationMode>[] = [
  { value: "normal", Icon: ArrowRightIcon, titleKey: "modes.collabNormalTitle", descKey: "modes.collabNormalDesc" },
  { value: "plan", Icon: ListDashesIcon, titleKey: "modes.collabPlanTitle", descKey: "modes.collabPlanDesc" },
  { value: "goal", Icon: TargetIcon, titleKey: "modes.collabGoalTitle", descKey: "modes.collabGoalDesc" },
];

const TOKEN_ITEMS: MenuItem<TokenMode>[] = [
  { value: "economy", Icon: GaugeIcon, titleKey: "modes.tokenEconomyTitle", descKey: "modes.tokenEconomyDesc" },
  { value: "full", Icon: EqualsIcon, titleKey: "modes.tokenFullTitle", descKey: "modes.tokenFullDesc" },
  { value: "delivery", Icon: FlagIcon, titleKey: "modes.tokenDeliveryTitle", descKey: "modes.tokenDeliveryDesc" },
];

const APPROVAL_ITEMS: MenuItem<ToolApprovalMode>[] = [
  { value: "ask", Icon: ShieldIcon, titleKey: "modes.approvalAskTitle", descKey: "modes.approvalAskDesc" },
  { value: "auto", Icon: ShieldCheckIcon, titleKey: "modes.approvalAutoTitle", descKey: "modes.approvalAutoDesc" },
  { value: "yolo", Icon: LightningIcon, titleKey: "modes.approvalYoloTitle", descKey: "modes.approvalYoloDesc" },
];

const COLLAB_ICONS: Record<CollaborationMode, IconCmp> = {
  normal: ArrowRightIcon,
  plan: ListDashesIcon,
  goal: TargetIcon,
};

const TOKEN_ICONS: Record<TokenMode, IconCmp> = {
  economy: GaugeIcon,
  full: EqualsIcon,
  delivery: FlagIcon,
};

const APPROVAL_ICONS: Record<ToolApprovalMode, IconCmp> = {
  ask: ShieldIcon,
  auto: ShieldCheckIcon,
  yolo: LightningIcon,
};

export function ModeControls({
  collaborationMode,
  tokenMode,
  toolApprovalMode,
  onCollaborationModeChange,
  onTokenModeChange,
  onToolApprovalModeChange,
  disabled = false,
}: ModeControlsProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [openMenu, setOpenMenu] = useState<"collab" | "token" | "approval" | null>(null);
  const [closing, setClosing] = useState<"collab" | "token" | "approval" | null>(null);
  const [rects, setRects] = useState<Record<string, { top: number; left: number; width: number }>>({});
  const collabRef = useRef<HTMLButtonElement>(null);
  const tokenRef = useRef<HTMLButtonElement>(null);
  const approvalRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);

  const trigger = (key: "collab" | "token" | "approval", ref: React.RefObject<HTMLButtonElement | null>) => () => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRects((prev) => ({ ...prev, [key]: { top: r.top, left: r.left, width: r.width } }));
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const closeMenu = useCallback((key: "collab" | "token" | "approval") => {
    setClosing(key);
    window.requestAnimationFrame(() => setOpenMenu((prev) => (prev === key ? null : prev)));
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setClosing(null), 150);
  }, []);

  const pick = (key: "collab" | "token" | "approval", value: string) => {
    closeMenu(key);
    if (key === "collab" && value !== collaborationMode) onCollaborationModeChange(value as CollaborationMode);
    if (key === "token" && value !== tokenMode) onTokenModeChange(value as TokenMode);
    if (key === "approval" && value !== toolApprovalMode) onToolApprovalModeChange(value as ToolApprovalMode);
  };

  const vh = () => window.visualViewport?.height ?? window.innerHeight;
  const vw = () => window.innerWidth;

  const renderMenu = <M extends string>(
    key: "collab" | "token" | "approval",
    items: MenuItem<M>[],
    current: M,
    IconForCurrent: IconCmp,
  ) => {
    if (openMenu !== key) return null;
    const rect = rects[key];
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
          opacity: closing === key ? 0 : 1,
          transition: "opacity 0.12s",
        }}
      >
        {items.map((item) => {
          const isActive = item.value === current;
          const Icon = item.Icon;
          return (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => pick(key, item.value)}
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

  const triggerStyle = (active: boolean, accent: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 3,
    padding: isMobile ? "0 3px" : "3px 6px",
    height: 24,
    background: active ? "var(--bg-hover)" : "none",
    border: "none",
    borderRadius: 6,
    color: accent ? "var(--accent)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: isMobile ? 11 : 12,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
    transition: "background 0.12s, color 0.12s",
    maxWidth: isMobile ? 30 : undefined,
  });

  const CollabIcon = COLLAB_ICONS[collaborationMode];
  const TokenIcon = TOKEN_ICONS[tokenMode];
  const ApprovalIcon = APPROVAL_ICONS[toolApprovalMode];

  const collabLabel = collaborationMode === "plan" ? t("modes.collabPlan") : collaborationMode === "goal" ? t("modes.collabGoal") : t("modes.collabNormal");
  const tokenLabel = tokenMode === "economy" ? t("modes.tokenEconomy") : tokenMode === "delivery" ? t("modes.tokenDelivery") : t("modes.tokenFull");
  const approvalLabel = toolApprovalMode === "ask" ? t("modes.approvalAsk") : toolApprovalMode === "yolo" ? t("modes.approvalYolo") : t("modes.approvalAuto");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          ref={collabRef}
          type="button"
          aria-label="任务模式"
          title={t("modes.collabNormalTitle")}
          aria-expanded={openMenu === "collab"}
          onClick={trigger("collab", collabRef)}
          disabled={disabled}
          style={triggerStyle(openMenu === "collab", collaborationMode !== "normal")}
        >
          <CollabIcon size={13} weight={collaborationMode !== "normal" ? "fill" : "regular"} color={collaborationMode !== "normal" ? "var(--accent)" : "var(--text-muted)"} aria-hidden="true" />
          {!isMobile && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{collabLabel}</span>}
          <CaretDownIcon size={10} weight="bold" aria-hidden="true" style={{ transform: openMenu === "collab" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s", flexShrink: 0 }} />
        </button>
        <button
          ref={tokenRef}
          type="button"
          aria-label="运行档位"
          title={t("modes.tokenFullTitle")}
          aria-expanded={openMenu === "token"}
          onClick={trigger("token", tokenRef)}
          disabled={disabled}
          style={triggerStyle(openMenu === "token", tokenMode !== "full")}
        >
          <TokenIcon size={13} weight={tokenMode !== "full" ? "fill" : "regular"} color={tokenMode !== "full" ? "var(--accent)" : "var(--text-muted)"} aria-hidden="true" />
          {!isMobile && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tokenLabel}</span>}
          <CaretDownIcon size={10} weight="bold" aria-hidden="true" style={{ transform: openMenu === "token" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s", flexShrink: 0 }} />
        </button>
        {!isMobile && (
          <div
            role="radiogroup"
            aria-label="工具权限"
            style={{
              display: "flex", alignItems: "center",
              border: "1px solid var(--border)", borderRadius: 7,
              overflow: "hidden", height: 22, marginLeft: 2,
            }}
          >
            {APPROVAL_ITEMS.map((item) => {
              const isActive = item.value === toolApprovalMode;
              const Icon = item.Icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => { if (item.value !== toolApprovalMode) onToolApprovalModeChange(item.value); }}
                  title={t(item.descKey)}
                  aria-label={t(item.titleKey)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    height: "100%", padding: "0 7px",
                    background: isActive ? "var(--bg-selected)" : "none",
                    border: "none",
                    color: isActive
                      ? (item.value === "yolo" ? "var(--accent-red, #ef4444)" : "var(--accent)")
                      : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11, fontWeight: isActive ? 650 : 500,
                    transition: "background 0.12s, color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                >
                  <Icon size={11} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
                  {t(item.value === "ask" ? "modes.approvalAsk" : item.value === "yolo" ? "modes.approvalYolo" : "modes.approvalAuto")}
                </button>
              );
            })}
          </div>
        )}
        {isMobile && (
          <button
            ref={approvalRef}
            type="button"
            aria-label="工具权限"
            title={t("modes.approvalAutoTitle")}
            aria-expanded={openMenu === "approval"}
            onClick={trigger("approval", approvalRef)}
            disabled={disabled}
            style={{
              ...triggerStyle(openMenu === "approval", toolApprovalMode === "ask"),
              ...(toolApprovalMode === "yolo" ? { color: "var(--accent-red, #ef4444)" } : {}),
            }}
          >
            <ApprovalIcon size={13} weight={toolApprovalMode === "ask" ? "fill" : "regular"} color={toolApprovalMode === "ask" ? "var(--accent)" : toolApprovalMode === "yolo" ? "var(--accent-red, #ef4444)" : "var(--text-muted)"} aria-hidden="true" />
            <CaretDownIcon size={10} weight="bold" aria-hidden="true" style={{ transform: openMenu === "approval" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s", flexShrink: 0 }} />
          </button>
        )}
      </div>
      {renderMenu("collab", COLLAB_ITEMS, collaborationMode, CollabIcon)}
      {renderMenu("token", TOKEN_ITEMS, tokenMode, TokenIcon)}
      {isMobile && renderMenu("approval", APPROVAL_ITEMS, toolApprovalMode, ApprovalIcon)}
    </>
  );
}
