"use client";

import { useCallback, useEffect, useState } from "react";
import { PlugsConnected, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";

/**
 * 服务器配置入口（仅 Pi Web 桌面壳内显示）。
 *
 * 桌面壳导航服务器时在 URL 附加 ?piweb_connected=1（desktop/src/window.rs build_url）。
 * 「切换服务器」通过 piweb-switch://manage 自定义导航触发壳打开连接管理窗口：
 * 壳的 on_navigation 拦截该 scheme（desktop/src/window.rs open_server_window）。
 * 纯浏览器访问（无壳）时本组件不渲染。
 */
export function ServerSwitchConfig() {
  const { t } = useI18n();
  const [desktopShell, setDesktopShell] = useState(false);
  const [host, setHost] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDesktopShell(params.has("piweb_connected"));
    setHost(window.location.host);
  }, []);

  const switchServer = useCallback(() => {
    // 壳拦截 piweb-switch:// 导航
    window.location.href = "piweb-switch://manage";
  }, []);

  if (!desktopShell) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.server")}</h1>
      </header>
      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
          <PlugsConnected size={18} color="var(--accent)" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.serverCurrent")}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{host}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={switchServer}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "10px 16px", borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent), var(--accent-hover, var(--accent)))",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", border: "none",
          }}
        >
          <ArrowCounterClockwise size={16} />
          {t("desktop.serverSwitch")}
        </button>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: "var(--text-muted)" }}>
          {t("desktop.serverSwitchHint")}
        </p>
      </div>
    </div>
  );
}
