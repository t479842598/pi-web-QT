# Changelog

## 0.9.10 — 2026-08-05

### 关键修复
- **修复 npm 安装后启动崩溃** — 0.9.9 发布时误用了 Turbopack 构建产物，Turbopack 将 `serverExternalPackages` 中的 undici 映射为 `undici-<hash>` 虚拟模块名，导致 `next start` 时找不到该模块（`Cannot find module 'undici-43b6dae3674542ed'`）。本次重新用 `npm run build`（`env -u TURBOPACK next build --webpack`）构建，undici 引用恢复为正常的 `require("undici")`。

## 0.9.9 — 2026-08-05

### 安全修复
- **Reasonix 导入路径穿越** — 拒绝包含 `..` 或 `%2e%2e` 等路径穿越字符的项目名，防止写入 sessions 目录之外的文件。
- **PI_SESSIONS_DIR 对齐** — 会话目录推导改用 `getAgentDir()`，与 pi agent 内部逻辑保持一致。

## 0.9.7 — 2026-08-05

### 安全修复
- **undici 升级 8.5.0 → 8.10.0** — 修复 7 个已知漏洞（含 GHSA-4cwx-7wf7-3272 Cache-Control 跨用户信息泄露、GHSA-jr45-8vmc-qm54、GHSA-8xcm-r25x-g524 等）。`@earendil-works/pi-coding-agent` 内置 `npm-shrinkwrap.json` 将 undici 锁死在 8.5.0（npm overrides 无法穿透），新增 `postinstall` 脚本（`bin/fix-pi-agent-undici.js`）自动移除 shrinkwrap 并将嵌套 undici 替换为指向安全版本的链接；`package.json` 同时保留 undici overrides 双保险。

### 备份与文件上传修复
- **备份导入 413 修复** — 大备份文件上传报 `413 Payload Too Large / Failed to parse body as FormData`：multipart 解析改为 Next.js 原生 `request.formData()`，不再手动重组 stream 后重建 Response 解析；大小上限（512MB）改为解析后校验，超限返回明确提示。
- **文件上传同样修复** — `/api/files` 上传改用原生 `formData()` 解析，原有的单文件 25MB / 总量 100MB 限制不变。

### 文档
- **更新说明** — README 与部署文档新增 npm 全局安装的更新命令（`npm update -g @qt4798/pi-web`）。

<details>
<summary><strong>更早版本</strong></summary>

## 0.9.6 — 2026-08-05

### 会话导入
- **Reasonix 导入** — 设置弹窗新增「导入会话」标签页：自动发现 `~/.reasonix/projects/` 下的项目与历史会话，支持按项目勾选、批量导入为 pi 会话文件；导入完成后可选调用模型生成会话标题。
- **导入模式** — 支持「合并到现有项目」与「新建项目」两种模式；合并模式下自动匹配已存在的同名 pi 项目目录。
- **导入来源标记** — 导入的会话在列表中以 `↓ 来自 Reasonix` 标签标识来源。

### Windows 兼容性修复
- **项目选择器可见性** — 修复全新安装（无历史会话）时，侧栏项目选择器在标题栏挂载后消失的问题；现在未选项目时侧栏始终显示内联项目选择器，确保用户能找到入口。
- **路径大小写处理** — `displayCwd`（`~` 缩写）与 `isQuickWorkspace`（快捷工作区识别）改为大小写不敏感比较，适配 Windows 文件系统特性。
- **CRLF 行尾兼容** — Reasonix 会话导入与 pi 会话文件解析统一处理 CRLF 行尾（`\r\n`），避免 JSONL 解析失败。
- **Windows 权限调用防护** — `chmodSync` 调用（`provider-credential-store`、`model-discovery-auth`）增加 try-catch 容错，Windows 上静默忽略。
- **Windows 路径推导** — 会话导入时 cwd 回退推导逻辑改为检测盘符模式（如 `C-Users-...` → `C:\Users\...`），避免错误生成 Unix 风格路径。

## 0.9.5 — 2026-08-04

### 备份与恢复
- **跨平台备份恢复** — 设置弹窗新增「备份」标签页：一键导出核心配置、技能、插件、MCP 服务器与会话（可选含 API 密钥）为 pi-backup zip；导入时按平台自动适配路径与 MCP 命令（Windows 的 bash 脚本转为 cmd），支持勾选恢复类别与跳过指定 MCP 服务器。
- **安全加固** — zip 解压增加单条目/总量双重上限（512 MiB / 1 GiB）并按实际字节校验，防止解压炸弹；恢复的 bin 脚本仅接受白名单 shebang；local-packages 名称校验防止路径穿越；npm 插件包改为预览列出、默认不自动重装（opt-in，避免执行不可信安装脚本）。

### 会话管理
- **自动生成会话标题** — 会话列表悬停操作区新增“生成标题”按钮（重命名左侧），基于会话内容调用模型生成简洁标题并直接写入会话名称；无消息的会话禁用，生成期间显示加载态。
- **标题模型设置** — 设置弹窗新增标题生成模型选择，默认沿用会话模型，可全局指定其它模型。

### 模型配置
- **内置模型覆盖** — 模型配置中可查看供应商内置模型明细（上下文窗口、最大输出、思考等级映射），并叠加 models.json 中的自定义覆盖项，便于核对与调整。

### 安全审查修复
- **API 鉴权补齐** — auto-name、settings/title-model、models-config（GET/PUT）、models-config/builtin 路由统一接入 `isApiRequestAllowed`，封堵跨站触发 LLM 调用、读取含 API 密钥的 models.json 等路径。
- **备份导入缓冲** — 预览 token 30 分钟过期 + 缓冲区 16 条硬上限（逐出最旧），防内存常驻 DoS。

### 安装体验
- **依赖解析** — package.json 增加 `overrides`（`@emoji-mart/react` 的 react peer 对齐到本项目 react 19）与 `allowScripts`（sharp/protobufjs/@google/genai/unrs-resolver），消除 npm 11 安装时的 ERESOLVE 与 allow-scripts 提示。

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

<details>
<summary><strong>更早版本</strong></summary>

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

</details>

