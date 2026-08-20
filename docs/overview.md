# 交付总结 — 加载态修复 + 桌面端内置打包（即开即用）

> 日期：2026-08-19　团队：software-piweb（主理人·齐活林）

## 一、本次完成了什么（三项均已 QA 通过）

1. **修复前端加载状态 bug**（QA IS_PASS: YES）—— `hooks/useAgentSession.ts`
2. **桌面端技术选型方案**（已收敛为「仅打包后端」）—— `docs/desktop-runtime-selection.md`
3. **桌面壳「首次设密码 + 默认连本地 + 切换远程」+ M1 后端内置打包**（QA 两轮，最终 IS_PASS: YES）—— `desktop/` + `next.config.ts` + `bin/` + `scripts/`

## 二、加载态修复（hooks/useAgentSession.ts，5 处）

`state_sync`/`reconcileAgentState` 的 `setAgentPhase` 加 `if (!rpcPromptPendingRef.current)` 保护；`agent_end` 队列非空保留 `waiting_model`；三个排队处理器 `prev ?? waiting_model` 补位；deps 加 `queuedMessages`。tsc 通过，22/22 测试。

## 三、桌面端方案结论（docs/desktop-runtime-selection.md）

首选 **Tauri v2**（复用现有 desktop/ Rust 壳）+ Next.js `output:'standalone'` + 内置 Node 二进制；备选 Electron（自带 Node，后端内置更省事，但需重写整壳）。连接模型：本地固定 `0.0.0.0:30141`（对外/域名/Cloudflare 隧道可访问）+ 远程服务器列表 + 代理注入 Basic Auth。

## 四、桌面壳 + M1 实现（desktop/ 等）

- **首次设密码**：本地无密码 → 连接页进入设置密码步骤（≥6 位），不先拉起后端（避免无认证暴露）。
- **默认连本地**：设密后 `spawn_bundled` 拉起内置 `node server.js -H 0.0.0.0 -p 30141`（注入 PI_WEB_PASSWORD + 内存上限），经代理连本地，后端读 `~/.pi/agent` 恢复。
- **M1 内置打包**：`output:'standalone'` + `bundle.resources`（backend + node）+ `scripts/bundle-backend.mjs` + `bin/fix-pi-agent-undici.js` 构建期固化；缺失时回退本机 pi-web CLI。
- **残留修复**：改密后自动重启（`kill_child_tree` 杀进程组）；外部无认证后端检测（200→未认证告警）；CI 接入 bundle（node_dist 矩阵 + PI_WEB_NODE_BIN 跨架构）；排除 `.env*` 防密码泄漏。

验证：`cargo check` exit 0；`cargo test` 21 passed / 0 failed / 2 ignored；`next build` + `bundle:backend` 产出可独立启动的后端（401/200/200）。

## 五、后续事项 / 残留风险

1. `.next` 已被生产构建污染（`npm run dev` 前需重新 dev）。
2. `.app` 内 node 二进制未签名，需真机验证；macOS 签名/公证待补。
3. CI 内 `next build` 会跑两次（beforeBuildCommand + 显式步骤），仅耗时，可后续优化。
4. **安全**：真实 PI_WEB_PASSWORD 曾随 `.env` 进入构建产物，已剔除（bundle 排除 `.env*`、files 加 `!.next/standalone`）；建议轮换该密码。
