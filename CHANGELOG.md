# Changelog

## 0.9.2 — 2026-08-04

### 修复
- **对话滚动跟随** — 修复 agent 运行时消息列表跳到空白区域的问题：运行中的底部占位从整屏高度改为 96px，滚动定位改为回退占位高度、让最后一条消息落在视口底部；流式输出期间若用户停留在列表底部附近则自动跟随，滚到上方查看历史时不再被打断。
- **版本号统一** — package.json / package-lock.json 版本统一为 0.9.2（`next.config.ts` 注入 `NEXT_PUBLIC_APP_VERSION`，界面显示 `web v0.9.2`）。

## 0.9.4 — 2026-08-04

### 修复
- **SSE 事件合并** — `message_update` 事件每次携带完整累积消息，流式输出期间 O(n²) 带宽放大 ~100-250x，VPN/远程访问下尤其严重。events 路由新增 80ms 合并窗口，`message_update` 只保留最新一条定时发送，其他事件立即发送（先 flush 缓冲区）。传输量从 O(n²) 降为 O(n)。ref: [agegr/pi-web#375](https://github.com/agegr/pi-web/issues/375)

## Unreleased — 2026-08-04

### 会话管理
- **自动生成会话标题** — 会话列表悬停操作区新增“生成标题”按钮（重命名左侧），基于会话内容调用模型生成简洁标题并直接写入会话名称；无消息的会话禁用，生成期间显示加载态。

### 固定主题与移动端输入
- **QT 固定主题恢复** — 显示设置新增 Gruvbox、Nord、Tokyo Night、Solarized、One Dark、Dracula 与 Catppuccin 七套固定主题；每套均提供浅色/深色变量，并与 Pi JSON 自定义主题、跟随系统模式和边框可见度共存。
- **移动端聊天输入** — 在 `<=640px` 视口将输入框最小高度设为 52px；保留 16px 字号避免 iOS Safari 聚焦缩放，以较紧凑行高和字距缩小文字的视觉密度。

### Web-only 运行基线
- 统一为 `pi-web-desktop` 的网页界面与运行基线；移除 Electron 主进程、桌面端打包依赖、安装向导、PWA Service Worker 和 tag 驱动的三平台 Release 工作流。
- 保留浏览器部署路径；生产部署示例见 [`docs/deployment.md`](./docs/deployment.md)。

### 工作区与移动端
- **目录选择器** — 侧栏“选择文件夹”改为逐级浏览目录并确认当前目录，不再使用路径输入框。
- **窄屏名称** — 项目、Git 仓库与 Worktree 名称缩小并省略，避免横向滚动。
- **常显操作** — 移动端当前模型与发送按钮始终可见；思考、工具、压缩和提示音仍收纳在“更多控件”中。
- **稳定模型菜单** — 展开或收起供应商二级模型列表时，模型下拉面板保持固定高度，仅结果区滚动。

### 可靠性与渲染
- **生产资源** — 生产服务不再依赖 Turbopack 开发 chunk，避免旧开发资源与新页面混用。
- **Markdown 表格引用** — 表格行引用提示改为合法表格 DOM，避免 hydration 报错。
- **Route Handler 类型校验** — 新会话目录授权辅助函数移至 `lib/`，避免 Next.js Route Handler 因额外导出而无法通过类型校验。

## 0.9.1 — 2026-08-03

### UI/UX：多步骤过程分组（移植自 pi-web-desktop v0.7.16）
- **过程分组卡片** — 工具调用按语义自动分类合并为步骤组（读文件/编辑/搜索/命令执行/待办等），取代原先平铺的块状渲染。
- **双显示模式** — 时间线模式（步骤纵向展开）与标签页模式（横向步骤 tab）可一键切换，偏好持久化到 localStorage。
- **流式过程展示** — agent 运行期间实时聚合当前回合的工具步骤；文件目标标签、错误高亮、步骤耗时、智能摘要（"使用了 3 个工具 · 2 条思考"）一应俱全。

### UI/UX：统一设置弹窗
- **设置中心** — 顶栏新增齿轮按钮，打开统一设置弹窗，包含「聊天」「显示」两个标签页，后续可扩展。
- **聊天设置** — 输入快捷键（Enter / Ctrl+Enter 发送）开关。
- **显示设置** — 主题与自定义主题列表、亮/暗切换、界面语言（中文/English）切换。

### UI/UX：会话信息条
- ChatInput 下方新增会话信息条：完成提示音开关、查看完整历史、会话分支导航、系统提示词查看、上下文压缩、token 用量与上下文使用率 donut 图表。

### UI/UX：PI-TUI 主题 JSON 兼容
- 新增 `/api/theme-sets`：自动扫描 `~/.pi/agent/themes/` 下的 JSON 主题文件（支持 `-dark.json` / `-light.json` 后缀配对），显示设置中可直接选用。

### 其他
- 新增依赖 `@phosphor-icons/react`（图标库）。
- 完整迁移清单与验证见 `progress.md`。

## 0.9.0 — 2026-08-03

### 主题
- **Gruvbox 默认主题** — 亮/暗双模式，暖黄复古色系（`#fbf1c7` / `#1d2021`）。
- **多主题切换** — 顶栏新增调色板按钮，支持 7 套主题：Gruvbox、Nord、Tokyo Night、Solarized、One Dark、Dracula、Catppuccin；每套均有独立亮/暗模式。选择持久化到 localStorage。

### 桌面端（Electron）
- **独立桌面应用** — `electron/` 主进程 + 设置界面 + 安全 preload 桥接。
- **首次运行设置向导** — 图形化配置访问密码、允许域名、本地端口；配置保存于 `~/.pi/agent/pi-web-desktop.json`。
- **三平台打包** — electron-builder 产出 macOS `.dmg`、Windows `.exe`、Linux `.AppImage`；GitHub Actions 自动构建（`v*` tag 触发）。
- **macOS 原生体验** — Dock 激活恢复窗口、关闭窗口后台常驻。

### 构建与 CI
- **修复 Windows 构建失败** — `executableName` 去除 `@` 字符；图标改用 `public/icons/icon-512.png`（原 favicon.ico 不存在）。
- **修复 Windows next build EPERM** — `C:\Users\runneradmin\Cookies` 等 junction 目录不可读导致 outputFileTracing 崩溃；构建时将 `USERPROFILE`/`HOME` 指向干净目录。
- **修复 Release 403** — 显式声明 `contents: write` 权限；关闭 `generate_release_notes`（该 API 需 PAT）；electron-builder `--publish never` 避免双写冲突。

### 说明
- 主题偏好按设备保存在浏览器 localStorage；后续版本将支持跨设备同步。
- Electron 桌面端与命令行模式共享 `~/.pi/agent/` 数据目录，对话历史互通。
