#!/usr/bin/env node
// 一键重打 Mistral conversations 补丁（npm 重装 / pi-ai 升级后补丁会丢，重跑本脚本）。
// 需要修补 4 处 pi-ai 模块：
//   顶层 pi-ai（测试路由用）+ pi-coding-agent 嵌套 pi-ai（真实 agent 用）
//   × repo 与全局 npm 包 两处
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = "/Volumes/1T 原装/项目研发/pi-web-QT";
const NPMDIR = "/Users/qingtang/.fnm/node-versions/v24.18.0/installation/lib/node_modules/@qt4798/pi-web";
const PATCH = (f) => `${ROOT}/scripts/patches/${f}`;

const targets = [
  `${ROOT}/node_modules/@earendil-works/pi-ai/dist/api/mistral-conversations.js`,
  `${ROOT}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/mistral-conversations.js`,
  `${NPMDIR}/node_modules/@earendil-works/pi-ai/dist/api/mistral-conversations.js`,
  `${NPMDIR}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/mistral-conversations.js`,
];

let ok = 0;
for (const t of targets) {
  if (!existsSync(t)) {
    console.log("SKIP（不存在）:", t);
    continue;
  }
  execFileSync("node", [PATCH("patch-mistral-conversations.mjs"), t], { stdio: "inherit" });
  execFileSync("node", [PATCH("extend-mistral-tools.mjs"), t], { stdio: "inherit" });
  execFileSync("node", ["--check", t], { stdio: "inherit" });
  ok += 1;
  console.log("OK:", t, "\n");
}
console.log(`已补丁 ${ok} 处模块。注意：30141 需用户重启后才生效。`);
