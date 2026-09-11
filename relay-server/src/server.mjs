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

const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(here, "..", "public");

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
/** Optional shared secret; empty means pairing tokens are the only gate. */
const PASSWORD = process.env.RELAY_PASSWORD ?? "";
/** Shared secret the desktop must present to register as a device. */
const DEVICE_SECRET = process.env.RELAY_DEVICE_SECRET ?? "";
const PUBLIC_URL = (process.env.RELAY_PUBLIC_URL ?? "").replace(/\/$/, "");

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
      publicUrl: PUBLIC_URL || null,
    }));
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
