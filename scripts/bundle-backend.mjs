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
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve, dirname, basename, sep } from "node:path";
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
  // 构建期必须丢掉运行时遗留的 __NEXT_PRIVATE_STANDALONE_CONFIG：standalone
  // server.js 会把 nextConfig 序列化进该变量（函数成员被 JSON 丢弃，如
  // generateBuildId），若宿主环境带此变量再跑 next build，Next 会直接采用
  // 这份旧配置 → “TypeError: generate is not a function” 全平台构建异常。
  delete env.__NEXT_PRIVATE_STANDALONE_CONFIG;
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
// 注意：某些包（如 pi-agent-core）在 npm 安装时可能被提升到嵌套 node_modules
// 而非顶层，必须用 require.resolve 解析真实路径，否则 lstat 直接 ENOENT 崩溃。
const piPkgNames = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];
/** 解析 pi 包真实根目录。兼容三种布局：
 *  1) 顶层 node_modules（pi-tui 等）
 *  2) exports 字段屏蔽 package.json 子路径（用主入口反推根目录）
 *  3) npm 嵌套提升：pi-agent-core 等被提升到 pi-coding-agent 的 node_modules 下
 *     （从 pi-coding-agent 的 require 上下文解析，与运行时一致）
 */
function resolvePiPkgRoot(pkg) {
  const tryPaths = [
    () => dirname(require.resolve(`${pkg}/package.json`)),
    () => dirname(require.resolve(pkg)),
    () => {
      const ctx = createRequire(
        join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
      );
      return dirname(ctx.resolve(`${pkg}/package.json`));
    },
    () => {
      const ctx = createRequire(
        join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
      );
      return dirname(ctx.resolve(pkg));
    },
  ];
  for (const resolveFn of tryPaths) {
    try {
      const p = resolveFn();
      if (p) return p;
    } catch {
      // 该解析策略不适用，尝试下一个
    }
  }
  return join(root, "node_modules", ...pkg.split("/"));
}
for (const pkg of piPkgNames) {
  const src = resolvePiPkgRoot(pkg);
  const dst = join(outBackend, "node_modules", ...pkg.split("/"));
  if (existsSync(src)) {
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    console.log(`[bundle-backend] 覆盖完整包内容: ${pkg} <- ${src}`);
  } else {
    console.warn(`[bundle-backend] 跳过未找到的包: ${pkg}`);
  }
}

// 4.6 写入桌面启动器（父进程看门狗 + dlopen ABI 保护；见 desktop/server-launcher.cjs）
// Rust 侧（probe::spawn_bundled）优先以 desktop-server.cjs 作为入口拉起。
copyFileSync(
  join(root, "desktop", "server-launcher.cjs"),
  join(outBackend, "desktop-server.cjs"),
);
console.log("[bundle-backend] 写入启动器 desktop-server.cjs");

