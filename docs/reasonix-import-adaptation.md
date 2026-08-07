# Reasonix 会话导入适配记录

> 记录时间：2026-08-07。用途：本地 fork（@qt4798/pi-web）对 Reasonix 会话导入的完整适配方案，
> 供覆盖回线上版本（qt/beta = v0.9.17-beta.3）后重新适配时参考。完整恢复点：
> `git branch backup/pre-reset-20260807`（含未提交的 APPDATA 补丁）。

## 背景

- 官方上游 `origin/main`（agegr/pi-web, v0.8.7）**没有**导入功能（`lib/import-sources.ts` 在上游不存在）。
- 导入功能完全由本 fork 自 v0.9.6 起自行实现。

## 功能组成（涉及文件）

| 文件 | 职责 |
|---|---|
| `lib/import-sources.ts` | 导入源发现：跨平台路径解析 + 项目/会话扫描 |
| `lib/import-reasonix.ts` | Reasonix 会话解析/转换（`parseReasonixFilename` 容错 fallbackTimestamp、`convertReasonixFile` 传文件 mtime） |
| `lib/import-executor.ts` | 导入执行（平铺项目 cwd 回退 `homedir()`） |
| `app/api/import/discover/route.ts` | GET 发现可导入项目 |
| `app/api/import/execute/route.ts` | POST 执行导入 |
| `app/api/import/status/route.ts` | 导入状态查询 |
| `components/ImportSessionsConfig.tsx` | 设置弹窗「导入会话」标签页 UI（按项目勾选、批量导入、导入后生成标题） |
| `lib/i18n/messages/{zh-CN,en}.ts` | 文案 |
| `components/AppShell.tsx` / `SessionSidebar.tsx` | 入口 + 「↓ 来自 Reasonix」来源标记 |

## 适配历史（git commits）

1. **2254b94** `feat(import,win)` — 基础功能：发现 `~/.reasonix/projects/<p>/sessions/*.jsonl`（mac 布局）、按项目勾选批量导入为 pi 会话文件、可选合并或新建项目、导入后调模型生成标题；顺带修复 Windows 全新安装项目选择器消失、路径大小写敏感问题。
2. **083a47e** `fix(win)` — CRLF 行尾兼容、`chmodSync` 守卫、Windows cwd 推导。
3. **7586f72** `fix(import)` — 会话导入目录改用 `getAgentDir()`，尊重 `PI_CODING_AGENT_DIR`。
4. **d8c3832** v0.9.8 — 备份导入 413（10MB body 截断）、内置模型保存、reasonix 导入、项目选择器修复。
5. **f91cd41** v0.9.9 安全修复 — 拒绝 `..` / `%2e%2e` 路径穿越的项目名；`PI_SESSIONS_DIR` 与 `getAgentDir()` 对齐。
6. **2ca580d** — 导入会话自动生成标题 500 修复：导入转换时 `JSON.stringify(undefined)` 会生成缺 `text` 字段的消息块（`{"type":"text"}`），LLM 序列化崩溃；导入兜底 + 标题生成两条链路同时修复，历史坏文件也能生成标题。
7. **2026-08-05 平铺布局支持**（见 progress.md）— Windows/CLI 布局 `~/.reasonix/sessions/*.jsonl` 此前不被识别（仅支持 mac 的 projects 布局），导致 UI 上 reasonix 选项 unavailable。`lib/import-sources.ts` 新增 `reasonixSessionsFlatDir()`、平铺发现（按文件名前缀分组）、统一 `reasonixProjectSessions()`；`parseReasonixFilename` 对非 mac 命名容错（回退文件 mtime，provider/modelId=unknown）；平铺项目 cwd 回退 homedir。

## 当前未提交适配（APPDATA 补丁，备份分支中）

Windows 桌面版 Reasonix v1.x（Go/Wails）数据目录在 `%APPDATA%\reasonix\`，旧版 Tauri/CLI/macOS 用 `~/.reasonix\`。改动集中在 `lib/import-sources.ts`：

- 新增 `reasonixHomeDirs()`：返回去重候选 `[%APPDATA%/reasonix, ~/.reasonix]`。
- `reasonixProjectsDir()` / `reasonixSessionsFlatDir()`：返回**第一个存在**的候选，否则默认首个候选。
- `reasonixProjectSessions()` / `discoverReasonix()`：**遍历所有候选根目录**（projects 布局 + 平铺布局），跨根去重（`seen` 集合），平铺按文件名前缀（第一个 `-` 前）分组。

重放脚本：`patch_import_sources.py`（对 `reasonixProjectSessions` / `discoverReasonix` 两函数做精确替换，兼容 CRLF）。适配后 `discover` 在 Windows 下实测 available=true（43 会话）。

## 验证方法

- `node_modules/.bin/tsc --noEmit`
- GET `/api/import/discover` → reasonix `available: true`
- 单文件导入 + 标题生成（注意 2ca580d 的缺 text 字段兜底）
