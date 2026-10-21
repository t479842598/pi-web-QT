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

/** @img 下带平台名的包（sharp / sharp-libvips 共用）。 */
const IMG_PLATFORMS = ["darwin", "linux", "linuxmusl", "win32", "freebsd"];

/**
 * 结构化解析 @img 平台包名，两种命名都要认：
 *   sharp-<platform>-<arch>          （如 sharp-linuxmusl-x64）
 *   sharp-libvips-<platform>-<arch>  （如 sharp-libvips-darwin-arm64）
 * libvips 变体不以 "sharp-<platform>-" 开头，靠 startsWith 猜平台名会把它
 * 当成异平台删掉（v0.19.1 之后的跨架构加固引入的缺陷 D5）。
 *
 * @returns {{variant: "sharp"|"libvips", platform: string, arch: string}|null}
 *          认不出来返回 null（调用方按"宁可留冗余"保留）
 */
export function parseImgPlatformPackage(entry) {
  if (!entry.startsWith("sharp-")) return null;
  let rest = entry.slice("sharp-".length);
  let variant = "sharp";
  if (rest.startsWith("libvips-")) {
    variant = "libvips";
    rest = rest.slice("libvips-".length);
  }
  const platform = IMG_PLATFORMS.find((p) => rest.startsWith(p + "-"));
  if (!platform) return null;
  const arch = rest.slice(platform.length + 1);
  if (!arch) return null;
  return { variant, platform, arch };
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

  // 跨架构保留原则：只有 Linux 需要按 arch/libc 精确裁剪（linuxdeploy 会逐个
  // 解析 AppDir 内 ELF，异架构/异 libc 必炸，且 Linux runner 就是目标架构）。
  // macOS 的 x64 dmg 在 arm64 runner 上构建、Windows 也可能多架构，因此这两个
  // 平台只按"平台"裁剪，同平台的其它架构一律保留。
  const strictTriple = platform === "linux";
  // linux 的平台前缀要区分 gnu/musl，其余平台即平台名
  const flavor = strictTriple ? (isMusl ? "linuxmusl" : "linux") : platform;

  // 1) @img/*：保留 colour、wasm 兜底与本机平台变体
  const imgDir = join(nm, "@img");
  if (existsSync(imgDir)) {
    const keepExact = new Set([
      `sharp-${flavor}-${arch}`,
      `sharp-libvips-${flavor}-${arch}`,
    ]);
    for (const entry of readdirSync(imgDir)) {
      if (entry === "colour" || entry === "sharp-wasm32") continue;
      if (!entry.startsWith("sharp-")) continue; // 认不出来的一律保留
      if (strictTriple) {
        if (!keepExact.has(entry)) rm(join(imgDir, entry));
      } else {
        // 非 Linux：只按"平台"裁剪，同平台全部架构一律保留（macOS 的 x64 dmg
        // 在 arm64 runner 上构建）。平台名走结构化解析，覆盖
        // sharp-<platform>-<arch> 与 sharp-libvips-<platform>-<arch> 两种命名。
        const parsed = parseImgPlatformPackage(entry);
        if (parsed && parsed.platform !== platform) rm(join(imgDir, entry));
      }
    }
  }

  // 2) @next/swc-*：仅识别 swc-<已知平台>-… 形态，避免误删 swc-env 这类非平台包。
  const nextDir = join(nm, "@next");
  if (existsSync(nextDir)) {
    const abi = strictTriple ? (isMusl ? "-musl" : "-gnu") : "";
    const keepExact = `swc-${platform}-${arch}${abi}`;
    const platformPrefixes = ["darwin", "linux", "linuxmusl", "win32", "freebsd"];
    for (const entry of readdirSync(nextDir)) {
      if (!entry.startsWith("swc-")) continue;
      const rest = entry.slice(4);
      if (!platformPrefixes.some((p) => rest.startsWith(p + "-"))) continue;
      if (strictTriple) {
        if (entry !== keepExact) rm(join(nextDir, entry));
      } else if (!entry.startsWith(`swc-${platform}-`)) {
        rm(join(nextDir, entry));
      }
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