// 5. Node 二进制 → desktop/resources/node（Win/Linux）
//    macOS 额外包成 Pi Agent Server.app（LSBackgroundOnly，不进 Dock；
//    bundle ID 与父应用一致避免 macOS Sequoia+ TCC 每次弹窗，见
//    desktop/server-helper-Info.plist）。resources/node 仍保留作为回退。
const nodeBin = process.env.PI_WEB_NODE_BIN || process.execPath;
if (!existsSync(nodeBin)) {
  fail(`Node 二进制不存在: ${nodeBin}`);
}
// 自拷贝陷阱：当 nodeBin 恰好位于 outNode 内（如用打包产物里的 node 跑本脚本）
// 时，先复制到临时位置，否则下面 rmSync(outNode) 会连源一起删掉。
let nodeSrc = nodeBin;
const outNodeAbs = resolve(outNode);
const nodeBinAbs = resolve(nodeBin);
if (nodeBinAbs.startsWith(outNodeAbs + sep)) {
  const tmpDir = join(root, ".bundle-tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpNode = join(tmpDir, "node-src");
  copyFileSync(nodeBin, tmpNode);
  nodeSrc = tmpNode;
}
rmSync(outNode, { recursive: true, force: true });
mkdirSync(outNode, { recursive: true });
const nodeTarget = join(outNode, process.platform === "win32" ? "node.exe" : "node");
copyFileSync(nodeSrc, nodeTarget);
if (process.platform !== "win32") {
  chmodSync(nodeTarget, 0o755);
}

// macOS：把 node 包成 LSBackgroundOnly .app（不进 Dock，bundle ID 复用父应用
// 避免 Sequoia+ TCC 弹窗）。Windows/Linux：创建空目录占位（tauri.conf.json
// 统一声明了该资源，缺失会导致 build 报错）。
const serverHelperDir = join(root, "desktop", "resources", "Pi Agent Server.app");
const helperContents = join(serverHelperDir, "Contents");
rmSync(serverHelperDir, { recursive: true, force: true });
if (process.platform === "darwin") {
  const helperNode = join(helperContents, "MacOS", "node");
  mkdirSync(dirname(helperNode), { recursive: true });
  copyFileSync(nodeSrc, helperNode);
  chmodSync(helperNode, 0o755);
  copyFileSync(
    join(root, "desktop", "server-helper-Info.plist"),
    join(helperContents, "Info.plist"),
  );
  console.log(`[bundle-backend] 完成：node    -> ${helperNode} (Pi Agent Server.app)`);
} else {
  // 非 macOS 创建空目录让 tauri-build 的 WalkDir 跳过即可
  mkdirSync(helperContents, { recursive: true });
  console.log(`[bundle-backend] 完成：Pi Agent Server.app -> (占位，非 macOS 空)`);
}

// 6. 去重嵌套 node_modules：npm 会把同版本依赖重复嵌套进子 node_modules，
//    每层嵌套让路径变长 ~45 字符，Windows NSIS 会撞 260 字符 MAX_PATH。
//    仅删除与顶层精确同版本的嵌套副本（真正的版本冲突保留，Node 解析不受影响）。
function listPackageDirs(nodeModulesDir) {
  const packages = [];
  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      let scoped;
      try {
        scoped = readdirSync(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        if (s.isDirectory()) {
          packages.push({ name: `${entry.name}/${s.name}`, dir: join(entryPath, s.name) });
        }
      }
      continue;
    }
    packages.push({ name: entry.name, dir: entryPath });
  }
  return packages;
}

function readPackageVersion(packageDir) {
  try {
    return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function dedupeNestedPackages() {
  const topLevelDir = join(outBackend, "node_modules");
  const topLevelVersions = new Map();
  for (const { name, dir } of listPackageDirs(topLevelDir)) {
    topLevelVersions.set(name, readPackageVersion(dir));
  }
  let removed = 0;
  for (const { dir } of listPackageDirs(topLevelDir)) {
    const nestedDir = join(dir, "node_modules");
    for (const nested of listPackageDirs(nestedDir)) {
      const topVersion = topLevelVersions.get(nested.name);
      if (!topVersion) continue;
      if (topVersion !== readPackageVersion(nested.dir)) continue;
      rmSync(nested.dir, { recursive: true, force: true });
      removed += 1;
    }
  }
  if (removed > 0) {
    console.log(`[bundle-backend] 去重嵌套包: ${removed} 个`);
  }
  return removed;
}

dedupeNestedPackages();

// 7. Windows MAX_PATH 预检：模拟 windows-latest runner 上的 checkout 路径，
//    超 260 字符的路径在 macOS 上直接失败，而不是等 makensis 报"failed opening file"。
function findOverlongPaths() {
  const windowsPrefix =
    "D:\\a\\pi-web-QT\\pi-web-QT\\desktop\\resources\\backend";
  const overlong = [];
  function walk(dir, relative) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), childRelative);
        continue;
      }
      const full = `${windowsPrefix}\\${childRelative}`;
      if (full.length > 260) overlong.push({ length: full.length, path: childRelative });
    }
  }
  walk(outBackend, "");
  return overlong;
}

const overlong = findOverlongPaths();
if (overlong.length > 0) {
  console.error(
    `[bundle-backend] ${overlong.length} 个暂存路径超 Windows 260 字符限制：\n` +
      overlong.map(({ length, path }) => `  ${length}  ${path}`).join("\n"),
  );
  fail("暂存路径会破坏 Windows 安装包构建。");
}

console.log(`[bundle-backend] 完成：backend -> ${outBackend}`);
console.log(`[bundle-backend] 完成：node    -> ${nodeTarget}`);

// 清理临时副本（自拷贝场景）
if (nodeSrc !== nodeBin) {
  rmSync(dirname(nodeSrc), { recursive: true, force: true });
}
