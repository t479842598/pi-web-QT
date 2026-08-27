"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

import { ArrowClockwise } from "@phosphor-icons/react";

import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
} from "@/lib/desktop-window";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";

import { useDesktopChrome } from "./useDesktopChrome";

/** 灵动岛位置持久化 key（localStorage，桌面壳专用）。 */
const STORAGE_KEY = "pi-web-island-pos";
/** 默认位置：避开标题栏下方的临时悬浮元素（子代理气泡 top 58、项目信任提示条 top 60）。 */
const DEFAULT_TOP = 100;
/** 默认位置：右侧留白 14px。 */
const DEFAULT_RIGHT = 14;
/** 胶囊整体尺寸（与渲染一致，用于位置 clamp）。 */
const ISLAND_W = 152;
const ISLAND_H = 42;

export interface IslandPosition {
  x: number;
  y: number;
}

/** 把灵动岛位置限制在视口内：防止拖出屏幕，也防止窗口缩小后残留窗外。 */
export function clampIslandPosition(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  w: number,
  h: number,
): IslandPosition {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, viewportW - w)),
    y: Math.min(Math.max(0, y), Math.max(0, viewportH - h)),
  };
}

const CONTROL_BTN_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  padding: 0,
  flexShrink: 0,
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  borderRadius: 8,
  transition: "background 0.12s, color 0.12s",
};

/**
 * 悬浮「灵动岛」窗口控制胶囊（Windows/Linux 无边框窗口专用）。
 *
 * 最小化 / 最大化 / 关闭 + 刷新按钮收进一个可拖动的圆角胶囊，悬浮在窗口
 * 内容区右上角，不再挤在标题栏里与功能区争宽度。胶囊本体可按住拖动，
 * 位置持久化到 localStorage；双击空白区域复位到默认位置。macOS 保留原生
 * 红绿灯，浏览器端整个组件渲染为空。
 */
