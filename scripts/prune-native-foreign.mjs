#!/usr/bin/env node
/**
 * 剔除随包后端里"非本机"的原生二进制（.node / prebuilds）。
 *
 * 为什么必须剔：
 *   - AppImage 的 linuxdeploy 会扫描 AppDir 下每一个 ELF 并逐个解析依赖。
 *     sharp 的 musl 变体链接 libc.musl-x86_64.so.1，在 glibc runner 上直接
 *     "ERROR: Could not find dependency" → failed to run linuxdeploy，
 *     deb/rpm 已成功仍让整个 Linux job 失败（v0.18.19 起持续复现）。
 *   - pi-tui 的 native/<os>/prebuilds/<triple> 带全平台二进制，异架构 ELF
 *     同样是雷。
 *   - 运行时只会加载与本机 platform/arch/libc 匹配的那一份，其余纯属累赘。
 *
 * 只删"明确不属于本机"的条目，认不出来的目录一律保留（宁可留冗余，
 * 不能把本机真正要用的二进制删掉）。
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";

/** 当前进程是否跑在 musl libc 上（alpine 等）。 */
export function detectMusl(platform = process.platform) {
  if (platform !== "linux") return false;
  const report = process.report.getReport();
  return !report?.header?.glibcVersionRuntime;
}

/**
 * @param {object}  opts
 * @param {string}  opts.backendDir  随包后端根（含 node_modules）
 * @param {string} [opts.platform]   目标平台，默认本机
 * @param {string} [opts.arch]       目标架构，默认本机
 * @param {boolean}[opts.isMusl]     目标 libc 是否 musl，默认按本机探测
 * @returns {string[]} 被删除的相对路径
 */
export function pruneForeignNativePackages({
  backendDir,
  platform = process.platform,
  arch = process.arch,
  isMusl = detectMusl(platform),
} = {}) {
  const removed = [];
  const rm = (dir) => {
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir.replace(backendDir + sep, ""));
  };
  const nm = join(backendDir, "node_modules");

  // sharp 的平台前缀：linux 要区分 gnu/musl，其余平台即平台名
  const flavor = platform === "linux" ? (isMusl ? "linuxmusl" : "linux") : platform;

  // 1) @img/*：保留 colour、wasm 兜底与本机变体
  const imgDir = join(nm, "@img");
  if (existsSync(imgDir)) {
    const keep = new Set([
      "colour",
      "sharp-wasm32",
      `sharp-${flavor}-${arch}`,
      `sharp-libvips-${flavor}-${arch}`,
    ]);
    for (const entry of readdirSync(imgDir)) {
      if (!keep.has(entry)) rm(join(imgDir, entry));
    }
  }

  // 2) @next/swc-*：只留本机 triple（linux 区分 gnu/musl）。
  //    仅识别 swc-<已知平台>-… 形态，避免误删 swc-env 这类非平台包。
  const nextDir = join(nm, "@next");
  if (existsSync(nextDir)) {
    const abi = platform === "linux" ? (isMusl ? "-musl" : "-gnu") : "";
    const keep = `swc-${platform}-${arch}${abi}`;
    const platformPrefixes = ["darwin", "linux", "linuxmusl", "win32", "freebsd"];
    for (const entry of readdirSync(nextDir)) {
      if (!entry.startsWith("swc-")) continue;
      const rest = entry.slice(4);
      const isPlatformPkg = platformPrefixes.some((p) => rest.startsWith(p + "-"));
      if (isPlatformPkg && entry !== keep) rm(join(nextDir, entry));
    }
  }

  // 3) 任意包内 native/<os>/prebuilds/<os>-<arch> 布局：只留本机组合
  //    （覆盖 pi-tui 等自带全平台 prebuilds 的包，不写死包名）。
  //    跨架构保留：macOS 的 x64 dmg 在 arm64 runner 上构建，整个 runner
  //    就是"本机"，删掉 prebuilds/darwin-x64 会直接废掉 x64 包——所以
  //    只有 Linux（linuxdeploy 会逐个解析 ELF，异架构/异 libc 必炸且
  //    runner 即目标架构）才在 OS 目录内继续按 triple 精删。
  const pruneTriples = platform === "linux";
  const prebuildRoots = findPrebuildRoots(nm);
  for (const root of prebuildRoots) {
    let osEntries;
    try {
      osEntries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const osEntry of osEntries) {
      if (!osEntry.isDirectory()) continue;
      const osPath = join(root, osEntry.name);
      if (osEntry.name !== platform) {
        rm(osPath);
        continue;
      }
      const prebuilds = join(osPath, "prebuilds");
      if (!existsSync(prebuilds) || !pruneTriples) continue;
      for (const triple of readdirSync(prebuilds)) {
        if (triple !== `${platform}-${arch}`) rm(join(prebuilds, triple));
      }
    }
  }

  return removed;
}

/** 找出 node_modules 下所有 <pkg>/native 目录（含嵌套）。 */
function findPrebuildRoots(nmDir, depth = 0) {
  const found = [];
  if (depth > 3 || !existsSync(nmDir)) return found;
  let entries;
  try {
    entries = readdirSync(nmDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".package-lock.json") continue;
    const p = join(nmDir, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      found.push(...findPrebuildRoots(p, depth + 1));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const nativeDir = join(p, "native");
    if (existsSync(nativeDir)) found.push(nativeDir);
    const nested = join(p, "node_modules");
    if (existsSync(nested)) found.push(...findPrebuildRoots(nested, depth + 1));
  }
  return found;
}
