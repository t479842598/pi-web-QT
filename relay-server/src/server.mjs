/**
 * Relay server entry point.
 *
 * A transparent WebSocket pipe between one pi-web desktop and the mobile
 * browser that paired with it. It serves the mobile page as static files and
 * upgrades `/ws` connections; it never inspects chat payloads.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { bindSocket, createHub } from "./hub.mjs";
import { MAX_FRAME_BYTES, digestsEqual, hashToken } from "./protocol.mjs";
import { WEB_PREFIX, isHtmlResponse, isRelayOwnedPath, rewriteHtml, rewriteLocation, toUpstreamPath } from "./proxy.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(here, "..", "public");

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
/** Optional shared secret; empty means pairing tokens are the only gate. */
const PASSWORD = process.env.RELAY_PASSWORD ?? "";
/** Shared secret the desktop must present to register as a device. */
const DEVICE_SECRET = process.env.RELAY_DEVICE_SECRET ?? "";
const PUBLIC_URL = (process.env.RELAY_PUBLIC_URL ?? "").replace(/\/$/, "");

/** Cookie carrying the durable session credential for `/web/` proxy requests. */
const SESSION_COOKIE = "piweb_relay_session";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function log(level, message, extra) {
  const line = `[relay] ${message}`;
  const write = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  write(extra === undefined ? line : `${line} ${JSON.stringify(extra)}`);
}

const hub = createHub({ log, deviceSecret: DEVICE_SECRET });

function parseCookies(header) {
  const out = new Map();
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

/** Read the whole request body, capped so a large upload cannot exhaust memory. */
function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Serve the full pi-web app under `/web/`.
 *
 * pi-web sits behind NAT, so this cannot be a plain reverse proxy — the request
 * is tunnelled to the desktop over the same socket the phone uses. The session
 * credential travels in a cookie, which is what lets ordinary browser requests
 * (assets, API calls) authenticate without a WebSocket handshake.
 */
async function serveWeb(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const cookies = parseCookies(req.headers.cookie);
  const rawSession = cookies.get(SESSION_COOKIE) ?? "";
  const session = hub.sessionFor(rawSession);
  if (!session) {
    res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><meta charset=utf-8><title>未配对</title>"
      + "<p style=\"font-family:system-ui;padding:20px\">会话已失效或未配对。请回到远程首页重新扫码。</p>");
    return;
  }
  const device = hub.deviceFor(session.mid);
  if (!device || !device.socket) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("桌面端未连接");
    return;
  }

  let body;
  try {
    body = req.method === "GET" || req.method === "HEAD" ? undefined : (await readBody(req));
  } catch (error) {
    res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "body error");
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    if (name === "host" || name === "cookie" || name === "connection" || name === "accept-encoding") continue;
    headers[name] = value;
  }

  let status = 200;
  const responseHeaders = {};
  let headSent = false;
  let htmlBuffer = null;
  try {
    await hub.proxyRequest(device, {
      method: req.method ?? "GET",
      path: toUpstreamPath(url.pathname) + url.search,
      headers,
      body: body && body.length > 0 ? body.toString("utf8") : undefined,
      onHead: (upstreamStatus, upstreamHeaders) => {
        status = upstreamStatus;
        for (const [name, value] of Object.entries(upstreamHeaders)) {
          if (name === "content-length" || name === "transfer-encoding" || name === "content-encoding" || name === "set-cookie") continue;
          responseHeaders[name] = value;
        }
        if (upstreamHeaders.location) responseHeaders.location = rewriteLocation(upstreamHeaders.location);
        headSent = true;
        // HTML is buffered for the rewrite pass, so the length is unknown until
        // the body is complete — hold the head back and send both together.
        if (!isHtmlResponse(responseHeaders)) res.writeHead(status, responseHeaders);
      },
      onChunk: (chunk) => {
        if (isHtmlResponse(responseHeaders)) {
          htmlBuffer = htmlBuffer === null ? chunk : Buffer.concat([htmlBuffer, chunk]);
          return;
        }
        if (headSent) res.write(chunk);
      },
      onEnd: () => {
        if (htmlBuffer !== null) {
          const html = rewriteHtml(htmlBuffer.toString("utf8"));
          const out = Buffer.from(html, "utf8");
          res.writeHead(status, { ...responseHeaders, "content-length": String(out.length) });
          res.end(out);
          return;
        }
        if (headSent) res.end();
      },
    });
  } catch (error) {
    if (!headSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`代理失败：${error instanceof Error ? error.message : String(error)}`);
    } else {
      res.end();
    }
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  // `/r/<token>` is the QR entry point: the token travels in the path, so the
  // page can pair without a query string being stripped by a proxy.
  const pathname = url.pathname === "/" || url.pathname.startsWith("/r/") ? "/index.html" : url.pathname;
  const target = normalize(join(publicDir, pathname));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Cache-Control": pathname === "/index.html" ? "no-store" : "public, max-age=3600",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      ok: true,
      devices: hub.devices.size,
      sessions: hub.sessions.size,
      publicUrl: PUBLIC_URL || null,
    }));
    return;
  }
  // The full app lives behind the same session cookie, so the page can hand
  // off to it without a second pairing.
  if (url.pathname === WEB_PREFIX || url.pathname.startsWith(`${WEB_PREFIX}/`)) {
    // `/web` (no slash) is the only form that redirects: relative asset paths
    // inside the proxied document resolve against `/web/`, not `/web`.
    if (url.pathname === WEB_PREFIX) {
      res.writeHead(302, { Location: `${WEB_PREFIX}/${url.search}` }).end();
      return;
    }
    void serveWeb(req, res);
    return;
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (PASSWORD) {
    const provided = url.searchParams.get("password") ?? "";
    // Constant-time even though it is a hash comparison: the codebase already
    // has the safe primitive, so there is no reason to use `!==` here.
    if (!digestsEqual(hashToken(provided), hashToken(PASSWORD))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  const role = url.searchParams.get("role") === "device" ? "device" : "client";
  wss.handleUpgrade(req, socket, head, (ws) => {
    bindSocket(hub, ws, role);
    log("info", "socket open", { role });
  });
});

server.listen(PORT, HOST, () => {
  log("info", "listening", {
    host: HOST,
    port: PORT,
    publicUrl: PUBLIC_URL || null,
    password: PASSWORD ? "on" : "off",
    deviceSecret: DEVICE_SECRET ? "on" : "off",
  });
});

function shutdown(signal) {
  log("info", `received ${signal}, shutting down`);
  wss.close();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck socket.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
