# Pi Web (pi-web-QT)

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览。

本分支基于 [agegr/pi-web](https://github.com/agegr/pi-web) **v0.8.6**，合并了一系列体验修复与增强（滚动行为、移动端可用性、数学公式/Mermaid 渲染、文件处理、队列持久化、用量统计、引用回复等）。完整清单见下文 [本分支的改动](#本分支的改动)。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

## 快速开始

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

**可选参数：**

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

## 本分支的改动

基于上游 `agegr/pi-web` v0.8.6，以下修复与增强已合并并在本地验证：

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
