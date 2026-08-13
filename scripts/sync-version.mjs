#!/usr/bin/env node
/**
 * 版本号同步：读取 web 端 package.json 的 version，统一写入：
 *   - desktop/tauri.conf.json   （桌面端）
 *   - mobile/pubspec.yaml       （Flutter 旧版，pi-web）
 *   - mobile2/pubspec.yaml      （Flutter 新版，pi-web-new）
 * 用法：node scripts/sync-version.mjs
 * 发版流程：先 bump web 版本号，再跑本脚本，三端版本号即同步。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rawVersion = pkg.version;
if (!/^\d+\.\d+\.\d+/.test(rawVersion)) {
  console.error(`[sync-version] package.json 版本号异常: ${rawVersion}`);
  process.exit(1);
}
// 只取 x.y.z 主体：iOS CFBundleShortVersionString / tauri updater 要求纯数字段
const version = rawVersion.match(/^\d+\.\d+\.\d+/)[0];

// 1. desktop/tauri.conf.json
const confPath = join(root, "desktop", "tauri.conf.json");
if (existsSync(confPath)) {
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  conf.version = version;
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
  console.log(`[sync-version] desktop/tauri.conf.json -> ${version}`);
}

// 2. mobile/pubspec.yaml + mobile2/pubspec.yaml（Flutter 版本号 x.y.z+<build>）
for (const dir of ["mobile", "mobile2"]) {
  const pubspecPath = join(root, dir, "pubspec.yaml");
  if (!existsSync(pubspecPath)) continue;
  let s = readFileSync(pubspecPath, "utf8");
  if (/^version: .+$/m.test(s)) {
    s = s.replace(/^version: .+$/m, `version: ${version}+0`);
    writeFileSync(pubspecPath, s);
    console.log(`[sync-version] ${dir}/pubspec.yaml -> ${version}+0`);
  }
}