export function DynamicIsland() {
  const { t: translate } = useI18n();
  const { isDark } = useTheme();
  const { isDesktop, isMacOS } = useDesktopChrome();
  const drawsOwnControls = isDesktop && !isMacOS;
  const [maximized, setMaximized] = useState(false);
  // 窗口命令（最小化/最大化/关闭）失败时的可见提示——Tauri invoke 被
  // 权限拒绝或 IPC 不可用时，用户不应面对"点了没反应"。
  const [cmdError, setCmdError] = useState<string | null>(null);
  // null = 默认位置（右上角）；非 null = 用户拖动后的 left/top。
  const [pos, setPos] = useState<IslandPosition | null>(null);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 统一执行窗口命令并捕获失败：失败信息短暂显示在胶囊下方。
  const runWindowCmd = useCallback((fn: () => Promise<void>) => {
    fn().catch((e) => {
      console.error("[DynamicIsland] window command failed:", e);
      setCmdError(String(e));
      window.setTimeout(() => setCmdError(null), 4000);
    });
  }, []);

  // 刷新 = 整页重载：欢迎页与会话页都有明确效果（会话页 URL 带 ?session=
  // 参数，重载后自动恢复当前会话并重连 SSE）。
  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  // 最大化状态同步（最大化/还原图标切换）。
  useEffect(() => {
    if (!isTauriDesktop() || !drawsOwnControls) return;
    const refresh = () => { void isWindowMaximized().then(setMaximized); };
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [drawsOwnControls]);

  // 恢复上次拖动的保存位置（损坏数据直接忽略，用默认位置）。
  useEffect(() => {
    if (!drawsOwnControls) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<IslandPosition>;
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          setPos(
            clampIslandPosition(parsed.x, parsed.y, window.innerWidth, window.innerHeight, ISLAND_W, ISLAND_H),
          );
        }
      }
    } catch {
      /* 忽略损坏的存储 */
    }
  }, [drawsOwnControls]);

  // 拖动结束（或位置变化）后持久化。
  useEffect(() => {
    if (!drawsOwnControls || !pos) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* 忽略（如隐私模式） */
    }
  }, [pos, drawsOwnControls]);

  // 窗口尺寸变化（缩放/最大化）时把岛拉回视口内，并刷新默认位置的
  // 右对齐基准（left 在渲染期读 window.innerWidth，需要 state 触发重渲染）。
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    if (!drawsOwnControls) return;
    const onResize = () => {
      setViewportW(window.innerWidth);
      setPos((p) =>
        p
          ? clampIslandPosition(p.x, p.y, window.innerWidth, window.innerHeight, ISLAND_W, ISLAND_H)
          : p,
      );
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawsOwnControls]);

  // 按下胶囊空白区域（非按钮）开始拖动。
  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.("[data-island-btn]")) return;
    const el = islandRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPos(
      clampIslandPosition(d.origX + dx, d.origY + dy, window.innerWidth, window.innerHeight, ISLAND_W, ISLAND_H),
    );
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针捕获可能已被释放 */
    }
  }, []);

  // 切换最大化/还原：乐观取反本地图标状态（toggle 后立即查询可能拿到
  // 旧值——Windows 上窗口尺寸变化是异步落地的），下次 resize 再校正。
  const handleToggleMaximize = useCallback(() => {
    setMaximized((m) => !m);
    return toggleMaximizeWindow();
  }, []);

  // 双击胶囊空白区域复位默认位置（按钮上的双击不触发复位）。
  const handleDoubleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (dragState.current) return;
    if ((e.target as HTMLElement).closest?.("[data-island-btn]")) return;
    setPos(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
  }, []);

  if (!drawsOwnControls) return null;

  const vw = viewportW || window.innerWidth;
  const left =
    pos !== null
      ? pos.x
      : Math.max(0, vw - ISLAND_W - DEFAULT_RIGHT);

  return (
    <>
    <div
      ref={islandRef}
      role="toolbar"
      aria-label={translate("desktop.islandLabel")}
      title={translate("desktop.islandResetHint")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      // 灵动岛可能渲染在标题栏 DOM 内（保险起见阻止 mousedown 冒泡），
      // 否则标题栏的窗口拖动处理会拦截按下动作：按胶囊=拖窗口、双击=最大化。
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClickCapture={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos !== null ? pos.y : DEFAULT_TOP,
        left,
        zIndex: 700,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "4px 6px",
        borderRadius: 999,
        // 背景与边框直接用主题变量 → 明暗主题自动跟随；阴影按 isDark 调整浓度。
        // 不用 backdropFilter：桌面壳禁 GPU 软件渲染下 blur 每帧全页重绘，
        // 拖动卡顿、点击反馈延迟（"时灵时不灵"的体感来源之一）。
        background: "color-mix(in srgb, var(--bg-panel) 88%, transparent)",
        border: "1px solid var(--border)",
        boxShadow: isDark
          ? "0 6px 24px rgba(0,0,0,0.45)"
          : "0 6px 20px rgba(0,0,0,0.12)",
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* 刷新会话 */}
      <button
        type="button"
        data-island-btn
        aria-label={translate("desktop.refreshSession")}
        title={translate("desktop.refreshSession")}
        onClick={handleRefresh}
        style={CONTROL_BTN_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <ArrowClockwise size={14} aria-hidden="true" />
      </button>

      {/* 分隔线 */}
      <span
        aria-hidden="true"
        style={{ width: 1, height: 18, flexShrink: 0, background: "var(--border)", margin: "0 3px" }}
      />

      {/* 最小化 */}
      <button
        type="button"
        data-island-btn
        aria-label={translate("desktop.minimize")}
        title={translate("desktop.minimize")}
        onClick={() => runWindowCmd(minimizeWindow)}
        style={CONTROL_BTN_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <line x1="0" y1="5" x2="10" y2="5" />
        </svg>
      </button>

      {/* 最大化 / 还原 */}
      <button
        type="button"
        data-island-btn
        aria-label={maximized ? translate("desktop.restore") : translate("desktop.maximize")}
        title={maximized ? translate("desktop.restore") : translate("desktop.maximize")}
        onClick={() => runWindowCmd(handleToggleMaximize)}
        style={CONTROL_BTN_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="0.5" width="7.5" height="7.5" />
            <path d="M0.5 2.5 V9.5 H7.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>

      {/* 关闭 */}
      <button
        type="button"
        data-island-btn
        aria-label={translate("desktop.close")}
        title={translate("desktop.close")}
        onClick={() => runWindowCmd(closeWindow)}
        style={CONTROL_BTN_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#e81123";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
    {/* 窗口命令失败提示：短暂显示在胶囊下方，避免"点了没反应"。 */}
    {cmdError && (
      <div
        role="alert"
        style={{
          position: "fixed",
          top: (pos !== null ? pos.y : DEFAULT_TOP) + ISLAND_H + 6,
          left,
          zIndex: 700,
          maxWidth: 280,
          padding: "5px 10px",
          borderRadius: 8,
          background: "var(--bg-panel)",
          border: "1px solid var(--status-error, #f85149)",
          color: "var(--status-error, #f85149)",
          fontSize: 11,
          lineHeight: 1.5,
          wordBreak: "break-all",
          boxShadow: isDark
            ? "0 6px 24px rgba(0,0,0,0.45)"
            : "0 6px 20px rgba(0,0,0,0.12)",
          pointerEvents: "none",
        }}
      >
        {cmdError}
      </div>
    )}
    </>
  );
}
