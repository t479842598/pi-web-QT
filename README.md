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

<p align="center">
  <img src="./docs/screenshots/mobile-web.png" alt="Pi Web 移动端界面" width="320" />
</p>

## 功能

| 能力 | 说明 |
| --- | --- |
| 实时对话 | 通过 SSE 显示 Pi Agent 的流式输出、工具调用、思考过程与错误状态。 |
| 会话管理 | 按项目查看会话，支持会话内分支、Fork、重命名、删除与 HTML 导出。 |
| 项目与文件 | 通过目录选择器加载项目，浏览文件、Diff、图片、音频、PDF、DOCX。 |
| 模型与认证 | 在网页中管理模型、OAuth/API Key、连通性测试和默认模型。 |
| 技能与插件 | 查询、安装、启停 Skills 与 package 插件。 |
| Git Worktree | 在同一项目下创建、切换和移除 Worktree。 |
| 主题与语言 | 支持 Pi TUI 主题、亮暗模式及中文/English/日本語/Русский。 |
| 移动端 | 适配 Safari/Chrome 窄屏布局；模型选择和发送操作保持可见。 |

## 快速开始

### 前置条件

- Node.js **22.19.0 或更高版本**
- 已配置可用的 Pi 模型/认证信息

### 从源码运行

```bash
git clone https://github.com/t479842598/pi-web-QT.git
cd pi-web-QT
npm ci
npm run dev
```

浏览器打开 `http://127.0.0.1:30141`。

开发服务器默认只监听本机。局域网调试可使用：

```bash
npm run dev:lan
```

### 使用 npm 命令

```bash
npm install -g @agegr/pi-web
pi-web
```

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
| `PI_WEB_PASSWORD` | 启用 HTTP Basic Auth；用户名固定为 `pi`。 |
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

## Web-only 说明

本仓库不含 Electron 主进程、安装向导、桌面端打包依赖或 GitHub Release 打包工作流。请使用浏览器访问部署后的 Pi Web 服务。

## 许可证

[MIT](./LICENSE)
