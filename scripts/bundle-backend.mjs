#!/usr/bin/env node
/**
 * 构建期装配脚本（M1）：产出 Tauri 随包内置后端资源，实现「免 npm/CLI、双击即用」。
 *
 * 流程：
 *   1. next build（webpack，与 npm run build 一致）→ .next/standalone
 *   2. 固化 undici 修复到 standalone 的 node_modules（copy 而非 symlink，
 *      避免安装包内只读目录在运行时写失败）
 *   3. 把 .next/static + public 收进 standalone（standalone 不自带这些静态资源）
 *   4. 复制 standalone → desktop/resources/backend
 *   5. 复制当前 Node 二进制 → desktop/resources/node/{node|node.exe}
 *
 * 用法：
 *   npm run bundle:backend
 * 可用环境变量 PI_WEB_NODE_BIN 指定要打包的 Node 二进制（默认 process.execPath，
 * 跨平台 CI 需按目标架构提供对应二进制）。
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  rmSync,
  mkdirSync,
  existsSync,
  chmodSync,
  copyFileSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");
const outBackend = join(root, "desktop", "resources", "backend");
const outNode = join(root, "desktop", "resources", "node");

function fail(msg) {
  console.error(`[bundle-backend] ${msg}`);
  process.exit(1);
}

// 1. 构建 standalone（直接跑 next 的 JS 入口，避免 .bin 符号链接与路径含空格问题）
if (!existsSync(nextBin)) {
  fail(`未找到 next: ${nextBin}（请先 npm install）`);
}
console.log("[bundle-backend] next build --webpack …");
try {
  const env = { ...process.env };
  delete env.TURBOPACK; // 强制 webpack（与 npm run build 的 env -u TURBOPACK 一致）
  execFileSync(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: root,
    stdio: "inherit",
    env,
  });
} catch (e) {
  fail(`next build 失败: ${e.message ?? e}`);
}
if (!existsSync(join(standalone, "server.js"))) {
  fail("未找到 .next/standalone/server.js（需 next.config.ts 配置 output:'standalone'）");
}

// 2. 固化 undici 修复（构建期 copy）
const { solidifyUndiciFix } = require(join(root, "bin", "fix-pi-agent-undici.js"));
solidifyUndiciFix(standalone, join(root, "node_modules", "undici"));

// 3. 收进静态资源（standalone 不自带 static/public）
if (existsSync(staticDir)) {
  cpSync(staticDir, join(standalone, ".next", "static"), { recursive: true });
}
if (existsSync(publicDir)) {
  cpSync(publicDir, join(standalone, "public"), { recursive: true });
}

// 4. standalone → desktop/resources/backend
//    排除所有 .env* 文件：next build 会把仓库根 .env（含真实 PI_WEB_PASSWORD）
//    复制进 standalone/.env，绝不能打进安装包。
rmSync(outBackend, { recursive: true, force: true });
mkdirSync(outBackend, { recursive: true });
cpSync(standalone, outBackend, {
  recursive: true,
  filter: (src) => !basename(src).startsWith(".env"),
});

// 4.5 补全 pi-* 包的完整内容：@vercel/nft 只追踪 require/import，会漏掉运行时
// 用 fs.readFileSync 加载的非 JS 资源（如 pi-coding-agent 的
// dist/modes/interactive/theme/dark.json），导致内置后端发消息时报 ENOENT。
// 直接整包覆盖 standalone 里被 nft 精简过的副本，确保资源齐全。
for (const pkg of [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
]) {
  const src = join(root, "node_modules", ...pkg.split("/"));
  const dst = join(outBackend, "node_modules", ...pkg.split("/"));
  if (existsSync(src)) {
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  }
}

// 5. Node 二进制 → desktop/resources/node
const nodeBin = process.env.PI_WEB_NODE_BIN || process.execPath;
if (!existsSync(nodeBin)) {
  fail(`Node 二进制不存在: ${nodeBin}`);
}
rmSync(outNode, { recursive: true, force: true });
mkdirSync(outNode, { recursive: true });
const nodeTarget = join(outNode, process.platform === "win32" ? "node.exe" : "node");
copyFileSync(nodeBin, nodeTarget);
if (process.platform !== "win32") {
  chmodSync(nodeTarget, 0o755);
}

console.log(`[bundle-backend] 完成：backend -> ${outBackend}`);
console.log(`[bundle-backend] 完成：node    -> ${nodeTarget}`);
