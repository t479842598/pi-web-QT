import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Next 16 loads this file as ESM — __dirname is unavailable, derive from import.meta.
const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
// Loopback/LAN defaults first, then operator-supplied extra hosts.
const allowedDevOrigins = ["127.0.0.1", "192.168.*.*",
  ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? [])
    .map((host) => host.trim())
    .filter(Boolean),
];
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// mdast-util-gfm-autolink-literal (remark-gfm) ships a RegExp lookbehind that
// Safari parses only from 16.4, which blanked `/` on iOS 16.2 (#753). The loader
// swaps it for an equivalent built at runtime; both bundlers must run it.
const gfmAutolinkEmailLoader = join(configDir, "lib/gfm-autolink-email-loader.cjs");

const nextConfig: NextConfig = {
  // M1 内置打包：产出 .next/standalone（自包含 server.js + 最小 node_modules），
  // 桌面壳随包拉起 node <standalone/server.js>，免本机 npm/CLI。
  output: "standalone",
  outputFileTracingRoot: configDir,
  allowedDevOrigins,
  devIndicators: false,
  // proxy.ts clones the request body for /api/*; the Next.js default of
  // 10MB truncates large backup uploads (import route allows up to 512MB).
  experimental: {
    proxyClientMaxBodySize: "600mb",
  },
  // next/image is only used for the static logo, so the /_next/image optimizer
  // (and its sharp/libheif attack surface, see GHSA-2xp9-vwfh-vxw4) is not needed.
  images: { unoptimized: true },
  // `next dev` runs Turbopack and `npm run build` runs webpack.
  turbopack: {
    rules: {
      "**/mdast-util-gfm-autolink-literal/lib/index.js": { loaders: [gfmAutolinkEmailLoader] },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /[\\/]mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/,
      loader: gfmAutolinkEmailLoader,
    });
    return config;
  },
  // Node modules keep the syntax they ship unless listed here, and mermaid's
  // lazy diagram chunks are full of class `static {}` blocks (#753).
  transpilePackages: ["mermaid", "@mermaid-js/parser"],
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
