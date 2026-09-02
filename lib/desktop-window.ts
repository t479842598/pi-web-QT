import type { Window } from "@tauri-apps/api/window";

export type DesktopPlatform = "macos" | "windows" | "linux" | null;

/** Best-effort OS family for the desktop shell, used to pick window-chrome styling. */
export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return null;
  const platform = navigator.platform || "";
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  if (/linux/i.test(platform)) return "linux";
  return null;
}

/**
 * 当前窗口的**缓存**句柄。
 *
 * 为什么必须缓存（这是「胶囊第一次点了没反应、第二次才生效」的根因）：旧实现里
 * 每个窗口命令都各自 `await import("@tauri-apps/api/window")`，于是第一次点击要
 * 先解析 chunk 路径 → 加载 → 求值 → 才发出 IPC；桌面壳（Windows 还强制软件渲染）
 * 上这段开销足以让用户以为没生效。第二次点击命中模块缓存才立刻响应。
 *
 * 现在加载一次并复用同一个 Window 实例，配合 `preloadWindowApi()` 在组件挂载时
 * 预热，点击路径上不再有任何动态 import。
 */
let currentWindowPromise: Promise<Window> | null = null;

function currentWindow(): Promise<Window> {
  if (!currentWindowPromise) {
    currentWindowPromise = import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
  }
  return currentWindowPromise;
}

/**
 * 预热窗口 API（幂等，可重复调用）。失败时清空缓存让下次点击有机会重试，
 * 并把错误抛给调用方决定如何提示——不静默吞掉，否则又变成「点了没反应」。
 */
export function preloadWindowApi(): Promise<void> {
  return currentWindow().then(
    () => undefined,
    (error) => {
      currentWindowPromise = null;
      throw error;
    },
  );
}

async function withWindow(run: (win: Window) => Promise<unknown>): Promise<void> {
  const win = await currentWindow();
  await run(win);
}

export async function minimizeWindow(): Promise<void> {
  await withWindow((win) => win.minimize());
}

export async function toggleMaximizeWindow(): Promise<void> {
  await withWindow((win) => win.toggleMaximize());
}

export async function startDraggingWindow(): Promise<void> {
  await withWindow((win) => win.startDragging());
}

export async function closeWindow(): Promise<void> {
  await withWindow((win) => win.close());
}

export async function isWindowMaximized(): Promise<boolean> {
  const win = await currentWindow();
  return win.isMaximized();
}
