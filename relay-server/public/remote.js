/**
 * Mobile remote entry point.
 *
 * The QR link carries a single-use token in the path (`/r/<token>`). We redeem
 * it over the relay socket, then keep that socket as the transport: every frame
 * the desktop sends is handed to `window.__piRemoteFrame` so the hosted page can
 * render whatever the main app needs.
 */

const PROTOCOL_VERSION = 1;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

const app = document.getElementById("app");
const hint = document.getElementById("hint");
const retry = document.getElementById("retry");
const errorBox = document.getElementById("error");
const errorTitle = document.getElementById("error-title");
const errorDetail = document.getElementById("error-detail");
const errorRetry = document.getElementById("error-retry");

/** `/r/<token>` → token; every other path has none. */
function tokenFromPath() {
  const match = /^\/r\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function deviceMidFromQuery() {
  return new URLSearchParams(window.location.search).get("mid") ?? "";
}

function showError(title, detail) {
  app.dataset.state = "error";
  errorBox.hidden = false;
  errorTitle.textContent = title;
  errorDetail.textContent = detail;
}

const ERROR_TEXT = {
  relayUnavailable: "中继暂时不可达，请稍后重试。",
  sessionExpired: "配对二维码已过期，请在桌面端重新生成。",
  sessionNotFound: "配对信息无效，请在桌面端重新扫码。",
  kicked: "该配对已被吊销或已使用，请在桌面端重新生成二维码。",
  desktopDisconnected: "桌面端已断开，请确认 Pi Web 正在运行。",
  invalidMobileConnection: "连接参数无效，请重新扫码。",
};

let attempt = 0;
let socket = null;
let stopped = false;

function connect() {
  const token = tokenFromPath();
  const mid = deviceMidFromQuery();
  if (!token || !mid) {
    showError("缺少配对信息", "请从桌面端重新扫描二维码。");
    return;
  }

  hint.textContent = "正在连接桌面端…";
  app.dataset.state = "waiting";
  errorBox.hidden = true;

  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${window.location.host}/ws?role=client`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      type: "client_pair",
      protocol_version: PROTOCOL_VERSION,
      device_mid: mid,
      token,
    }));
  });

  socket.addEventListener("message", (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }

    if (frame.type === "pair_result" && frame.ok === false) {
      showError("无法连接", ERROR_TEXT[frame.code] ?? `连接失败：${frame.code}`);
      return;
    }
    if (frame.type === "pair_result" && frame.ok === true) {
      attempt = 0;
      hint.textContent = "已连接";
      app.dataset.state = "connected";
      // Handshake done; the hosted app takes over from here.
      window.dispatchEvent(new CustomEvent("pi-remote-ready"));
      return;
    }
    window.__piRemoteFrame?.(frame);
  });

  socket.addEventListener("close", () => {
    if (stopped) return;
    if (app.dataset.state === "error") return;
    if (app.dataset.state === "connected") {
      hint.textContent = "连接已断开，正在重连…";
      app.dataset.state = "waiting";
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    setTimeout(connect, delay);
  });
}

retry.addEventListener("click", () => { attempt = 0; connect(); });
errorRetry.addEventListener("click", () => { attempt = 0; connect(); });

window.addEventListener("pagehide", () => {
  stopped = true;
  try { socket?.close(); } catch { /* already closed */ }
});

connect();
