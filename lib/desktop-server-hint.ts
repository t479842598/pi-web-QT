/**
 * 桌面壳「切换服务器」一次性引导的持久化（F-04 / D-04）。
 *
 * 打开即用之后，用户不再经过连接页，远程能力（连别的服务器、给本机服务设访问
 * 密码）就失去了一次自然曝光。这里只负责记录「这条提示是否已经看过」，
 * 让提示出现一次即长期生效。
 *
 * 存在 localStorage 而不是壳的 config.json：与侧边栏偏好等既有前端设置一致，
 * 且按 origin 隔离——从本机切到远程服务器时各自记一次，互不污染。
 */

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 隐私模式/被禁用时会抛 SecurityError
    return null;
  }
}

export const DESKTOP_SERVER_HINT_KEY = "pi-web:desktop-server-hint-seen";
const SEEN_VALUE = "1";

/**
 * 是否应展示引导。
 * 拿不到 storage（SSR 首帧、隐私模式）时返回 false —— 宁可少提示一次，
 * 也不要在服务端渲染的 HTML 里闪出气泡造成 hydration 不一致。
 */
export function shouldShowServerHint(
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(DESKTOP_SERVER_HINT_KEY) !== SEEN_VALUE;
  } catch {
    return false;
  }
}

/** 标记已看过。写入失败静默忽略：最坏情况只是下次再提示一次，不该打断用户操作。 */
export function markServerHintSeen(
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DESKTOP_SERVER_HINT_KEY, SEEN_VALUE);
  } catch {
    // best-effort
  }
}
