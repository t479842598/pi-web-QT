"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 全局错误边界：捕获 React 组件渲染异常，避免白屏。
 * 当远程服务器数据异常或网络问题导致组件抛出未捕获错误时，
 * 显示错误提示而非空白页面。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 40,
            backgroundColor: "var(--bg, #fff)",
            color: "var(--text, #333)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>应用加载失败</h2>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted, #666)", maxWidth: 500, textAlign: "center" }}>
            {this.state.error?.message || "未知错误"}
          </p>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim, #999)",
              maxWidth: 600,
              wordBreak: "break-all",
              textAlign: "center",
              padding: "12px 16px",
              backgroundColor: "var(--bg-panel, #f5f5f5)",
              borderRadius: 8,
            }}
          >
            {this.state.error?.stack?.split("\n").slice(0, 5).join("\n")}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--accent, #0d9488)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            刷新页面
          </button>
          <button
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border, #ddd)",
              backgroundColor: "transparent",
              color: "var(--text-muted, #666)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            清除缓存并刷新
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
