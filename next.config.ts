import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
const allowedDevOrigins = (process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? [])
  .map((host) => host.trim())
  .filter(Boolean);
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // M1 内置打包：产出 .next/standalone（自包含 server.js + 最小 node_modules），
  // 桌面壳随包拉起 node <standalone/server.js>，免本机 npm/CLI。
  output: "standalone",
  allowedDevOrigins,
  devIndicators: false,
  // proxy.ts clones the request body for /api/*; the Next.js default of
  // 10MB truncates large backup uploads (import route allows up to 512MB).
  experimental: {
    proxyClientMaxBodySize: "600mb",
  },
  serverExternalPackages: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },

    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
