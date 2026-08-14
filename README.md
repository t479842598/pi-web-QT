<div align="center">

# Pi Web

**Pi coding agent 的纯网页工作台**

读取本机 Pi 会话，提供实时对话、项目文件浏览、模型/技能/插件配置、Git Worktree 与移动端界面。该仓库只发布 Web 服务，不再提供 Electron 桌面应用或安装包。

[English](./README.en.md)

![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-green)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![License](https://img.shields.io/badge/license-MIT-yellow)

</div>

## 界面预览

![Pi Web 网页工作台](./docs/screenshots/web-workspace.png)

## 功能

| 能力 | 说明 |
| --- | --- |
| 实时对话 | 通过 SSE 显示 Pi Agent 的流式输出、工具调用、思考过程与错误状态。 |
| 会话管理 | 按项目查看会话，支持会话内分支、Fork、重命名、删除、AI 自动生成标题与 HTML 导出。 |
| 会话导入 | 从 Reasonix 等工具导入历史对话记录，自动发现项目与会话，支持合并或新建项目；导入后可选批量并行生成标题。 |
| 项目与文件 | 通过目录选择器加载项目，浏览文件、Diff、图片、音频、PDF、DOCX。 |
| 模型与认证 | 在网页中管理模型、OAuth/API Key、连通性测试和默认模型；支持从供应商自动获取模型列表与 models.dev 定价预设一键填入。 |
| 备份恢复 | 一键导出/导入核心配置、技能、插件、MCP 服务器与会话（可选含密钥），跨平台自动适配路径与命令。 |
| 技能与插件 | 查询、安装、启停 Skills 与 package 插件。 |
| Git Worktree | 在同一项目下创建、切换和移除 Worktree。 |
| 任务看板 | 桌面端四列看板：把任务交给 agent 在 worktree 分支中执行，支持验收、合并、归档、每项目设置（Beta）。 |
| 主题与语言 | 支持 Pi TUI 主题、亮暗模式及中文/English。 |
| 移动端 | 适配 Safari/Chrome 窄屏布局；模型选择和发送操作保持可见。 |

## 原生移动客户端

本仓库同时包含 Android / iOS 原生客户端（Flutter），位于 [`mobile2/`](./mobile2/)，支持：

- 连接自建 Pi Web（域名或 IP），可保存多台服务器并快速切换；
- 按远端工作目录浏览会话，会话内搜索与最近项目快捷切换；
- SSE 流式对话、思考过程（横向块状）、工具调用卡片、图片附件；
- 会话操作：重命名、置顶、删除、消息分叉（fork）；
- 主题：网页端主题集同步 + 全局字体大小调节；
- Git Worktree、MCP 服务器管理、模型供应商、技能；
- 宽屏（iPad / 折叠屏）自动切换常驻双栏布局；
- 简体中文 / 日本語 / English 三语界面。

安装与自建打包说明见 [`mobile2/README.md`](./mobile2/README.md)。发布时通过 GitHub Actions 在 tag 上自动产出 Android APK/AAB 与 iOS 未签名 IPA。

## 快速开始

### 前置条件

- Node.js **22.19.0 或更高版本**
- 已配置可用的 Pi 模型/认证信息

### 从 npm 安装（推荐）

```bash
npx @qt4798/pi-web@latest
```

或全局安装：

```bash
npm install -g @qt4798/pi-web
pi-web
```

然后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。CLI 会在服务就绪后自动打开浏览器。默认只监听 `127.0.0.1`。

### 更新

```bash
npm update -g @qt4798/pi-web
# 或指定版本
npm install -g @qt4798/pi-web@latest
```

更新后重启服务即可生效（先停掉旧进程再执行 `pi-web`）。

### 常用选项

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 暴露在局域网
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也可通过环境变量设置端口
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式设置监听地址
PI_WEB_ALLOWED_HOSTS=piweb.example.com pi-web  # 允许反向代理域名
PI_WEB_PASSWORD='随机长密码' pi-web           # 启用 HTTP Basic Auth（用户名 pi）
PI_WEB_NO_OPEN=1 pi-web         # 后台服务不自动打开浏览器
```

设置 `PI_WEB_PASSWORD` 后，所有网页接口和 API 端点都需要 HTTP Basic Auth 认证，用户名为 `pi`。不设或留空则禁用认证。

> Basic Auth 不加密传输中的密码。请勿将纯 HTTP 直接暴露到公网，通过可信反向代理启用 HTTPS 或使用可信 VPN 进行远程访问。

### 从源码运行

```bash
git clone https://github.com/t479842598/pi-web-QT.git
cd pi-web-QT
npm ci
npm run dev
```

`npm run dev` 使用**随机端口**（`-p 0`），启动日志会打印实际地址，如 `http://127.0.0.1:<随机端口>`。本地仓库构建仅作为测试环境；日常命令行运行请使用 npm 全局安装的 `@qt4798/pi-web`（`pi-web` 命令，固定 `http://127.0.0.1:30141`）。

开发服务器默认只监听本机。局域网调试可使用：

```bash
npm run dev:lan
```

## 安装提示（npm 11）

自 **v0.9.17-beta.3 起**，`ERESOLVE overriding peer dependency` 与 `deprecated intersection-observer` 两类提示已消除：供应商图标改为内置（不再依赖 `@lobehub/icons`，从而不再被 npm 自动安装 `@lobehub/ui` / `antd` / `@emoji-mart/react` 整条链）。新装本包时仅剩以下两类**提示性警告，均不影响安装与运行**：

- `deprecated node-domexception`：来自 `@google/genai` → `google-auth-library` 的传递依赖 `fetch-blob`。它只是旧版 Node 的 polyfill，Node ≥ 18 原生自带 `DOMException`，运行时完全用不到。上游未修复前无法从包侧移除。

- `allow-scripts`：npm ≥ 11.16 新增的安装脚本审批提示（`@google/genai` / `protobufjs` / `sharp` 等传递依赖的 preinstall/postinstall/install 脚本）。当前版本**只提示、不拦截**（脚本照常执行），未来版本可能改为默认拦截。想消除提示可在你的项目执行：

  ```bash
  npm approve-scripts --allow-scripts-pending   # 先查看待审批清单
  npm approve-scripts @google/genai protobufjs sharp   # 逐个批准并写入你的 package.json
  ```

  或在项目 `package.json` 声明：

  ```json
  "allowScripts": {
    "@google/genai@1.52.0": true,
    "protobufjs@7.6.5": true,
    "sharp@0.34.5": true
  }
  ```

  注意该字段按 `包名@精确版本` 匹配，版本升级后需同步更新。

## 任务看板（Beta）

桌面端（非移动端）点击标题栏的看板按钮（四宫格图标）即可在聊天与任务看板之间切换。看板把「给 agent 派活」变成了一个可跟踪、可验收、可归档的流水线。

### 状态与四列

任务按状态落入四列：

| 列 | 状态 | 说明 |
| --- | --- | --- |
| 待办 | `todo` | 已创建、等待启动 |
| 进行中 | `queued` / `preparing` / `running` | 排队中、创建 worktree 中、agent 执行中 |
| 待处理 | `awaiting_input` / `review` / `merging` / `failed` | 需要你处理：等待输入、待验收、合并中、失败 |
| 已完成 | `done` / `canceled` | 完成或取消（取消默认隐藏，可在筛选里打开） |

一条任务的完整生命周期：**创建 → 启动 → 执行 → 待验收 → 合并 → 已完成**。

### 使用流程

1. **新建任务**：点击「新建任务」，选择项目、填写标题与任务说明（prompt）。可把常用任务存为模板复用。
2. **启动**：点击卡片上的「开始」，引擎会自动在该项目的 `-worktrees` 目录下创建独立分支（`task/<id>-<slug>`），在其中启动 agent 执行。也可以把待办卡片**拖到「进行中」列**直接启动；「全部启动」会排队当前项目的全部待办任务。
3. **执行与等待**：任务运行时可随时点「取消」；agent 需要你输入时会进入「等待输入」状态。
4. **验收**：agent 完成后任务进入「待处理」列（顶部标题栏会出现红色待处理计数徽章，窗口未激活时还会收到系统通知）。点卡片打开详情抽屉：查看变更文件、Diff、完整时间线；配置了预检命令的项目会显示验收红绿灯。
   - **合并**：接受产出，可选择自动/手动提交信息、是否删除 worktree。合并由 agent 在会话内完成，成功后任务进入「已完成」。
   - **退回**：不满意时填写反馈退回给 agent 继续修改。
5. **归档**：已完成/失败/取消的任务可归档（默认隐藏，筛选里可显示）；「全部归档」一键清空已完成列。
6. **失败处理**：失败任务显示错误信息，可「重试」（换新代际重新执行）或「编辑」后重新启动；取消的任务可「重新排队」回到待办。

### 任务设置

看板标题栏的「任务设置」按项目配置执行行为（独立于主设置弹窗）：

| 设置 | 说明 |
| --- | --- |
| 自动处理排队任务 | 开启后任务一排队即自动启动 |
| 最大并发任务数 | 每项目同时执行的上限（0 = 不限） |
| 合并策略 | 合并提交（merge commit）或压缩提交（squash） |
| 合并后删除 worktree（默认） | 合并完成后自动清理 worktree 与分支 |
| 预检命令（验收检查） | 任务进入待验收前在 worktree 中运行的命令，输出红绿灯结果（如 `npm test`） |
| 初始化命令 | agent 启动前在 worktree 中执行（如 `pnpm install`） |
| 阶段提示词 | 执行 / 重试 / 退回 / 合并各阶段的附加指令 |

### 技术说明与限制

- 任务存储于 `~/.pi/agent/tasks/`（JSONL，原子写），与会话文件同级；任务会话与其他会话一样可在会话列表查看。
- 每个任务在独立 git worktree 分支中执行，互不干扰；任务 agent 被约束不得提交/推送其他分支或工作区的改动。
- 引擎由服务器进程持有（单实例锁），重启后自动恢复中断的任务（标记为失败/中断，可重试）。
- Beta 阶段：仅在桌面端显示入口；移动端不可用。

## 生产部署

完整部署步骤见 [docs/deployment.md](./docs/deployment.md)。最小流程：

```bash
npm ci
npm run build
PI_WEB_PASSWORD='替换为随机长密码' \
PI_WEB_ALLOWED_HOSTS='piweb.example.com' \
node bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open
```

生产环境建议：

1. 让 Pi Web 仅监听 `127.0.0.1`。
2. 用 Caddy、Nginx 或 Cloudflare Tunnel 对外提供 HTTPS。
3. 设置 `PI_WEB_PASSWORD` 与精确的 `PI_WEB_ALLOWED_HOSTS`。
4. 用 systemd 或 launchd 守护 `node bin/pi-web.js` 进程。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `PI_WEB_PASSWORD` | 启用 Basic Auth；用户名固定为 `pi`。 |
| `PI_WEB_ALLOWED_HOSTS` | 以逗号分隔的外部允许域名，例如 `piweb.example.com`。 |
| `PI_CODING_AGENT_DIR` | 指向另一套 Pi 数据目录；默认使用 `~/.pi/agent`。 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 为服务端模型/API 请求设置代理。 |
| `PI_WEB_NO_OPEN=1` | 禁止 CLI 在服务启动后自动打开浏览器。 |

## 目录选择与移动端

- 侧栏的“选择文件夹”会打开目录浏览器；逐层进入目录后，点击“选择此文件夹”加载项目。
- 移动端底部始终保留当前模型名称与发送按钮；思考、工具、压缩和提示音收纳在“更多控件”中。
- 长项目路径、仓库名和 Worktree 名会省略显示，避免窄屏横向滚动。

## 开发与验证

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

本地开发不要运行 `npm run build`；它会改写 `.next/` 并干扰 `npm run dev`。生产部署或 CI 可运行构建。

## 项目结构

```text
app/            Next.js App Router 与 API 路由
components/     会话、聊天、目录选择、文件预览和设置界面
hooks/          会话、主题、音频、移动端等前端状态
lib/            Pi SDK、会话读取、文件边界、Worktree 与配置逻辑
bin/pi-web.js   生产 Web 服务 CLI 入口
docs/           部署说明、截图与功能文档
```

## 桌面端与移动端

- **桌面端（desktop/）**：Tauri 2 壳（macOS / Windows / Linux）。启动进入连接管理（填写 URL+密码 / 获取本机链接 / 一键启动本机 pi-web），主窗口菜单栏「服务器」来回切换，支持多窗口多服务器。详见 [`desktop/README.md`](./desktop/README.md)。
- **移动端 mobile2/（Flutter，pi-web-qt）**：唯一移动端客户端，Android / iOS，打包名 **pi-web-qt**。

三端连接同一 Pi Web 实例时，会话/模型/MCP/插件/Skills/看板全部天然同步（数据集中在服务端 `~/.pi/agent/`）。版本号统一跟随网页端（`package.json`）：打 `v*` tag 触发 [`release-all.yml`](./.github/workflows/release-all.yml) 一次产出 mobile2（pi-web-qt-*）、desktop 三平台全部安装包；本地可用 `node scripts/sync-version.mjs` 同步两端版本号。

## 许可证

[MIT](./LICENSE)