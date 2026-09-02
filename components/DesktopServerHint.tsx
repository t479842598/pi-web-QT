"use client";

import { useCallback, useEffect, useState } from "react";
import { PlugsConnected, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { markServerHintSeen, shouldShowServerHint } from "@/lib/desktop-server-hint";

/**
 * 桌面壳一次性引导气泡（F-04 / D-04）。
 *
 * 桌面端改为「打开即用」之后，用户不再经过连接页，远程能力（连别的服务器、
 * 给本机服务设访问密码）就失去了自然曝光。这个气泡在首次进入主界面时出现在
 * 右上角「切换服务器」按钮下方指一次路，看过或关掉后永不再现。
 *
 * 显示条件与右上角那个按钮完全一致（URL 带 piweb_connected=1），纯浏览器访问
 * Pi Web 时不打扰。状态在 useEffect 里读取，首帧不渲染，避免 SSR hydration
 * 不一致（与 AppTitleBar 的 ThemeToggleButton 同一处理方式）。
 */
export function DesktopServerHint() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let inShell = false;
    try {
      inShell = new URLSearchParams(window.location.search).has("piweb_connected");
    } catch {
      inShell = false;
    }
    if (inShell && shouldShowServerHint()) setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    markServerHintSeen();
    setVisible(false);
  }, []);

  const openManager = useCallback(() => {
    markServerHintSeen();
    setVisible(false);
    // 壳在 on_navigation 里拦截该 scheme 并打开连接管理窗口
    window.location.href = "piweb-switch://manage";
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        zIndex: 700,
        width: 288,
        padding: "14px 16px 14px",
        borderRadius: 12,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        boxShadow: "0 12px 36px rgba(0,0,0,0.32)",
        color: "var(--text)",
      }}
    >
      {/* 指向右上角按钮的小箭头 */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -6,
          right: 28,
          width: 10,
          height: 10,
          background: "var(--bg-panel)",
          borderTop: "1px solid var(--border)",
          borderLeft: "1px solid var(--border)",
          transform: "rotate(45deg)",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <PlugsConnected size={18} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>
            {t("desktop.serverHintTitle")}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.65, color: "var(--text-muted)" }}>
            {t("desktop.serverHintBody")}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("desktop.serverHintDismiss")}
          title={t("desktop.serverHintDismiss")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, padding: 0, flexShrink: 0,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-dim)",
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onClick={openManager}
        style={{
          marginTop: 12, width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "8px 12px", borderRadius: 9,
          background: "var(--accent)", border: "none",
          color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        {t("desktop.serverHintAction")}
      </button>
    </div>
  );
}
