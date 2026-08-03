<div align="center">

# 🍜 Pi Web (pi-web-QT)

**pi 编程智能体（[pi-mono](https://github.com/badlogic/pi-mono)）的本地桌面网页界面**

读取本机 pi 会话文件，提供会话管理、实时对话、模型配置、技能管理与项目文件预览，支持浏览器与 Electron 桌面端双模式。

[English](./README.en.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

![Version](https://img.shields.io/badge/version-0.9.1-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

</div>

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 💬 **实时对话** | 与 pi 智能体多轮对话，SSE 流式输出、输入快捷键（Enter / Ctrl+Enter）可配 |
| 🧩 **多步骤过程分组** | 工具调用按语义自动合并为步骤组，时间线 / 标签页双模式、文件标签、错误高亮、流式摘要 |
| 📂 **项目文件浏览** | 侧栏文件树 + 右侧源码 / diff / 图片 / 音频 / PDF / DOCX 预览 |
| 🌿 **会话分支与 Fork** | 从任意消息继续分支或 Fork 独立会话，侧栏树形展示 |
| 🧠 **多模型配置** | 可视化编辑 `~/.pi/agent/models.json`，OAuth / API Key 登录、模型连通性测试 |
| 🛠 **技能与插件管理** | 技能搜索 / 安装 / 启停，package 插件管理 |
| 📊 **用量统计** | token 用量、费用、上下文使用率 donut 图表、会话信息条 |
| 🎨 **多主题** | Gruvbox 默认 + 6 套内置主题，亮 / 暗双模式，PI-TUI 主题 JSON 兼容（`~/.pi/agent/themes/`） |
| 📦 **Electron 桌面端** | 三平台打包（macOS dmg / Windows exe / Linux AppImage），首次运行设置向导 |
| 🧵 **Git Worktree** | 从侧栏切换 / 创建 worktree，会话与文件树跟随分支 |
| ⏳ **队列持久化** | 会话中断后队列自动恢复，可视化管理待处理消息 |
| 🌐 **i18n** | 中文 / English / 日本語 / Русский 界面语言切换 |

## 🧰 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | [Next.js 16](https://nextjs.org)（App Router）+ React 19 |
| 样式 | Tailwind CSS 4 + CSS 变量主题系统 |
| AI 引擎 | [@earendil-works/pi-coding-agent](https://github.com/badlogic/pi-mono)（进程内 AgentSession） |
| 桌面壳 | Electron 43 + electron-builder（三平台打包） |
| 图标 | @phosphor-icons/react |
| 语言 | TypeScript 5（strict） |

## 🔧 分支说明

本分支基于 [agegr/pi-web](https://github.com/agegr/pi-web) **v0.8.6**，合并了一系列体验修复与增强（滚动行为、移动端可用性、数学公式/Mermaid 渲染、文件处理、队列持久化、用量统计、引用回复等），并新增 **Gruvbox 主题**、**Electron 桌面端** 支持，以及从 [pi-web-desktop](https://github.com/isWittHere/pi-web-desktop) v0.7.16 移植的桌面 UI/UX 增强（多步骤过程分组、统一设置弹窗、会话信息条、PI-TUI 主题 JSON 兼容，详见 [CHANGELOG](./CHANGELOG.md)）。

## 快速开始

### 命令行模式

Pi Web 要求 Node.js 22.19.0 或更高版本。可通过 `node --version` 检查当前版本。

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。Pi Web 默认仅监听 `127.0.0.1`。

**外网访问（带密码保护）：**

```bash
PI_WEB_PASSWORD='你的密码' PI_WEB_ALLOWED_HOSTS='your-domain.com' pi-web -H 0.0.0.0 -p 30141
```

### 桌面端模式（macOS / Windows / Linux）

**从 GitHub Releases 下载**
前往 [Releases](https://github.com/t479842598/pi-web-QT/releases) 下载对应平台的安装包。

**GitHub Actions 自动打包**：推送 `v*` 标签触发三平台构建，产物自动发布到 Release。也可在 Actions 页面手动触发。

**本地打包：**

```bash
npm install
npm run build              # 构建 Next.js 产物
npm run build:desktop      # 打包为 macOS .dmg / Windows .exe / Linux AppImage
```

**开发模式（不打包）：**

```bash
npm run desktop
```

**首次启动**会弹出设置窗口，填写访问密码、允许域名和端口。配置保存在 `~/.pi/agent/pi-web-desktop.json`，后续启动直接载入。

桌面端和命令行模式共享同一 `~/.pi/agent/` 数据目录，对话历史、项目配置完全互通——无需迁移。

打包产物：
- macOS: `release/Pi Web-<version>.dmg`
- Windows: `release/Pi Web Setup <version>.exe`
- Linux: `release/Pi Web-<version>.AppImage`

## 主题

本分支使用 **Gruvbox** 配色，支持亮色/暗色自动切换（跟随系统或手动切换）。

| 模式 | 底色 | 文字色 | 强调色 |
|------|------|--------|--------|
| 亮色 | `#fbf1c7` | `#3c3836` | `#458588` |
| 暗色 | `#1d2021` | `#ebdbb2` | `#83a598` |

颜色变量定义在 `app/globals.css`，可通过 CSS 变量自行覆盖。

## UI 增强（v0.9.1）

- **多步骤过程分组** — 工具调用按语义自动合并为步骤组，支持时间线 / 标签页双显示模式，文件目标标签、错误高亮、流式摘要。
- **统一设置弹窗** — 顶栏齿轮按钮打开设置中心，包含「聊天」「显示」标签页（输入快捷键、主题、语言）。
- **会话信息条** — ChatInput 下方展示提示音、完整历史、分支、系统提示、上下文压缩、token 用量与上下文 donut 图表。
- **PI-TUI 主题 JSON 兼容** — 将 `-dark.json` / `-light.json` 主题文件放入 `~/.pi/agent/themes/`，即可在设置中选用。

## 完整命令行参数

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 在可信网络中开放访问
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式开放网络访问
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # 允许指定的代理或自定义主机名
PI_WEB_PASSWORD='足够长的随机密码' pi-web  # 启用 Basic Auth（用户名固定为 pi）
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

设置 `PI_WEB_PASSWORD` 后，网页和所有 API 端点都会启用 HTTP Basic Auth，用户名固定为 `pi`。未设置或设置为空值时不启用认证。

Pi Web 可以调用高权限智能体。Basic Auth 不会加密传输中的密码，因此不要把明文 HTTP 暴露到互联网。远程访问时应使用可信反向代理提供 HTTPS，或通过可信 VPN 访问。
API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PI_WEB_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

## HTTP 代理

Pi Web 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 功能特性

- **随时接续工作**：按项目浏览历史对话，无需翻找终端历史或会话路径。
- **安全尝试不同方向**：从较早的消息继续，或把会话 fork 成独立分支。
- **跨分支工作**：从侧栏切换 Git worktree，新会话和资源管理器跟随所选分支。
- **边聊天边看代码**：左侧浏览文件，右侧预览源码、文档、图片、音频和 PDF，同时 Agent 持续工作。
- **会话状态一目了然**：顶栏显示上下文用量、费用、压缩状态和系统提示详情。
- **少用终端做配置**：在网页里管理模型、登录/API Key、模型测试和技能开关。
- **界面语言可切换**：顶栏在支持的 UI 语言之间切换。
- **桌面端原生体验**：独立窗口、Dock 图标、系统通知、首次配置引导。
- **Gruvbox 双模式主题**：亮色/暗色自动跟随系统，平滑过渡动画。

## 运行模式对比

| 特性 | 命令行 `pi-web` | 桌面端 `.app` |
|------|:---:|:---:|
| 端口/密码/域名 | 环境变量或 CLI 参数 | 首次设置界面 |
| 配置持久化 | `~/.pi/agent/` | `~/.pi/agent/pi-web-desktop.json` |
| 自动启动 | 需自行配置 | ✅ 双击即用 |
| 对话数据 | 共享 | 共享 |
| 系统托盘 | ❌ | 未来支持 |
| 自动更新 | ❌ | 未来支持 |

## 本分支的改动

基于上游 `agegr/pi-web` v0.8.6，以下修复与增强已合并并在本地验证：

### 主题与桌面端

- **Gruvbox 主题** — 使用 gruvbox 经典配色替换默认主题，`app/globals.css` 中 `:root`（亮色）和 `html.dark`（暗色）变量全覆盖，font-mono 去重合并。
- **Electron 桌面端** — `electron/main.js` 主进程 + `electron/setup.html` 设置界面 + `electron/preload.js` 安全桥接。首次运行弹设置窗，配置保存到 `~/.pi/agent/pi-web-desktop.json`。macOS 支持 Dock 激活恢复窗口。打包为 `.dmg` / `.exe` / `.AppImage`。

### 核心体验修复

- **修复对话底部空白问题** — Agent 运行期间消息列表底部原本插入的整屏高度空白占位块，改为固定 52px（输入框高度）。滚到底部现在落在真正的最后一条消息上，而不是一整屏空白。
- **流式输出随屏滚动** — Agent 流式输出时，只有当你已处于底部附近（150px 内）才自动跟随滚动；如果你上滑阅读历史，视图保持不动，不会被强制拉回底部。
- **修复移动端输入放大** — iOS Safari 会对字号小于 16px 的输入框聚焦时自动放大页面。聊天输入框在移动端改为 16px，并在 `@media (max-width: 640px)` 下对所有 `input`/`textarea`/`select` 强制 16px 兜底。

### 消息与 Markdown 渲染

- **斜杠命令 / 技能消息折叠** — `/skill:name` 和模板消息被 pi 展开成完整技能说明后，现在以紧凑的命令 chip（命令名 + 你输入的参数）展示，展开后的正文默认隐藏、可点击展开。`lib/slash-display.ts` 在实时 SSE 事件和历史会话加载中都能反向匹配技能展开，且不改写 SDK 共享的消息对象。
- **修复 `$$...$$` 公式吞掉后续文字** — `normalizeDisplayMath` 让公式内容行与 `$$` 围栏保持同级缩进，嵌套在列表项里或与正文粘连的公式现在能正确解析（remark-math "lazy continuation" 防护）。
- **聊天缩略图大纲渲染数学公式** — 含 KaTeX 公式的标题不再在大纲里显示原始 LaTeX。
- **Mermaid 图表支持缩放与平移** — mermaid 代码块默认渲染为可交互预览；新增的 `ZoomPanViewer` 支持放大/缩小、拖拽平移、文本选择模式和完全重置，桌面端与移动端均可用。

### 文件处理

- **AI 生成的本地文件链接可操作** — 助手消息里的本地文件路径渲染为带文件类型图标的可点击链接，点击可下载或打开。支持相对路径、Windows 路径、`file:///` URL、中文文件名以及 `path:line` 行号引用。
- **任意文件可拖入聊天输入框** — 之前只支持拖入图片（其他文件静默无反应）。现在任意文件拖入聊天输入框都会插入该文件的路径/`@` 引用。
- **文件查看器统一 @mention 按钮** — 工具栏新增一个 @ 提及按钮：源码模式下选中行时插入行范围引用（`@path#Lstart-Lend`），否则插入整文件引用。

### 队列与会话可靠性

- **排队消息重启不丢失** — steer/follow-up 队列（pi 仅保存在内存中）现在镜像到每会话旁车文件（`<session>.jsonl.queue.json`，原子写入）。服务器重启后，遗留条目会在恢复对话框中呈现，由你决定重新入队、丢弃或导出——绝不自动投递。
- **队列管理与导出** — 排队消息横幅新增导出（Markdown/JSON）和导入，`QueueRecoveryDialog` 用于审查待恢复条目；同时支持流式模型切换和压缩操作。

### 统计与效率

- **按模型统计 token 用量与费用** — 跨会话聚合 token 用量和估算费用，按模型细分，可从侧栏查看。回答"本周/本月各模型花了多少"（`app/api/usage/route.ts` + `lib/usage-store.ts` + `components/UsageStats.tsx`）。
- **引用回复浮层** — 悬停（桌面）或点击（移动端）任意助手段落、列表项或表格行，弹出引用回复浮层。封闭式问题提供快捷答案按钮（是/否、A/B），任意块都可通过"引用回复"按钮填入 `> 引用` 到输入框（不自动发送——由你选择 prompt / steer / followUp）。

## 说明

- **数据目录**：Pi Web 默认读取 `~/.pi/agent/sessions`。设置 `PI_CODING_AGENT_DIR` 可指向其他 pi agent 目录。
- **会话文件**：文件存储为 `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`。
- **模型配置**：模型面板读写 pi agent 目录下的 `models.json`。模型列表和默认值来自 pi 的配置。
- **文件访问**：文件浏览与预览限定在所选项目目录以及会话中出现的工作目录内。
- **Git worktree**：参见 [Worktrees in Pi Web](./docs/worktrees.md) 了解切换器的出现时机、新 worktree 的创建与删除。
- **Fork 与会话内分支**：Fork 会创建新的 `.jsonl` 文件；"从此处编辑"会在同一会话文件内创建另一分支。
- **国际化**：参见 [Internationalization](./docs/i18n.md) 了解翻译的使用与语言添加方式。

## 开发

```bash
npm install
npm run dev
```

本地开发服务器运行在 [http://127.0.0.1:30141](http://127.0.0.1:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

本地开发时避免运行 `next build` / `npm run build`——它会写入 `.next/` 并可能干扰开发服务器；构建留给发布流程。

## 项目结构

```text
app/
  api/
    agent/          # 创建/驱动 AgentSession 并暴露 SSE 事件
    auth/           # OAuth 与 API Key 管理
    cwd/browse/     # 可浏览的服务器目录列表
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # pi 默认工作目录查询
    files/          # 文件列表、读取、预览与监听
    home/           # 当前用户主目录
    models/         # 可用模型、默认模型、思考级别
    models-config/  # 读写 models.json 并测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # 技能列表、搜索、安装、启停
    usage/          # 按模型的 token 用量与费用聚合
components/
  AppShell.tsx        # 主布局、URL 状态、顶栏、文件标签
  SessionSidebar.tsx  # 项目选择器、会话树、资源管理器
  DirectoryPicker.tsx # 可浏览、可编辑的工作目录选择器
  ChatWindow.tsx      # 消息、SSE、图片拖放、缩略图
  ChatInput.tsx       # 输入栏、模型/工具/思考/压缩/斜杠控制
  MessageView.tsx     # 消息、思考、工具调用/结果渲染
  ModelsConfig.tsx    # 模型与认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
  UsageStats.tsx      # 按模型用量/费用统计面板
  QueueRecoveryDialog.tsx # 排队消息恢复/导出/导入对话框
  QuoteReplyPopover.tsx   # 助手消息上的引用回复浮层
  ZoomPanViewer.tsx       # 缩放/平移查看器（Mermaid 预览）
electron/
  main.js            # Electron 主进程：设置窗、Next.js 启动、窗口管理
  preload.js         # contextBridge 安全桥接（piDesktop API）
  setup.html         # 首次运行设置界面（密码、域名、端口）
lib/
  directory-browser.ts # 目录归一化与安全列出辅助函数
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期与全局注册表
  session-reader.ts   # 解析 .jsonl 会话文件与分支上下文
  normalize.ts        # 归一化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 路径编码与相对路径辅助函数
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
  slash-display.ts    # 斜杠命令/技能展开反向匹配
  queue-store.ts      # 持久化队列旁车文件（保存/恢复 steer 与 follow-up）
  queue-export.ts     # 队列导出（Markdown/JSON）与导入解析
  usage-store.ts      # 按模型 token 用量与费用存储
  quote-reply.ts      # 引用回复解析/格式化辅助函数
  dropped-files.ts    # 拖放文件的路径/引用辅助函数
hooks/
  useAgentSession.ts  # 会话加载、命令发送、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片/文件拖放
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
