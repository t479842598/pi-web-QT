# 进度日志

## 2026-08-05 - Task: 修复 npm 安装后启动崩溃 (undici 虚拟模块)

### What was done
0.9.9 发布到 npm 时误用了 Turbopack 构建产物（.next 中存在 `[turbopack]_runtime.js`），Turbopack 将 `serverExternalPackages` 中的 undici 映射为 `undici-43b6dae3674542ed` 虚拟模块名，导致 `next start` 时 `Cannot find module 'undici-43b6dae3674542ed'`。用 `npm run build`（Webpack）重新构建后 undici 引用恢复正常，版本号升至 0.9.10 发布。

### Testing
- `node --check .next/server/instrumentation.js` 通过
- grep 确认产物中无 `undici-<hash>` 哈希后缀
- `npm run build` 全量通过（Webpack + TypeScript）

### Notes
改动文件清单：
- `package.json`：版本号 0.9.9 → 0.9.10
- `CHANGELOG.md`：新增 0.9.10（修复 Turbopack 产物误发）和 0.9.9（Reasonix 路径穿越修复、PI_SESSIONS_DIR 对齐）条目
回滚方式：`git checkout v0.9.9` 即可回退。

## 2026-08-03 - Task: 移植 pi-web-desktop v0.7.16 的 UI/UX 到当前项目

### What was done
将 pi-web-desktop（isWittHere fork）v0.7.16 的桌面 UI 增强移植到当前项目（@agegr/pi-web 0.9.0），共四大块：多步骤过程分组、统一设置弹窗、会话信息条、主题 JSON 兼容。Electron 打包体积优化经评估后暂缓（用户选择先完成 UI 迁移，提交 GitHub 由 Actions 打包）。

### Testing
- `tsc --noEmit` 全量通过
- `npm run lint` 0 errors 0 warnings
- `npm test` 全量 308 tests，307 pass；唯一失败为既有问题 `app/api/models-config/test/route.ts`（API 路由被 node --test 当测试文件执行，与本次改动无关，git diff 确认未触碰）
- 新增测试全过：`components/ProcessGroup.test.mjs`(6)、`lib/process-content.test.mjs`(4)、`app/api/theme-sets/theme-sets.test.mjs`(5)
- `npm run dev` 启动验证：首页 HTTP 200、`/api/theme-sets` 正常响应 `{"themeSets":[]}`

### Notes
改动文件清单：
- `components/ProcessGroup.tsx`（新）：多步骤过程分组组件（timeline/tabs 双模式、工具 tone 合并、文件标签、流式摘要）
- `components/ProcessGroup.test.mjs`（新）：ProcessGroup 源码级测试
- `lib/process-content.ts`（新）：消息块 → ProcessContentBlock 转换
- `lib/process-content.test.mjs`（新）：块转换测试
- `lib/step-categorizer.ts`（新）：工具调用语义 tone 分类
- `lib/step-visuals.ts`（新）：步骤图标/标签描述
- `hooks/useProcessDisplayMode.ts`（新）：timeline/tabs 模式偏好（localStorage 持久化）
- `components/SettingsModal.tsx`（新）：统一设置弹窗（chat/display 两个 tab）
- `components/ChatConfig.tsx`（新）：输入快捷键设置
- `components/SettingToggle.tsx`（新）：开关组件
- `components/DisplayConfig.tsx`（新）：显示设置（主题/自定义主题/亮暗/语言），轻量版适配当前 useTheme
- `components/SessionInfoBar.tsx`（新）：会话信息条（声音/历史/分支/系统提示/压缩/令牌/上下文 donut）
- `app/api/theme-sets/route.ts`（新）：读取 `~/.pi/agent/themes/` 列出 JSON 主题
- `app/api/theme-sets/theme-sets.test.mjs`（新）：主题分组逻辑测试
- `components/ChatWindow.tsx`：接入 ProcessGroup（历史段 + live tail）+ SessionInfoBar（ChatInput 下方两处）
- `components/MessageView.tsx`：导出 ThinkingBlock/ToolCallBlock，加 contentOnly/processStyle 扩展 props + ThinkingContentBody
- `components/AppShell.tsx`：接入 SettingsModal（顶栏齿轮按钮 + 弹窗）、给 ChatWindow 传新 props
- `components/BranchNavigator.tsx`：加 embedded prop（SessionInfoBar 兼容）
- `app/globals.css`：补派生 CSS 变量（--accent-blue/green/red、--bg-secondary/card）+ process/session-info-bar 样式
- `lib/i18n/messages/en.ts` / `zh-CN.ts`：新增 desktop.* key（process*/settings/sessionInfo 等）
- `package.json` / `package-lock.json`：新增 `@phosphor-icons/react` 依赖

回滚方式：本次改动全部为新增文件 + 对现有文件的增量修改，无数据库/配置迁移。回滚可 `git checkout -- <文件>` 还原 8 个修改文件，并删除 13 个新增文件（`git clean -n` 确认后 `git clean -f`）。

## 2026-08-03 - Task: 对齐 pi-web-desktop 输入区 UI/UX

### What was done
将聊天输入区改为参考 pi-web-desktop 的紧凑双层面板：输入文本、运行中操作和工具控制收束为一体；桌面端将发送与附件入口置于面板右侧，窄屏端自动回流。保留模型、思考等级、工具预设、压缩、声音、队列、附件、slash 命令、@ 文件引用、steer/follow-up 和停止生成现有行为，并同步扩大消息区底部留白以避免遮挡最后一条消息。

### Testing
- `node --experimental-strip-types --test components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：7/7 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- 本地开发服务器（`127.0.0.1:30142`）浏览器验证：桌面视口下检测到 `textarea` 与 `.chat-input-shell`，页面无 Next.js 错误覆盖层、无 Runtime exception，页面 `scrollWidth` 与 `clientWidth` 均为 1440。
- Chrome Headless 截图核验：桌面端输入面板、外置发送/附件按钮正常显示；390x844 窄屏下按钮回流、工具入口收纳，未见水平溢出或错误覆盖层。

### Notes
改动文件清单：
- `components/ChatInput.tsx`：将编辑区与控制栏重组为统一输入面板，给发送、附件、模型和流式操作增加语义 class。
- `components/ChatWindow.tsx`：将消息列表底部留白调整为 118px，匹配新输入面板高度。
- `app/globals.css`：实现参考项目风格的低对比度输入面板、焦点/运行态、外置桌面操作和移动端回流样式。
- `docs/chat-composer-ui.md`：记录输入区设计、响应式规则与后续维护约束。
- `.lrnev/PROJECT.md`：补全项目目标、范围与关键约束。
- `.lrnev/ARCHITECTURE.md`：补全经核实的技术栈、模块与数据流。
- `.lrnev/scenes/00-default/specs/01-00-chat-composer-ui-refresh/requirements.md`：记录输入区改造需求与验收口径。
- `.lrnev/scenes/00-default/specs/01-00-chat-composer-ui-refresh/design.md`：记录最小范围视觉重组设计。
- `.lrnev/scenes/00-default/specs/01-00-chat-composer-ui-refresh/tasks.md`：登记本轮治理任务与整体验收项。

回滚方式：执行 `git restore app/globals.css components/ChatInput.tsx components/ChatWindow.tsx` 还原实现；执行 `git clean -fd -- docs/chat-composer-ui.md .lrnev` 删除本轮新增文档与治理记录（执行前先用 `git clean -nd -- docs/chat-composer-ui.md .lrnev` 预览）。

## 2026-08-03 - Task: 实现 Pi TUI 官方主题切换

### What was done
以 Pi TUI 官方内置 `light` / `dark` 作为 Web 首屏默认回退，新增真实 Pi Theme JSON 的发现、校验、解析和 Web CSS token 映射。显示设置现在可分别选择浅色主题、深色主题或跟随系统，并保留旧 Web 配色与历史本地偏好的兼容迁移。用户目录、项目与扩展加载到的 Pi 主题会与内置主题一并显示；主题接口仅暴露经允许路径读取后的描述信息和映射 token。

同步核验现有项目修改能力：本地 Git Changes 的状态、Diff、文件变更列表和预览接口仍然存在并可响应；当前项目未包含运行时 GitHub PR 创建、推送或合并能力，因此本轮没有移除或替换任何 PR 合并功能。

### Testing
- `node --experimental-strip-types --test app/api/theme-sets/theme-sets.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：10/10 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- 本地 API 集成验证（`127.0.0.1:30143` 代理）：`GET /api/themes` 返回官方 `pi:light`（builtin/light）与 `pi:dark`（builtin/dark）；两个主题详情均返回完整 CSS 映射，关键值分别为 `--bg=#f8f8f8, --accent=#5a8080` 和 `--bg=#18181e, --accent=#8abeb7`。
- Git Changes 保留验证：`GET /api/git/status?cwd=<项目路径>` 正常返回当前仓库的变更文件列表。
- 浏览器页经 CDP 确认首屏主题状态为 `data-pi-theme=pi:light`、`data-theme-mode=system`、`data-theme-resolved-mode=light`；本地代理不转发 Turbopack HMR WebSocket，无法在该代理页面完成设置弹窗交互截图，主题 API 和首屏状态已完成验证。

### Notes
改动文件清单：
- `lib/theme.ts`（新）：发现 Pi 内置、用户、项目和扩展主题，校验 JSON 并映射为 Web CSS token。
- `app/api/themes/route.ts`（新）：提供可用主题描述列表。
- `app/api/themes/[id]/route.ts`（新）：提供指定主题的安全解析结果和 CSS token。
- `app/api/theme-sets/route.ts`：保留旧接口，改为由真实 Pi 主题列表派生。
- `app/api/theme-sets/theme-sets.test.mjs`：更新旧接口兼容输出覆盖。
- `hooks/useTheme.ts`：实现亮/暗独立偏好、跟随系统、动态 token 应用和旧偏好迁移。
- `app/layout.tsx`：首屏脚本恢复亮暗偏好与默认 Pi 主题，降低闪烁。
- `app/globals.css`：将默认回退切换至 Pi TUI 官方 light/dark，并保留旧配色选择器。
- `components/AppShell.tsx`：将当前工作目录传给显示设置。
- `components/SettingsModal.tsx`：将工作目录传给显示配置页。
- `components/DisplayConfig.tsx`：展示真实 Pi 主题、亮暗模式和旧 Web 兼容配色。
- `lib/i18n/messages/en.ts` / `lib/i18n/messages/zh-CN.ts`：补充主题切换界面文案。
- `docs/theme-system.md`（新）：记录主题来源、映射、兼容与验证方式。
- `progress.md`：追加本轮施工、验证与回滚记录。

回滚方式：执行 `git restore app/api/theme-sets/route.ts app/globals.css app/layout.tsx components/AppShell.tsx components/DisplayConfig.tsx components/SettingsModal.tsx hooks/useTheme.ts lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts` 还原已跟踪实现；执行 `git clean -f -- app/api/themes lib/theme.ts docs/theme-system.md` 删除本轮新增文件。若需要保留先前输入区改造，请勿对 `app/globals.css`、`components/ChatInput.tsx`、`components/ChatWindow.tsx` 执行整体还原。

## 2026-08-03 - Task: 迁移聊天消息与工具表面视觉层级

### What was done
完成聊天视觉对齐的第一批收口。助手流式消息现在显式标记为流式状态，避免既有内容可见性优化影响持续增长的消息；生成速率、图片边框、思考错误、工具调用结果、补丁新增/删除状态、Minimap 标记和上下文用量告警均改为使用已有的主题语义 token。普通聊天底栏的 SessionInfoBar 恢复参考项目的居中容器与桌面 Minimap 留白，同时保留扩展状态栏、声音、压缩、分支和会话统计逻辑。

经参考仓库核验，用户消息、助手消息、思考块、工具调用、Markdown 与 SessionInfoBar 的主体 CSS 规则已经在当前 `app/globals.css` 中对齐，因此本轮只补齐实际未生效的流式 class、底栏容器和仍绕过主题的颜色，未进行无收益的大范围重写。

### Testing
- `node --experimental-strip-types --test components/MessageView.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：10/10 通过；新增流式助手消息 class 覆盖。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- 源码 token 核验：MessageView、SessionInfoBar、ChatMinimap、MarkdownBody 中不再保留固定 HEX / RGBA 业务状态色。
- 浏览器 CDP 验证当前代理页无 Next.js 错误覆盖层、Pi light token 正常生效；该本地 Basic Auth 代理不转发 Turbopack HMR WebSocket，且当前页面停留在工作区加载态，未能生成含会话内容的交互截图。代码级渲染测试、静态检查与参考 CSS 对比已覆盖本轮风险。

### Notes
改动文件清单：
- `components/MessageView.tsx`：增加流式 class，并将消息/工具/Diff 的固定颜色迁移为主题语义 token。
- `components/MessageView.test.mjs`：增加流式消息视觉状态的服务端渲染覆盖。
- `components/SessionInfoBar.tsx`：将上下文高用量警告与错误色迁移为状态 token。
- `components/ChatMinimap.tsx`：将活动与普通标记色迁移为文字语义 token。
- `components/ChatWindow.tsx`：应用参考项目的 SessionInfoBar 包装与层级，保留扩展状态栏位置。
- `docs/chat-message-surfaces.md`（新）：记录本批对齐范围、保留边界与验证命令。
- `progress.md`：追加本轮施工、验证与回滚记录。

回滚方式：执行 `git restore components/MessageView.tsx components/MessageView.test.mjs components/SessionInfoBar.tsx components/ChatMinimap.tsx components/ChatWindow.tsx` 还原本批实现；执行 `git clean -f -- docs/chat-message-surfaces.md` 删除本批新增文档。`ChatWindow.tsx` 也包含已验收输入区底部留白改动，若只回滚 SessionInfoBar 容器，请按 diff 手工还原底栏包装而不要整体还原文件。

## 2026-08-03 - Task: 迁移侧栏、标签栏与文件工作区视觉层级

### What was done
完成工作区表面主题收口。文件 Diff、Git Changes 徽标、文件监听、上传反馈、预览错误、会话与文件刷新完成状态以及未选择项目提示均改为使用统一主题 token；自定义 Pi TUI 主题现在也会同步影响这些状态表面。

参考项目对比后保留当前侧栏和文件工作区的信息架构：当前版本额外支持运行态轮询、独立 Git Changes 列表、工作区切换、source/preview/diff、文件刷新与中键关闭，未为了视觉相似度替换这些行为或 Git API 调用。

### Testing
- `node --experimental-strip-types --test components/SessionSidebar.test.mjs components/MessageView.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：13/13 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- 源码核验：FileViewer 与 FileExplorer 的业务状态色已由 `--diff-*`、`--status-*` 与 `--accent-*` token 提供；保留的黑色阴影仅为中性浮层阴影。

### Notes
改动文件清单：
- `components/FileViewer.tsx`：将 Diff、文件监听、预览与加载错误、嵌入预览底色收口到主题 token。
- `components/FileExplorer.tsx`：将 Git 状态徽标、上传冲突、上传结果和文件树状态收口到主题 token。
- `components/SessionSidebar.tsx`：将会话/文件刷新完成与未选择项目提示收口到主题 token。
- `docs/workspace-surfaces.md`（新）：记录工作区对齐范围、保留边界与验证方式。
- `progress.md`：追加本轮施工、验证与回滚记录。

回滚方式：执行 `git restore components/FileViewer.tsx components/FileExplorer.tsx components/SessionSidebar.tsx` 还原本批实现；执行 `git clean -f -- docs/workspace-surfaces.md` 删除本批新增文档。不要还原 `app/api/git/*` 或 `lib/git-changes.ts`，本轮未修改这些链路。

## 2026-08-03 - Task: 修复移动端顶部与侧栏安全区遮挡

### What was done
移动端顶栏现仅保留单行核心入口，隐藏会抢占宽度的会话标题和会话控制组，并移除与标题栏重复的固定文件面板按钮。侧栏改为“可滚动主区 + 固定底栏”的弹性结构，Models、Skills、Plugins 保持在浏览器安全区上方可见。

### Testing
- `node --experimental-strip-types --test components/MobilePwaLayout.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：12/12 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- Next dev 热更新验证：当前 `pi-web` 启动的 `127.0.0.1:30141` 返回 HTTP 200；编译出的当前 CSS 已包含移动侧栏 footer 安全区和顶部控件收起规则。

### Notes
改动文件清单：
- `components/AppTitleBar.tsx`：限制移动端顶栏内容的溢出并为会话标题/控件提供样式锚点。
- `components/AppShell.tsx`：将侧栏拆为弹性主区和固定 footer，标记移动端需收起的顶部控件与重复文件按钮。
- `components/SessionSidebar.tsx`：允许会话/文件主区在 footer 存在时正确收缩。
- `app/globals.css`：添加移动端顶栏收起、侧栏主区和安全区 footer 规则。
- `components/MobilePwaLayout.test.mjs`：覆盖顶栏与底栏安全区布局约束。
- `docs/mobile-layout.md`：记录移动端布局边界与验证方式。
- `progress.md`：追加本轮记录。

回滚方式：回滚点为当前 `HEAD` `7c1c3e10a756dda7fc229747c36c2292072c8fe2`；因 `app/globals.css`、`AppShell.tsx` 和 `SessionSidebar.tsx` 同时含先前未提交工作，使用 `git restore -p -- components/AppTitleBar.tsx components/AppShell.tsx components/SessionSidebar.tsx app/globals.css components/MobilePwaLayout.test.mjs docs/mobile-layout.md` 仅选择本轮 hunk。

## 2026-08-03 - Task: 按参考项目重构聊天输入区视觉

### What was done
基于 `isWittHere/pi-web-desktop` 当前 main 的 Composer 结构重新对齐输入区：恢复低对比度双层面板、面板内 24px 图标发送按钮与流式右上角双图标操作，去除与参考不一致的外置发送/附件轨道。队列、附件、模型、思考、工具、压缩、声音、停止生成、slash 和 @ 文件交互保持原有调用链。

### Testing
- `node --experimental-strip-types --test components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs components/MobilePwaLayout.test.mjs`：12/12 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- 热更新运行验证：`pi-web` 对应的 Next dev 进程工作目录为当前项目，根页 HTTP 200；当前 Turbopack CSS 产物已包含 `width:calc(100% + 20px)`、24px 发送按钮和流式 `top:-22px` 控件规则。

### Notes
改动文件清单：
- `components/ChatInput.tsx`：按参考项目重组 Composer 外壳、流式图标浮层与工具栏发送入口，保留本项目扩展能力。
- `app/globals.css`：将 Composer 的面板、文本区、工具栏、发送和流式操作规则收敛到参考项目基线。
- `components/MobilePwaLayout.test.mjs`：将移动端输入区断言更新为新的参考结构。
- `docs/chat-composer-ui.md`：更新输入区结构、响应式规则和参考版本。
- `progress.md`：追加本轮记录。

回滚方式：回滚点为当前 `HEAD` `7c1c3e10a756dda7fc229747c36c2292072c8fe2`；因 `app/globals.css` 与 `components/ChatInput.tsx` 含先前未提交工作，使用 `git restore -p -- components/ChatInput.tsx app/globals.css components/MobilePwaLayout.test.mjs docs/chat-composer-ui.md` 仅选择本轮 hunk。

## 2026-08-03 - Task: 审阅 2026-08-02 源仓库 PR 并准备迁移到 pi-web-desktop

### What was done
已将 `isWittHere/pi-web-desktop` 的 `main` 分支克隆到当前项目同级目录 `../pi-web-desktop`，固定候选基线为 `80d21fc84b9c5b193b3ae947818fa001e30be032`。已审阅当前仓库在 2026-08-02 20:53 至 21:05（+08:00）连续合入的源仓库 PR：`pr-349`、`pr-332`、`pr-330`、`pr-352`、`pr-344`、`pr-338`、`pr-340`、`pr-353`、`pr-350`、`pr-335`。

迁移基线已明确：采用 `pi-web-desktop` 的完整界面样式；现有 Pi TUI 主题发现、亮色/暗色/跟随系统切换与主题解析能力列为替换后的保留项，不采用静态配色降级。`pr-335` 涉及 AgentSession 队列持久化、恢复与 SSE/RPC 路径，属于并发消息处理范围，已在合并前暂停，等待用户明确确认。

### Testing
- `git clone --origin upstream --branch main https://github.com/isWittHere/pi-web-desktop.git ../pi-web-desktop`：完成；候选基线 `HEAD` 为 `80d21fc84b9c5b193b3ae947818fa001e30be032`。
- 对 10 个 2026-08-02 合并提交执行 `git diff <merge>^1 <merge>`：已核验其精确文件范围及功能增量。
- 候选基线只读核验：Next.js 16.2.12、React 19.2.4、Node `>=22.19.0`；尚未开始源码替换，因此不宣称应用行为已验证。

### Notes
改动文件清单：
- `.lrnev/scenes/00-default/specs/02-00-desktop-ui-alignment-and-tui-themes/tasks.md`：登记迁移任务 `T-009` 及主题保留子任务 `T-010`。
- `progress.md`：追加本轮审阅、风险判断和候选基线记录。
- `../pi-web-desktop/`（新同级候选目录）：克隆的参考项目，尚未替换当前工作区源码。

回滚方式：执行 `rm -rf ../pi-web-desktop` 删除候选克隆；执行 `git restore -- progress.md` 还原本轮进度记录；如需撤销治理任务，编辑 `.lrnev/scenes/00-default/specs/02-00-desktop-ui-alignment-and-tui-themes/tasks.md` 删除 `T-009`、`T-010` 条目并恢复其摘要状态。

## 2026-08-03 - Task: Web 版 README、部署说明与桌面端移除

### What was done
将交付口径收敛为纯网页服务：README 改为当前 Web 功能、截图、运行方式和生产部署说明；补充独立部署文档和仅做网页校验的 CI。Electron 主进程、预加载、安装向导、桌面打包脚本与发布工作流已移除，历史本地与远端标签也已删除。

本机 `pi-web` 启动器已改为指向当前 `pi-web-QT` 目录，并通过仓库的 `bin/pi-web.js` 启动生产服务，不再启动旧的 `pi-web-desktop` 或 Turbopack 开发服务；先前占用 30141 的旧服务已停止。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；webpack 仅保留 `app/api/sessions/[id]/export/route.ts` 的既有动态依赖告警。
- `git diff --check`：通过；源码与部署入口中未检出 Electron 运行或打包路径残留。
- 以更新后的 `/Users/qingtang/.local/bin/pi-web --no-open` 在临时端口启动：HTTP Basic Auth 页面返回 200，HTML 不含 `turbopack`、`next-devtools` 或 `react-server-dom-turbopack` 开发标记。
- `git tag --list` 为空；`gh api repos/t479842598/pi-web-QT/git/matching-refs/tags/ --jq 'length'` 返回 `0`。

### Notes
改动文件清单：
- `README.md`：重写为纯网页端功能、截图、运行、部署和移动端使用说明。
- `README.en.md`：标明仅提供 Web 服务，避免与主 README 冲突。
- `docs/deployment.md`：新增构建、systemd、Caddy、Cloudflare Tunnel 和更新流程。
- `docs/screenshots/web-workspace.png`：新增网页工作台截图。
- `docs/screenshots/mobile-web.png`：新增移动端截图。
- `docs/screenshots/directory-picker.png`：新增目录选择器截图。
- `.github/workflows/web-ci.yml`：新增 Web-only 类型、Lint 与生产构建校验。
- `.github/workflows/build.yml`：删除 Electron 打包发布工作流。
- `package.json`：删除 Electron 入口、桌面端脚本与打包配置，更新仓库元数据。
- `package-lock.json`：移除 Electron 与 electron-builder 的直接依赖锁定。
- `electron/main.js`：删除 Electron 主进程。
- `electron/preload.js`：删除 Electron 预加载脚本。
- `electron/setup.html`：删除 Electron 安装向导页面。
- `global.d.ts`：删除仅桌面端的全局声明。
- `hooks/useElectronWindow.ts`：删除仅桌面端窗口控制 Hook。
- `pi-web.plist`：删除旧的桌面/本机启动配置。
- `components/AppTitleBar.tsx`：移除 Electron 窗口控制和依赖。
- `app/globals.css`：移除 Electron 拖拽区域样式。
- `eslint.config.mjs`：移除 Electron 目录忽略规则。
- `CHANGELOG.md`：记录 Web-only 变更。
- `/Users/qingtang/.local/bin/pi-web`：本机启动器改为调用当前项目的生产 CLI。
- `progress.md`：追加本轮记录。

回滚方式：对仓库内文件使用 `git restore -p -- <file>` 按 hunk 还原，新增文档可用 `git clean -f -- docs/deployment.md docs/screenshots/web-workspace.png docs/screenshots/mobile-web.png docs/screenshots/directory-picker.png .github/workflows/web-ci.yml` 删除；本机启动器可将其 `project_dir` 改回旧路径。删除的标签在 Git 垃圾回收前可用 `git fsck --no-reflogs --unreachable` 找回 tag object，再执行 `git update-ref refs/tags/<tag-name> <tag-object>` 和 `git push origin refs/tags/<tag-name>` 恢复。

## 2026-08-03 - Task: 恢复目录选择器与移动端聊天控件可见性

### What was done
项目目录入口恢复为目录选择器：用户逐层打开文件夹后，点击“选择此文件夹”完成加载，弹窗不再提供可输入路径或“转到”按钮。没有已选项目时，侧栏主入口直接打开该选择器。

移动端聊天底栏将当前模型名称和发送按钮保留在主工具栏；推理、工具、压缩与提示音继续收纳在“更多控件”。长项目路径、仓库名和 Worktree 名在窄屏缩小并截断，避免页面出现横向滚动。

### Testing
- `node --experimental-strip-types --test components/SessionSidebar.test.mjs components/ChatInput.test.mjs components/ChatInput.dormancy.test.mjs`：10/10 通过。
- `node --experimental-strip-types --test lib/directory-browser.test.mjs`：4/4 通过。
- `node_modules/.bin/tsc --noEmit`、`npm run lint`、`git diff --check`：均通过。
- 生产模式浏览器验证（390 × 844）：无浏览器错误，页面宽度 `scrollWidth=390`、`clientWidth=390`；超长仓库路径未造成横向滚动，当前模型 `Pi Web Demo Model` 和 `发送` 按钮均在主工具栏可见。
- 目录选择器浏览器验证：点击项目入口后可打开目录弹窗；弹窗存在“选择此文件夹”，不存在 text input 和“转到”按钮。
- API 冒烟验证：`/api/cwd/browse` 能返回目录列表；测试数据中的会话和模型均由生产服务正常读取。

### Notes
改动文件清单：
- `components/DirectoryPicker.tsx`：移除路径文本输入与手工跳转，仅保留目录浏览和当前目录确认。
- `components/SessionSidebar.tsx`：无项目时直接打开选择器，更新选择文件夹文案并标记路径缩略样式。
- `components/ChatInput.tsx`：移动端始终渲染模型显示，将发送按钮移出更多控件容器。
- `app/globals.css`：增加窄屏模型/发送布局与长路径缩略规则。
- `lib/i18n/messages/zh-CN.ts`：更新目录选择和侧栏中文文案。
- `lib/i18n/messages/en.ts`：更新目录选择和侧栏英文文案。
- `README.md`：补充目录选择与移动端可见性说明。
- `progress.md`：追加本轮记录。

回滚方式：因 `components/SessionSidebar.tsx`、`components/ChatInput.tsx`、`app/globals.css` 与此前未提交改动共存，使用 `git restore -p -- components/DirectoryPicker.tsx components/SessionSidebar.tsx components/ChatInput.tsx app/globals.css lib/i18n/messages/zh-CN.ts lib/i18n/messages/en.ts README.md` 逐段撤回本轮 hunk；不要整体还原共享文件。

## 2026-08-03 - Task: 核验远程刷新后样式回退

### What was done
定位到直接原因是 Cloudflare Tunnel 先前转发的 30141 服务来自旧的 `pi-web-desktop` 目录，而不是当前 QT 工作区；刷新因此会重新拿到旧界面。现已将旧服务替换为 `/Volumes/1T 原装/项目研发/pi-web-QT` 的生产进程，远端与本机页面引用的静态资源清单已一致。

同时修正 PWA 静态缓存版本策略：不再只按长期不变的 package version 划分缓存，而是按实际 Next 静态资源指纹注册 Service Worker。每次产生不同网页资源的构建都会激活新缓存并清理旧缓存，避免旧 UI bundle 在后续刷新时被复用。

### Testing
- 生产服务进程监听 30141，cwd 为 `/Volumes/1T 原装/项目研发/pi-web-QT`。
- `https://piweb.274747.xyz/` 与 `http://127.0.0.1:30141/` 均返回 200，页面字节数和 19 个静态资源 URL 完全一致。
- 远端首页响应为 `Cache-Control: private, no-cache, max-age=0, must-revalidate`；无 Turbopack 调试标记。
- `node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm run build`、`git diff --check`：通过。构建仅保留既有 export route 动态依赖告警。

### Notes
改动文件清单：
- `components/PwaRegistration.tsx`：以实际 Next 静态资源 URL 生成 Service Worker 缓存版本，确保部署后清除旧界面缓存。
- `docs/deployment.md`：记录部署构建后的静态资源缓存更新行为。
- `progress.md`：追加本轮定位、修复、验证和回滚记录。

回滚方式：使用 `git restore -p -- components/PwaRegistration.tsx docs/deployment.md` 仅撤回本轮 hunk；如需恢复旧启动目标，编辑 `/Users/qingtang/.local/bin/pi-web` 的 `project_dir`，但该操作会重新指向旧项目且不应在当前 Web-only 交付中使用。

## 2026-08-03 - Task: 以 pi-web-QT 为主合并桌面端界面基线

### What was done
确认 QT 工作区已经保留并运行 `pi-web-desktop` 的聊天输入、消息、SessionInfo、侧栏和工作区视觉基线，同时叠加本轮目录选择器与移动端可见性修复。未执行破坏性的整目录覆盖，避免覆盖 QT 独有的会话、模型、文件、Git Worktree 和移动端功能。

本机 `pi-web` 命令保持只启动 QT 的 `bin/pi-web.js` 生产入口；远端隧道现已验证转发该进程。

### Testing
- 参考目录 `../pi-web-desktop` 固定在 `45b38f51e09845331118cf55eb12aab395b5ec32`；QT 的 CSS 已包含 desktop 基线的 Composer、消息、SessionInfo 和工作区选择器。
- 当前 30141 `next-server` cwd 为 `/Volumes/1T 原装/项目研发/pi-web-QT`。
- 远端与本机静态资源清单一致，确认不再由旧目录提供页面。

### Notes
改动文件清单：
- `/Users/qingtang/.local/bin/pi-web`：持续指向 QT 的生产启动入口。
- `progress.md`：追加合并基线核验记录。

回滚方式：如需仅撤回启动器指向，手工修改 `/Users/qingtang/.local/bin/pi-web` 的 `project_dir`；不建议覆盖或删除 `../pi-web-desktop`，它保留为只读参考基线。

## 2026-08-03 - Task: 同步 desktop Web 基线并收紧移动端工作区与模型选择

### What was done
- 以 `pi-web-desktop` 为唯一 Web 运行基线同步到 `pi-web-QT`，保留 QT 的 README、`docs/`、变更日志和治理目录；仓库不再纳入 Electron/PWA 桌面交付代码。
- 移动端项目名和 Git Worktree 名缩小至 10px（欢迎页项目名为 18px）并限制宽度；超长名称继续省略，不产生横向滚动。
- 模型菜单在展开或收起供应商二级列表时固定 320px 内框，只滚动结果区域，避免下拉框位置和高度跳动。
- 保留网页目录选择器、移动端常显模型/发送按钮，并将新会话目录授权辅助函数移出 Next Route 模块，避免 Route Handler 的额外导出破坏类型校验。
- 同步 README 与部署文档，明确 Web-only 运行方式、目录选择器和移动端行为。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm test`：225/225 通过。
- `git diff --check`：通过。
- Playwright（390×844，`http://127.0.0.1:30142`）：无控制台或页面错误、无横向溢出；项目/工作树字号为 10px，欢迎页项目名为 18px；模型与发送按钮均可见；供应商展开前后模型面板均为 `top=178`、`height=320`、`bottom=498`。

### Notes
改动文件清单：
- `.github/workflows/build.yml`：随 Web-only 基线移除。
- `.gitignore`：同步 pi-web-desktop 的对应实现、配置或测试。
- `CHANGELOG.md`：同步 pi-web-desktop 的对应实现、配置或测试。
- `LICENSE`：同步 pi-web-desktop 的对应实现、配置或测试。
- `README.en.md`：同步 pi-web-desktop 的对应实现、配置或测试。
- `README.md`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/[id]/bash-output/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/[id]/events/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/[id]/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/events-route.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/new/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/running/events/route.ts`：随 Web-only 基线移除。
- `app/api/agent/running/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/auth/all-providers/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/auth/logout/[provider]/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/auth/providers/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/cwd/validate/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/default-cwd/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/file-index/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/files/[...path]/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/git/diff/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/git/status/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/models-config/catalog/route.ts`：随 Web-only 基线移除。
- `app/api/models-config/discover/route.ts`：随 Web-only 基线移除。
- `app/api/models-config/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/models-config/test/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/models/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/plugins/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/project-trust/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/sessions/[id]/auto-name/route.ts`：随 Web-only 基线移除。
- `app/api/sessions/[id]/export/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/sessions/[id]/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/skills/check/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/skills/install/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/skills/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/skills/update/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/theme-sets/route.ts`：随 Web-only 基线移除。
- `app/api/theme-sets/theme-sets.test.mjs`：随 Web-only 基线移除。
- `app/api/usage/route.ts`：随 Web-only 基线移除。
- `app/api/worktrees/route.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/favicon.ico`：随 Web-only 基线移除。
- `app/globals.css`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/layout.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/manifest.ts`：随 Web-only 基线移除。
- `app/page.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `bin/node-version.js`：随 Web-only 基线移除。
- `bin/pi-web.js`：同步 pi-web-desktop 的对应实现、配置或测试。
- `bun.lock`：随 Web-only 基线移除。
- `components/AppShell.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/AppTitleBar.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/BranchNavigator.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ChatInput.dormancy.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ChatInput.test.mjs`：随 Web-only 基线移除。
- `components/ChatInput.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ChatMinimap.module.css`：随 Web-only 基线移除。
- `components/ChatMinimap.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ChatWindow.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/DirectoryPicker.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/DisplayConfig.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ExtensionStatusBar.test.mjs`：随 Web-only 基线移除。
- `components/ExtensionStatusBar.tsx`：随 Web-only 基线移除。
- `components/FileExplorer.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/FileIcons.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/FileViewer.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/MarkdownBody.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/MarkdownBody.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/MermaidBlock.test.mjs`：随 Web-only 基线移除。
- `components/MermaidBlock.tsx`：随 Web-only 基线移除。
- `components/MessageView.test.mjs`：随 Web-only 基线移除。
- `components/MessageView.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/MobilePwaLayout.test.mjs`：随 Web-only 基线移除。
- `components/ModelsConfig.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/PluginsConfig.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/ProjectTrustDialog.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/PwaRegistration.tsx`：随 Web-only 基线移除。
- `components/QueueRecoveryDialog.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/QuoteReplyPopover.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/SessionSidebar.test.mjs`：随 Web-only 基线移除。
- `components/SessionSidebar.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/SettingsModal.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/SkillsConfig.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/TabBar.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `components/UsageStats.tsx`：随 Web-only 基线移除。
- `components/ZoomPanViewer.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `electron/main.js`：随 Web-only 基线移除。
- `electron/preload.js`：随 Web-only 基线移除。
- `electron/setup.html`：随 Web-only 基线移除。
- `eslint.config.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `global.d.ts`：随 Web-only 基线移除。
- `hooks/model-scope-startup.test.mjs`：随 Web-only 基线移除。
- `hooks/useAgentSession.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useAgentSession.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useDragDrop.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useElectronWindow.ts`：随 Web-only 基线移除。
- `hooks/useI18n.tsx`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useResizablePanel.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useTheme.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `hooks/useViewportHeight.test.mjs`：随 Web-only 基线移除。
- `hooks/useViewportHeight.ts`：随 Web-only 基线移除。
- `lib/ansi.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/ansi.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/api-types.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/atomic-file.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/atomic-file.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/bash-output.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/bash-output.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/bounded-form-data.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/custom-ui-terminal.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/custom-ui-terminal.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-access.test.mjs`：随 Web-only 基线移除。
- `lib/file-access.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-dirent.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-fuzzy.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-links.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-links.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-upload.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/file-upload.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/git-changes.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/git-changes.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/git-status.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/git-types.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/http-dispatcher.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/http-dispatcher.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/format.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/format.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/messages/en.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/messages/zh-CN.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/registry.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/registry.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/i18n/types.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/image-attachments.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/image-attachments.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/initial-navigation.test.mjs`：随 Web-only 基线移除。
- `lib/initial-navigation.ts`：随 Web-only 基线移除。
- `lib/markdown.test.mjs`：随 Web-only 基线移除。
- `lib/markdown.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/message-display.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/message-display.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/model-catalog.test.mjs`：随 Web-only 基线移除。
- `lib/model-catalog.ts`：随 Web-only 基线移除。
- `lib/model-discovery-auth.ts`：随 Web-only 基线移除。
- `lib/model-discovery.test.mjs`：随 Web-only 基线移除。
- `lib/model-discovery.ts`：随 Web-only 基线移除。
- `lib/model-scope.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/model-scope.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/models-cache.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/models-cache.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/node-version.test.mjs`：随 Web-only 基线移除。
- `lib/normalize.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/panel-layout.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/panel-layout.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/path-security.ts`：随 Web-only 基线移除。
- `lib/pi-types.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/pi-web-options.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/project-trust.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/project-trust.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-api-key-route.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-credential-store.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-credential-store.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-listing-runtime.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-listing.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/provider-listing.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/request-security.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/request-security.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/rpc-manager-shutdown.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/rpc-manager.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/rpc-manager.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-file-references-core.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-file-references.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-file-references.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-path.test.mjs`：随 Web-only 基线移除。
- `lib/session-path.ts`：随 Web-only 基线移除。
- `lib/session-reader.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-reader.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/session-title.test.mjs`：随 Web-only 基线移除。
- `lib/session-title.ts`：随 Web-only 基线移除。
- `lib/skills-service.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/startup-preferences.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/terminal-input.test.mjs`：随 Web-only 基线移除。
- `lib/terminal-input.ts`：随 Web-only 基线移除。
- `lib/types.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/usage-store.ts`：随 Web-only 基线移除。
- `lib/web-auth.test.mjs`：同步 pi-web-desktop 的对应实现、配置或测试。
- `lib/web-auth.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `next.config.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `package-lock.json`：同步 pi-web-desktop 的对应实现、配置或测试。
- `package.json`：同步 pi-web-desktop 的对应实现、配置或测试。
- `pi-web.plist`：随 Web-only 基线移除。
- `progress.md`：同步 pi-web-desktop 的对应实现、配置或测试。
- `proxy.ts`：同步 pi-web-desktop 的对应实现、配置或测试。
- `public/icons/apple-touch-icon.png`：随 Web-only 基线移除。
- `public/icons/icon-192.png`：随 Web-only 基线移除。
- `public/icons/icon-512.png`：随 Web-only 基线移除。
- `public/offline.html`：随 Web-only 基线移除。
- `public/sw.js`：随 Web-only 基线移除。
- `tailwind.config.ts`：随 Web-only 基线移除。
- `tsconfig.json`：同步 pi-web-desktop 的对应实现、配置或测试。
- `app/api/agent/new/route.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `app/api/themes/[name]/route.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `app/api/themes/route.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `app/icon.ico`：从 pi-web-desktop 基线或本轮交付文档新增。
- `app/icon.png`：从 pi-web-desktop 基线或本轮交付文档新增。
- `app/icon.svg`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/CompactionSummary.tsx`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/ModelsConfig.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/PluginsConfig.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/ProviderIcon.tsx`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/QuickChangesPanel.tsx`：从 pi-web-desktop 基线或本轮交付文档新增。
- `components/ToolCallBlock.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/chat-composer-ui.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/chat-message-surfaces.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/deployment.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/mobile-layout.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/screenshots/directory-picker.png`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/screenshots/mobile-web.png`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/screenshots/web-workspace.png`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/theme-system.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `docs/workspace-surfaces.md`：从 pi-web-desktop 基线或本轮交付文档新增。
- `global.d.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/git-status.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/i18n/catalog.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/markdown-incremental.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/markdown-incremental.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/new-session-cwd.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/prism-theme.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/queue-export.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/quote-reply.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/stream-update-scheduler.test.mjs`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/stream-update-scheduler.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `lib/theme.ts`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/favicon.svg`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/gruvbox-dark.json`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/icon.ico`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/icon.png`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/icon.svg`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/pi-original.svg`：从 pi-web-desktop 基线或本轮交付文档新增。
- `public/catppuccin-icons/**`：新增 1313 个上游 Catppuccin 图标静态资源，供文件图标展示使用。

回滚方式：提交后执行 `git revert HEAD`；如需恢复同步前未提交工作树，使用 `/Volumes/1T 原装/项目研发/.pi-web-sync-backups/20260803-155900/pi-web-QT/working-tree.before.tgz` 与同目录的 staged/unstaged patch，旧 `.next` 已保留在 `/tmp/pi-web-qt-next-before-source-sync-20260803-161500`。

## 2026-08-03 - Task: 补齐 README 更新日志并通过 7897 推送 QT 仓库

### What was done
- 在根目录 `README.md` 补充当前网页基线、目录选择器、移动端名称收紧、常显模型/发送按钮、稳定模型下拉和生产渲染修复的更新日志。
- 同步 `README.en.md` 的最新更新摘要，并将 `CHANGELOG.md` 的 Unreleased 内容改为当前实现对应的完整变更项。
- 使用本机 `127.0.0.1:7897` 代理将上一轮 Web 基线提交推送至 `t479842598/pi-web-QT` 的 `main` 分支。

### Testing
- `HTTPS_PROXY=http://127.0.0.1:7897 curl -IL https://github.com`：返回 200，确认代理可访问 GitHub。
- `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY=http://127.0.0.1:7897 git push origin main`：`7c1c3e1..658b96d main -> main`。
- `git diff --check`：通过。
- README/CHANGELOG 标题与“模型下拉稳定性”条目检索：通过。

### Notes
改动文件清单：
- `README.md`：增加面向使用者的完整最新更新日志，并修正当前仅支持中文/English 的语言说明。
- `README.en.md`：增加英文最新更新摘要。
- `CHANGELOG.md`：将 Unreleased 改为与现有 Web-only、目录选择、移动端与渲染修复一致的变更记录。
- `progress.md`：追加本轮文档、推送和验证记录。

回滚方式：文档提交后执行 `git revert HEAD`；已推送的上一轮 Web 基线提交可使用 `git revert 658b96d` 回退。

## 2026-08-03 - Task: 恢复 QT 固定主题并优化移动端输入区

### What was done
- 恢复 QT 原有的 Gruvbox、Nord、Tokyo Night、Solarized、One Dark、Dracula 与 Catppuccin 七套固定主题；保持 Pi JSON 自定义主题、浅色/深色/跟随系统模式和边框可见度功能。
- 将移动端聊天输入框最小高度提升至 52px，并以更紧凑的行高、字距降低文字视觉密度；保留 16px 实际字号，避免 iOS Safari 聚焦自动缩放。
- 将当前行为、部署验证入口和更新日志同步至根 README、英文 README、CHANGELOG 与主题/移动端文档。

### Testing
- `/Volumes/1T 原装/项目研发/pi-web-desktop`：`npm run build` 通过；仅有既有 `next.config.ts` NFT 全项目追踪的非阻断警告。
- `/Volumes/1T 原装/项目研发/pi-web-desktop`：生产服务的 `/api/themes` 返回七套 `builtin: true` 主题；`/api/themes/nord?mode=dark` 返回 `#2e3440` 背景与 `#88c0d0` 强调色；无认证请求返回 401。
- Playwright（390×844、生产服务）：页面有内容、无框架错误覆盖层、无横向溢出；输入框高度 52px、计算字号 16px、行高 23.2px；选择 Nord 后 `data-theme=nord` 且 CSS 变量正确更新。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm test`：227/227 通过。
- `git diff --check`：通过。

### Notes
改动文件清单：
- `app/globals.css`：增加移动端聊天输入框高度及紧凑文本规则。
- `lib/theme.ts`：新增七套 QT 内置主题，列出并解析其亮暗 CSS token，同时保留 JSON 主题扫描。
- `lib/theme.test.mjs`：覆盖内置主题列表及 Nord 亮暗变量解析。
- `README.md`：补充中文最新更新说明。
- `README.en.md`：补充英文最新更新说明。
- `CHANGELOG.md`：记录固定主题恢复和移动端输入区改动。
- `docs/theme-system.md`：更新当前主题来源、API 与验证说明。
- `docs/mobile-layout.md`：记录移动端输入区高度与 Safari 缩放约束。
- `progress.md`：追加本轮施工、验证和回滚记录。

回滚方式：提交后执行 `git revert HEAD`；若只撤销未提交工作区，执行 `git restore -- app/globals.css lib/theme.ts README.md README.en.md CHANGELOG.md docs/theme-system.md docs/mobile-layout.md progress.md && rm lib/theme.test.mjs`。

## 2026-08-04 - Task: 修复对话滚动跟随回归 + 版本号统一 0.9.2

### What was done
- 定位回归根源：8 月 2 日本地修复 `e7498f4`（52px spacer + 靠近底部自动跟随）被 8 月 4 日 `658b96d "Sync web baseline"` 同步上游时覆盖回退——`ChatWindow.tsx` 恢复 agent 运行时**全视口空白 spacer**，`scrollToBottom` 直接滚到 spacer 之后的 sentinel，导致"对话不跟随、跳到底部空白"。
- 上游 `agegr/pi-web` PR #372（floating scroll toolbar，windli2018）**未合并**（状态 Open），其 diff 基线与本项目被覆盖前一致；参考其滚动修复方法（spacer 小高度 + scrollToBottom 回退 spacer 让最后一条消息落视口底部）并恢复本地原有自动跟随，未移植其浮动工具栏功能。
- 版本号统一为 0.9.2：package.json / package-lock.json（`next.config.ts` 自动注入 `NEXT_PUBLIC_APP_VERSION`，界面显示 `web v0.9.2`）；CHANGELOG 新增 0.9.2 条目。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过（脚本头显示 @iswitthere/pi-web-desktop@0.9.2，确认版本生效）。
- 运行中的 dev server（127.0.0.1:30141，用户进程）热更新后页面 HTTP 200 无渲染错误。
- 缺口：滚动行为（streaming 跟随、滚上方不被打断、无空白页）需浏览器实操确认——请刷新已打开的 dev 页面验证；dev server 为版本改动前启动，重启后才显示 `web v0.9.2`。

### Notes
改动文件清单：
- `components/ChatWindow.tsx`：agent 运行时 spacer 从全视口 clientHeight 改为固定 96px（消除空白跳转）。
- `hooks/useAgentSession.ts`：`scrollToBottom` 重写为回退算法（sentinel 绝对位置 − spacer − clientHeight − 4，最后一条消息落视口底部 ~40px）；新增 `SCROLL_BOTTOM_THRESHOLD=150` 与 `isNearBottomRef`，`message_start` 时靠近底部则 rAF 自动跟随，滚动离开后不打扰；恢复完成滚动条件 `|| isNearBottomRef.current`。
- `package.json`：version 0.7.16 → 0.9.2。
- `package-lock.json`：root version 同步 0.9.2。
- `CHANGELOG.md`：新增 0.9.2 条目（滚动修复 + 版本统一）。

回滚方式：提交后执行 `git revert HEAD`；若只撤销未提交工作区，执行 `git restore -- components/ChatWindow.tsx hooks/useAgentSession.ts package.json package-lock.json CHANGELOG.md progress.md`（版本号可再用 `npm version 0.7.16 --no-git-tag-version` 还原）。

## 2026-08-04 - Task: 发布 0.9.2（推送 GitHub + 切换生产模式）

### What was done
- 提交 `dba83cf`（fix: 修复对话滚动跟随回归 + 版本号统一 0.9.2，6 文件）推送至 GitHub `origin/main`（t479842598/pi-web-QT），推送输出 `d29791d..dba83cf`；工作区仅剩用户自己的 `FileExplorer.tsx` 未提交改动，未纳入。
- 停止原 dev server（PID 19332），`npm run build` 生产构建（6.1s，TS 检查通过，15/15 静态页；仅既有 next.config.ts NFT 追踪非阻断警告）。
- 用仓库 CLI 启动生产服务：`nohup node bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open`（自动加载 `.env` 密码/允许域名），日志 `Ready in 92ms`，进程 PID 32755。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- 页面带 Basic 认证返回 HTTP 200；响应头 `x-nextjs-cache: HIT` / `x-nextjs-prerender: 1` 确认生产模式。
- 构建产物 `.next/static/chunks/25kc5rbcw68l6.js` 含 `0.9.2`，全产物无 `0.7.16` 残留，`NEXT_PUBLIC_APP_VERSION` 注入正确（界面显示 `web v0.9.2`）。
- 缺口：滚动行为浏览器实操确认（用户刷新生产页面验证）。

### Notes
改动文件清单：
- `CHANGELOG.md`、`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`、`package.json`、`package-lock.json`、`progress.md`：与上一轮修复内容一致，本轮经提交 `dba83cf` 推送到 GitHub。
- 运行方式变更：服务由 dev 模式（next dev）切换为生产模式（next start，经 bin/pi-web.js 启动），端口不变 30141；重启命令 `node bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open`（在项目目录、自动读 .env）。

回滚方式：服务回退到 dev：`kill 32755 && npm run dev`；代码回退：`git revert dba83cf` 或 `git reset --hard d29791d`。

## 2026-08-04 - Task: 常量重构收尾 + 用户手动启动验证

### What was done
- 按 review should-fix 提取共享常量 `AGENT_RUNNING_SPACER_PX = 96`（`hooks/useAgentSession.ts` 顶层导出），`scrollToBottom` 回退量与 ChatWindow spacer 渲染消费同一常量，消除双处硬编码几何错位风险；同步修正注释与公式（去掉 -4，最后一条消息贴视口底）。
- 重新 `npm run build`（21.7s 通过，仅既有 NFT 追踪警告）；服务启动改由用户手动执行（用户指示权限原因），用户已 kill 旧进程并以 `pi-web` 命令启动新构建并验证 OK（web v0.9.2、滚动跟随正常），复查确认新进程 PID 36414 监听 30141、页面 HTTP 200。
- 确认用户本机 `pi-web` 命令（`~/.local/bin/pi-web`）硬编码指向当前项目 `/Volumes/1T 原装/项目研发/pi-web-QT`，与 `.env` 密码/允许域名一致。
- 提交 `2c87601`（refactor: 提取 AGENT_RUNNING_SPACER_PX 共享常量）推送 GitHub；fresh review（复用）判定 pass。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过；`git diff --check`：通过。
- `npm run build`：通过（15/15 静态页）。
- 用户浏览器实操验证：滚动跟随正常、无空白页、显示 web v0.9.2（用户确认 OK）。
- 本机复查：生产页面 HTTP 200、`x-nextjs-cache: HIT`、PID 36414。

### Notes
改动文件清单：
- `hooks/useAgentSession.ts`：新增导出 `AGENT_RUNNING_SPACER_PX`，scrollToBottom 回退公式同步（-4 移除）。
- `components/ChatWindow.tsx`：import 常量并用于 spacer 渲染。
- `progress.md`：追加本轮收尾记录。

回滚方式：`git revert 2c87601`；服务重启：`kill 36414 && PI_WEB_PASSWORD='...' PI_WEB_ALLOWED_HOSTS='...' pi-web`（任意目录，脚本自动切到当前项目）。

## 2026-08-04 - Task: 同步上游 v0.8.6 功能（供应商获取模型 + 常用小功能）

### What was done
- 对照上游 agegr/pi-web v0.8.6（0.7.16 之后 136 commits）做文件级差异分析，移植缺失功能：供应商获取模型（models-config/discover）、models.dev 定价预设（models-config/catalog）、以及常用小功能。
- 移植后端：`lib/model-discovery.ts`（模型列表 URL 构建/解析去重排序）、`lib/model-discovery-auth.ts`（ModelRuntime 解析 apiKey/headers）、`lib/model-catalog.ts`（models.dev 目录扁平化/搜索/推荐）、`app/api/models-config/discover/route.ts`、`app/api/models-config/catalog/route.ts`。
- 移植前端：ModelsConfig.tsx 新增 discover UI（导入模型按钮/筛选/多选/添加所选）与 catalog UI（填入模型信息/撤销），i18n 新增 22 条文案（zh-CN + en）。
- 小功能：中间键关闭文件 tab（TabBar onAuxClick）、Shift+Delete 跳过确认删会话（SessionSidebar performDelete + shift 分支）、markdown 本地图片预览（MarkdownBody img 组件 + file API）、?cwd= URL 参数直接打开指定目录新会话（AppShell 校验/状态/UI + lib/initial-navigation.ts）。
- 滚动跟随底部留白：scrollToBottom 加 `BOTTOM_KEEP_OUT_PX=32`，最后一条消息不再被 ChatInput 输入框遮挡。
- 排查确认本地已具备无需移植：proxy 环境变量支持（lib/http-dispatcher.ts EnvHttpProxyAgent）、SSE 多窗口优化（SessionSidebar 可见才轮询 + visibilitychange 暂停）。
- README.md 更新：功能表补充 discover/catalog，新增 2026-08-04 更新说明。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- 测试 21/21 通过：model-discovery（3）+ model-catalog（6）+ i18n catalog（3：中英文 key 一致/所有 t() 字面量可解析/无 useLanguage 遗留）+ ModelsConfig（9）+ MarkdownBody 等。
- `npm run build`：通过（含新路由 /api/models-config/discover、/api/models-config/catalog）。
- 服务启动验证：页面 200；discover API 校验正常（缺 providerName 返回 400）；catalog 的 models.dev 拉取在本沙箱返回 502，经 curl 证实为网络限制（沙箱访问不了 models.dev/openai，非代码问题），需在可联网环境验证。
- 滚动留白：需浏览器实操确认最后一条消息与输入框间距。

### Notes
改动文件清单：
- `lib/model-discovery.ts`、`lib/model-discovery-auth.ts`、`lib/model-catalog.ts`（新）：discover/catalog 核心逻辑，含上游测试。
- `app/api/models-config/discover/route.ts`、`app/api/models-config/catalog/route.ts`（新）：discover/catalog API 路由。
- `lib/initial-navigation.ts`（新）：?cwd=/session URL 参数解析。
- `components/ModelsConfig.tsx`：discover + catalog UI（导入模型/填入预设/撤销）。
- `components/TabBar.tsx`：中间键关闭 tab。
- `components/SessionSidebar.tsx`：Shift+Delete 跳过确认删除。
- `components/MarkdownBody.tsx`：本地图片预览（resolveLocalFileHref + file API）。
- `components/AppShell.tsx`：?cwd= URL 参数（校验/状态/UI）。
- `hooks/useAgentSession.ts`：滚动跟随底部留白 BOTTOM_KEEP_OUT_PX。
- `lib/i18n/messages/zh-CN.ts`、`lib/i18n/messages/en.ts`：新增 discover/catalog/删除/工作区文案。
- `lib/model-discovery.test.mjs`、`lib/model-catalog.test.mjs`（新）：上游测试移植。
- `README.md`：功能表与更新说明。

回滚方式：`git revert <commit>`；服务重启由用户命令行执行（本项目 `pi-web` 命令自动切到项目目录、加载 .env）。

## 2026-08-04 - Task: review 修复（?cwd= 错误面板 + 删除错误处理）

### What was done
- fresh review（提交 6454dd9）verdict=warn，3 个 medium：① AppShell `?cwd=` 校验失败时错误面板不渲染（sidebar 的 activeCwd 驱动 showChat 导致 error 分支被跳过）；② SessionSidebar Shift+Delete 忽略 HTTP 错误（fetch 不检查 res.ok 时 UI 卡在 deleting）；③ model-catalog 域名后缀匹配理论误判（经确认实际不可触发，降级不修）。
- 修复 ①：AppShell 加 `initialCwdPending`（validating/error 时抑制 showChat），`?cwd=` 校验中/失败时显示 validating/error 面板。
- 修复 ②：SessionSidebar performDelete 检查 `res.ok`，非 2xx 抛错进入 catch 复位 deleting。
- 提交 `75f4c55` 经本地代理 7897 推送到 GitHub。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- 测试 12/12 通过（i18n catalog 3 + model-catalog 6 + model-discovery 3）。
- `?cwd=` 错误面板行为需浏览器实操确认（访问无效路径应显示"无法打开此工作区"）。

### Notes
改动文件清单：
- `components/AppShell.tsx`：`initialCwdPending` 抑制 showChat，修复 `?cwd=` 错误面板不渲染。
- `components/SessionSidebar.tsx`：performDelete 检查 res.ok。

回滚方式：`git revert 75f4c55`。

## 2026-08-04 - Task: 安全审查修复（discover/catalog SSRF + 凭据落盘 + symlink 逃逸）

### What was done
- security_review（提交 6454dd9 全量）发现 1 个 CRITICAL + 1 个 HIGH + 1 个 MEDIUM + 1 个 LOW，全部修复：
  - **CRITICAL** `app/api/models-config/discover/route.ts`：新增 `isApiRequestAllowed` + `hasJsonContentType`（防跨站 text/plain 简单请求），baseUrl 限制 https 协议 + `isPrivateHost` 拦截内网/环回/链路本地（IPv4: 10/127/169.254/172.16-31/192.168/0/224+；IPv6: ::1/fe80/fc/fd/::），封堵 SSRF 与凭据外泄。
  - **HIGH** `lib/model-discovery-auth.ts`：临时 models.json 写入后 `chmodSync 0o600`，限制本机其他进程读取。
  - **MEDIUM** `app/api/cwd/validate/route.ts`：`realpathSync` 解析真实路径后才 `allowFileRoot`，封堵 symlink 逃逸（如 /tmp/x -> /etc）。
  - **LOW** `app/api/models-config/catalog/route.ts`：加 `isApiRequestAllowed`，防跨站触发缓存刷新。
- security_review 复查 verdict=pass（4 个 finding 全部妥善修复，仅 1 个 LOW 级 DNS rebinding 已知限制，风险可接受）。
- 提交 `d7681ee` 经本地代理 7897 推送到 GitHub。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- 测试 17/17 通过（model-discovery 3 + model-catalog 6 + i18n 3 + request-security 5）。
- security_review 复查通过。

### Notes
改动文件清单：
- `app/api/models-config/discover/route.ts`：请求防护 + https/内网限制。
- `app/api/models-config/catalog/route.ts`：请求防护。
- `app/api/cwd/validate/route.ts`：realpathSync 解析 symlink。
- `lib/model-discovery-auth.ts`：chmodSync 0600。

回滚方式：`git revert d7681ee`。

## 2026-08-04 - Task: 修复跟随对话时最新消息被输入框遮挡

### What was done
`scrollToBottom` 的滚动目标公式符号错误：`- BOTTOM_KEEP_OUT_PX` 使最后一条消息落在视口底部**以下** 32px，导致跟随滚动时消息被 ChatInput 挡住。改为 `+ BOTTOM_KEEP_OUT_PX`，使消息底部落在视口底部以上 32px（加上消息自身 margin ≈20px，总计约 52px），消息完全可见。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm test`：244/244 通过。
- 数学验证：修正后最后消息底部在视口底部以上 ~52px，ChatInput + SessionInfoBar 不遮挡。

### Notes
改动文件清单：
- `hooks/useAgentSession.ts`：`scrollToBottom` 公式第 1047 行 `- BOTTOM_KEEP_OUT_PX` → `+ BOTTOM_KEEP_OUT_PX`。

回滚方式：`git checkout -- hooks/useAgentSession.ts`。


## 2026-08-04 - Task: 重新部署（含 backup / settings-title-model 新功能）到命令行运行目录

### What was done
重新生产构建并部署到命令行运行目录：`~/.local/bin/pi-web`（包装脚本固定 cd 到本仓库执行 `bin/pi-web.js`），`.next` 已更新为最新构建（BUILD_ID=Bb7tZBeyMnHB3a_DWDT6M，版本 0.9.4）。新增路由 `/api/backup/export`、`/api/backup/import`、`/api/settings/title-model` 已注册。30141 端口空闲，`.env`（PI_WEB_PASSWORD / PI_WEB_ALLOWED_HOSTS）就绪，用户可自行 `pi-web` 命令启动。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm test`：264/264 通过（含 backup 与 settings-title-model 新增测试）。
- 构建产物验证：`.next/BUILD_ID` 存在，backup/settings 路由 server 产物存在。

### Notes
改动文件清单：
- `.next/`：重新构建的生产产物（gitignored）。

回滚方式：重新 `npm run build` 或 `git checkout -- .next`（产物由构建生成，源码未改动）。

### 待用户执行（沙箱无法写入 fnm 全局目录）
全局 npm 包仍是 `@agegr/pi-web@0.8.6`（官方上游包），需替换为用户自己的 `@qt4798/pi-web@0.9.4`（npm 上已发布）：
```bash
npm uninstall -g @agegr/pi-web
npm install -g @qt4798/pi-web@0.9.4
```
若 fnm 全局目录权限不足，前缀 `sudo`。替换后命令行 `pi-web` 仍优先解析 `~/.local/bin/pi-web`（指向本仓库源码），全局包替换用于消除旧版残留、使 `npx pi-web` 等场景也使用用户自己的版本。

## 2026-08-04 - Task: 安全修复后重新部署（含 builtin-model-overrides 新功能）

### What was done
security_review 发现的 HIGH（auto-name 路由无鉴权）与 3 个 MEDIUM（zip-bomb 解压放大、备份 token 无 TTL、不可信备份脚本落盘执行）由用户修复后，重新生产构建并部署到命令行运行目录（`~/.local/bin/pi-web` → 本仓库 `bin/pi-web.js`）。新构建 BUILD_ID=B6mrFjMIUEKt7afNu_rjS，版本 0.9.4。另新增 `/api/models-config/builtin` 路由（builtin-model-overrides 功能），经用户确认后补上 `isApiRequestAllowed` 鉴权（与已修复的 title-model 一致）后纳入构建。新构建含 `/api/backup/export`、`/api/backup/import`、`/api/settings/title-model`、`/api/models-config/builtin` 全部新路由。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm test`：276/276 通过（含 backup、settings-title-model、builtin-model-overrides 测试）。
- 产物验证：`.next/BUILD_ID` 存在；auto-name/settings/title-model/models-config/builtin 四个路由产物均含 `Access denied`（鉴权 403 分支已打包）。
- 配置存储位置确认：卸载全局 `@agegr/pi-web` 不影响配置——pi-web 配置/数据全部在 `~/.pi/agent/`（auth.json、mcp.json、models.json、settings.json、sessions/ 等），由 SDK `getAgentDir()` 解析，与全局 npm 包目录独立；`.env` 在项目目录，同样独立。

### Notes
改动文件清单：
- `app/api/models-config/builtin/route.ts`：补 `isApiRequestAllowed` 鉴权（本轮唯一源码改动）。
- `.next/`：重新构建的生产产物（gitignored）。

回滚方式：`git checkout -- app/api/models-config/builtin/route.ts` 撤销鉴权改动；重新 `npm run build` 重建产物。

### 待用户执行（沙箱无法写入 fnm 全局目录）
全局 npm 包仍是 `@agegr/pi-web@0.8.6`，可安全替换为用户自己的 `@qt4798/pi-web@0.9.4`（npm 上已发布）：
```bash
npm uninstall -g @agegr/pi-web
npm install -g @qt4798/pi-web@0.9.4
```
卸载 `@agegr/pi-web` **不会**删除任何配置：`~/.pi/agent/` 下所有配置（模型、会话、auth、mcp、settings）与项目 `.env` 均在包目录之外。若 fnm 全局目录权限不足，命令前缀 `sudo`。

## 2026-08-04 - Task: 补修 security_review 复审 warn 的 3 个残余问题并重新部署

### What was done
security_review 复审（warn）发现的 3 个残余问题全部修复后重新构建部署（BUILD_ID=OXKzHOwbmocashffYQJBT，版本 0.9.4）：
1. `app/api/models-config/route.ts` GET 补 `isApiRequestAllowed`（原 GET 无鉴权且返回含 `providers[].apiKey` 的 models.json，凭据泄露）。
2. `lib/backup.ts` parseBackupZip 改双累计：`declaredTotal` 按 header 声明预检（写盘前快速失败）+ `actualTotal` 按 `statSync` 实际字节累计兜底（防伪造声明绕过 1GiB 限制）。
3. `app/api/backup/import/route.ts` 缓冲 Map 加 `MAX_BUFFERED_BACKUPS=16` 硬上限，超限先清过期再逐出最旧。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm test`：277/277 通过（新增 aggregate cap 测试）。
- 产物验证：BUILD_ID 存在；models-config / models-config/builtin / auto-name / settings/title-model 四个路由产物均含 `Access denied`。
- security_review 复审 verdict=pass：3 个残余 finding 全部关闭，无剩余安全问题。

### Notes
改动文件清单：
- `app/api/models-config/route.ts`：GET 加鉴权。
- `lib/backup.ts`：解压总量声明预检 + 实际字节双累计。
- `lib/backup.test.mjs`：新增多条目声明累计超限测试。
- `app/api/backup/import/route.ts`：缓冲 Map 硬上限 16 + 最旧逐出。
- `.next/`：重新构建的生产产物（gitignored）。

回滚方式：`git checkout -- app/api/models-config/route.ts lib/backup.ts lib/backup.test.mjs app/api/backup/import/route.ts` 后重新 `npm run build`。

### 待用户执行（沙箱无法写入 fnm 全局目录）
全局 npm 包替换命令不变（卸载 `@agegr/pi-web` 不影响任何配置，见上一条记录）：
```bash
npm uninstall -g @agegr/pi-web
npm install -g @qt4798/pi-web@0.9.4
```

## 2026-08-04 - Task: 发布 v0.9.5（GitHub + npm）

### What was done
在安全修复与安装警告处理全部完成后发布 v0.9.5：
1. 修复 security_review 复审发现的 2 个新问题：localPackages 路径穿越（manifest 可控 name 直接 join 逃逸 agentDir，复用 isSafeBinScriptName 校验）；npm 包恢复改为预览展示 + 显式 opt-in（默认不自动安装，防恶意 postinstall）。
2. 安装警告处理：ERESOLVE（@emoji-mart/react peer react≤18 vs react 19，来自 @lobehub/ui→@lobehub/icons peer 链）与 allow-scripts（npm 11 新提示）经实测确认为提示性警告、不影响安装成功（added 871/872 packages）；package.json 增加 overrides + allowScripts 消除本项目构建环境警告，并在 README 增加安装提示说明。
3. 版本 bump 0.9.5，更新 CHANGELOG.md（0.9.5 段）、README.md（最新更新/功能表/安装提示）、README.en.md。
4. git commit 877f026 → push origin main（代理 7897）→ tag v0.9.5 → push tag。
5. npm publish @qt4798/pi-web@0.9.5（latest tag）。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm test`：279/279 通过（新增 unsafe local package name、npm opt-in 测试）。
- `npm run lint`：通过。
- release 构建：BUILD_ID=18J6_veq2yz9MszwxTCgp，版本 0.9.5。
- npm view 确认 registry 最新 0.9.5。

### Notes
改动文件清单（commit 877f026）：
- `app/api/backup/`、`components/BackupConfig.tsx`、`lib/backup.ts`、`lib/backup.test.mjs`：备份/恢复功能 + 安全加固。
- `app/api/settings/`、`lib/settings-title-model.ts`、`components/TitleModelSetting.tsx`：标题模型设置。
- `app/api/models-config/builtin/`、`lib/builtin-model-overrides.ts`：内置模型覆盖。
- `app/api/models-config/route.ts`、`app/api/sessions/[id]/auto-name/route.ts`：鉴权补齐。
- `lib/i18n/messages/zh-CN.ts`、`en.ts`：npm opt-in 文案。
- `package.json`、`package-lock.json`：版本 0.9.5、overrides、allowScripts。
- `CHANGELOG.md`、`README.md`、`README.en.md`：发布日志与说明。
- `progress.md`：本记录。

回滚方式：npm unpublish @qt4798/pi-web@0.9.5（72 小时内）；git revert 877f026 并删除远端 tag：`git push origin :refs/tags/v0.9.5`。

## 2026-08-04 - Task: 本地仓库改为测试环境（随机端口），命令行运行指向 npm 全局包

### What was done
按用户指示调整运行环境划分：
1. 本地仓库（pi-web-QT）不再作为命令行运行环境，仅作测试环境：`dev` / `dev:lan` / `start` / `start:lan` 全部改用随机端口（`-p 0`），启动日志打印实际地址，避免与命令行 pi-web（固定 30141）冲突。
2. 命令行运行环境改为 npm 全局安装的 `@qt4798/pi-web`（0.9.5）：fnm 全局 bin 与 multishell 软链均已指向该包（`@agegr/pi-web` 已卸载）；唯一遗留是 `~/.local/bin/pi-web`（指向本地仓库的遮蔽脚本，PATH 优先），需用户手动移除/改名。
3. 文档同步：README.md / README.en.md 开发段改为随机端口说明并注明"本地仓库仅测试"；AGENTS.md Quick Start 注释同步。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm test`：279/279 通过。
- `git diff --check`：通过。
- 随机端口实测：`npm run dev` 启动于 `http://127.0.0.1:64312`（非 30141），30141 端口空闲；测试进程已停止。

### Notes
改动文件清单：
- `package.json`：dev/dev:lan/start/start:lan 端口 30141 → 0（随机）。
- `README.md` / `README.en.md`：开发段随机端口说明 + 测试环境定位。
- `AGENTS.md`：Quick Start 注释更新。
- `progress.md`：本记录。

回滚方式：`git checkout -- package.json README.md README.en.md AGENTS.md`。

### 待用户手动执行（沙箱无法写入 ~/.local/bin）
```bash
mv ~/.local/bin/pi-web ~/.local/bin/pi-web.local-backup
```
移走后 `pi-web` 命令将解析到 npm 全局包（fnm multishell bin 软链 → @qt4798/pi-web@0.9.5）。验证：`command -v pi-web` 应显示 fnm multishell 路径；`pi-web` 启动于 30141。

## 2026-08-05 - Task: 克隆 pi-web-QT 仓库并初始化 lrnev 治理

### What was done
将 GitHub 仓库 https://github.com/t479842598/pi-web-QT 克隆到 E:\AI\项目开发\pi-web-QT（1585 个文件，HEAD 14a7ac7，工作树干净）。按仓库执行规范初始化 .lrnev 本地治理工作区，并补全 PROJECT.md 与 ARCHITECTURE.md 元数据（技术栈 Next.js 16 + React 19 + pi SDK 0.83、架构与关键设计约束均据 package.json 与 AGENTS.md 归纳）。

### Testing
- `git clone` 完成，`git status` 干净（`.lrnev/` 已由仓库 .gitignore 排除，不入库）
- `git log --oneline -1` 返回 14a7ac7，remote 指向 origin
- `.lrnev/PROJECT.md`、`.lrnev/ARCHITECTURE.md` 存在且已替换全部 FILL 哨兵

### Notes
改动文件清单（均在克隆内容之外新增）：
- `.lrnev/PROJECT.md`（新）：项目目标/范围/约束，lrnev 治理元数据
- `.lrnev/ARCHITECTURE.md`（新）：技术栈/模块/数据流/关键设计约束
- `progress.md`：末尾追加本轮记录
回滚方式：删除 `E:\AI\项目开发\pi-web-QT` 目录后重新 `git clone`；`.lrnev/` 为本地治理数据，不参与 git，删除不影响仓库。

## 2026-08-05 - Task: 修复备份导入 413（10MB body 限制）

### What was done
拉取最新版（083a47e → f3a289f，含 backup import 413 修复与 undici 8.10.0 升级），同步 npm 依赖后，用 mac 导出的 pi-backup-2026-08-05T04-57-18.zip（16MB）复现导入失败：HTTP 413 "Failed to parse form data"，dev 日志出现 "Request body exceeded 10MB for /api/backup/import"。根因：proxy.ts 匹配 /api/*，Next.js 16 克隆 proxy 请求体默认上限 10MB，16MB 备份被截断导致 FormData 解析失败。修复：next.config.ts 增加 experimental.proxyClientMaxBodySize: "600mb"（与导入路由 MAX_UPLOAD_BYTES=512MB 匹配）。修复后上传同一 zip 返回 HTTP 200 preview，无截断警告。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- 修复前复现：curl -F 上传 16MB zip → HTTP 413 + 日志 "Request body exceeded 10MB"。
- 修复后验证：同一 curl 上传 → HTTP 200，返回 preview JSON（manifest 正确解析 darwin 平台备份，token 已缓存）。

### Notes
改动文件清单：
- `next.config.ts`：新增 `experimental.proxyClientMaxBodySize: "600mb"`（proxy 克隆请求体上限，默认 10MB）。
- `docs/deployment.md`：新增"备份导入大小"说明节。
- `progress.md`：本记录。
- `package-lock.json` / `node_modules`：随 git pull 同步依赖（undici 8.10.0，postinstall 脚本生效）。

回滚方式：`git checkout -- next.config.ts docs/deployment.md`；依赖回滚用 `git checkout -- package-lock.json && npm install`。

## 2026-08-05 - Task: UI/导入功能修复（内置模型保存、备份按钮、reasonix 导入、项目选择）

### What was done
1. 内置供应商模型配置：用户确认可修改；实测发现保存副作用 bug——overlay 只写 {id, contextWindow} 时 SDK 按 id 整体替换模型条目，导致 name 丢失、reasoning 变 false、maxTokens 被重置为 16384。修复 BuiltinModelsDetail.handleSave：保存时补齐 name/reasoning/maxTokens/thinkingLevelMap 全部字段，实测保存后模型信息完整保留。
2. 导入备份控件：BackupConfig 中原生 file input（无按钮外观，宿主内像纯文字）改为 display:none input + 自定义按钮（Upload 图标 + 点击触发），新增 i18n 键 backupImportButton（选择备份文件 / Choose backup file）。
3. Reasonix 会话导入：Windows/CLI 平铺布局 ~/.reasonix/sessions/*.jsonl 此前不被识别（仅支持 mac 的 ~/.reasonix/projects/<p>/sessions），导致 UI 上 reasonix 选项 unavailable 而无法点击。lib/import-sources.ts 新增平铺布局发现（按文件名前缀分组）与统一解析 reasonixProjectSessions()；parseReasonixFilename 对非 mac 命名容错（回退文件 mtime，provider/modelId=unknown）；import-executor 平铺项目 cwd 回退 homedir()。实测 discover available=true（43 会话）、单文件导入成功。
4. 左侧项目选择：AppShell 左上角 workspace 项目选择模块改为始终显示（showWorkspaceControls=true）；SessionSidebar 侧边栏 CWD picker 仅在无 portal host 时兜底显示；无项目占位文案 "Select project…" 硬编码英文改为 i18n t("desktop.selectProject")（中文"选择项目…"）。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- `node_modules/.bin/eslint`（7 个改动组件/lib 文件）：0 errors；仅 lib/import-sources.ts 4 条原有未用 import 的 warning（非本轮引入，未清理）。
- `git diff --check`：通过。
- dev server 实测（端口 17300）：
  - PUT 完整模型 overlay 后 GET /api/models-config/builtin?provider=deepseek：name/reasoning/maxTokens/thinkingLevelMap 全部保留，contextWindow=900000 生效（修复前 name 丢失、reasoning=false、maxTokens=16384）；models.json 已恢复。
  - GET /api/import/discover：reasonix available=true，发现 code(1)/desktop(41)/subagent(1) 共 43 会话。
  - POST /api/import/execute（projects=["code"]）：job done，imported=1 errors=0，生成 ~/.pi/agent/sessions/--code--/ 会话文件（cwd=C:\Users\t0005，时间戳取 mtime）；测试产物已删除。
  - 16MB 备份导入（proxyClientMaxBodySize 修复）此前已验证 HTTP 200。

### Notes
改动文件清单：
- `components/BuiltinModelsDetail.tsx`：保存 overlay 补齐 name/reasoning/maxTokens/thinkingLevelMap；useCallback 依赖补 models。
- `components/BackupConfig.tsx`：导入文件选择改为隐藏 input + 自定义按钮。
- `lib/i18n/messages/zh-CN.ts` / `en.ts`：新增 desktop.backupImportButton。
- `lib/import-sources.ts`：新增 reasonixSessionsFlatDir()/reasonixProjectSessions()；listImportSources/discoverReasonix 支持平铺布局。
- `lib/import-reasonix.ts`：parseReasonixFilename 容错（fallbackTimestamp），convertReasonixFile 传文件 mtime。
- `lib/import-executor.ts`：改用 reasonixProjectSessions；平铺项目 cwd=homedir、文件名时间戳=mtime；删除孤儿 isMainRsFile。
- `components/AppShell.tsx`：showWorkspaceControls 恒为 true（左上角项目选择一直显示）。
- `components/SessionSidebar.tsx`：侧边栏 CWD picker 仅无 host 时兜底；占位文案改 i18n。
- `next.config.ts` / `docs/deployment.md` / `progress.md`：上一轮备份导入 413 修复的记录（本轮验证通过，未再改动 next.config.ts）。

回滚方式：`git checkout -- components/BuiltinModelsDetail.tsx components/BackupConfig.tsx lib/i18n/messages/zh-CN.ts lib/i18n/messages/en.ts lib/import-sources.ts lib/import-reasonix.ts lib/import-executor.ts components/AppShell.tsx components/SessionSidebar.tsx`。

## 2026-08-05 - Task: 发布 0.9.8（README 更新 + git tag + npm publish）

### What was done
用户指示：npm 无法覆盖已发布的 0.9.7（registry 上 2026-08-05 05:50 已发布，npm 禁止同版本覆盖），故全部改为 0.9.8：package.json/package-lock.json 版本号 0.9.7 → 0.9.8；项目页面标识（ChatWindow 的 web v0.9.8）与 npm tag 自动跟随；README「最新更新（2026-08-05）」补充本轮四项修复说明；git commit + tag v0.9.8 + push origin；npm publish @qt4798/pi-web@0.9.8。

### Testing
- 全量测试：node --experimental-strip-types --test（279 项）→ 277 通过，2 失败；经 git stash 基线验证，MarkdownBody（表格渲染）与 directory-browser（POSIX/Windows 路径）两个失败在改动前即存在，非本轮引入。
- `node_modules/.bin/tsc --noEmit` 通过；eslint 改动文件 0 error；git diff --check 通过。
- dev server 实测：16MB 备份导入 200；builtin 模型保存字段完整保留；reasonix discover available（43 会话）+ 单文件导入成功。

### Notes
改动文件清单（相对上一轮）：
- `package.json` / `package-lock.json`：version 0.9.7 → 0.9.8。
- `README.md`：最新更新节补充备份导入/内置模型/Reasonix 导入/项目选择四项修复。
- `progress.md`：本记录。

回滚方式：`git reset --hard HEAD~1 && git tag -d v0.9.8 && git push origin :refs/tags/v0.9.8`（若已推送）；npm 侧已发布的 0.9.8 无法覆盖，只能发布更高版本。

## 2026-08-05 - Task: 修复两个既有失败测试（提交前收尾）

### What was done
用户要求先修复测试失败再提交。定位并修复两个预先存在的失败：
1. lib/directory-browser.test.mjs "finds parent directories across POSIX and Windows paths"：getParentDirectory 对 POSIX 风格路径（/ 开头、非盘符）在 Windows 上误用 win32 API，返回 \Users\alex 而非 /Users/alex。修复：/ 开头路径改用 path.posix。
2. components/MarkdownBody.test.mjs "renders quoteable table rows without inline elements under tr"（及同文件的 Prism 源码结构测试）：工作区文件被 git 按 core.autocrlf 转成 CRLF（仓库无 .gitattributes），测试用 \n 匹配源码结构失败（indexOf 返回 -1）。修复：测试读取源码后统一 .replace(/\r/g, "") 归一化行尾。

### Testing
- 两个测试文件单独运行：12/12 通过。
- 全量 `node --experimental-strip-types --test`（279 项）：279/279 通过（此前 277/279）。
- `node_modules/.bin/tsc --noEmit`：通过。
- `node_modules/.bin/eslint`（改动文件）：0 error。

### Notes
改动文件清单：
- `lib/directory-browser.ts`：getParentDirectory 对 POSIX 路径使用 path.posix。
- `components/MarkdownBody.test.mjs`：两处 readFile 后行尾归一化。

回滚方式：`git checkout -- lib/directory-browser.ts components/MarkdownBody.test.mjs`。

## 2026-08-05 - Task: 发布 0.9.8 完成（build 问题处理 + npm publish）

### What was done
GitHub 已推送 d8c3832（main + tag v0.9.8）。npm 发布前发现 build 障碍并解决：
- `next build --webpack` 在 Windows 上失败：EPERM scandir 用户目录（Cookies / Application Data junction）——Next 16 webpack 构建的 output file tracing（@vercel/nft）会静态执行 `lib/file-access.ts` 的 `readdirSync(homedir())`，Windows 上扫到受保护 junction 报错。Next 16 已移除顶层 `outputFileTracing: false` 开关，不可配置关闭。
- 改用 Turbopack build（`next build`，不经 nft）：构建成功。
- 生产模式实测（next start，端口 15795）：16MB 备份导入 HTTP 200；/api/import/discover reasonix available=true（43 会话）。
- `npm publish`：@qt4798/pi-web@0.9.8 发布成功，registry latest=0.9.8（npm 无法覆盖 0.9.7，按用户指示升 0.9.8）。

### Testing
- Turbopack `next build`：成功（.next/BUILD_ID 生成，含 middleware 即 proxy）。
- next start 生产模式：备份导入 200 + reasonix discover 正常（见上）。
- registry 验证：dist-tags.latest=0.9.8，versions 含 0.9.8。
- 全量测试 279/279、tsc、eslint 均通过（见上一轮）。

### Notes
- 未改 package.json 的 build script（保持 `env -u TURBOPACK next build --webpack`，作者 mac 环境可用）；Windows 本地构建/发布请用 `next build`（Turbopack）。
- 改动文件：`progress.md`（本记录）。
- 回滚：npm 0.9.8 已发布不可撤回（可发 0.9.9）；git 回滚 `git reset --hard d8c3832~1`。

## 2026-08-05 - Task: v0.9.8 Release + 安全修复 + 发布 0.9.9

### What was done
1. GitHub Releases 停在 v0.9.3 的原因：Release 不随 tag 自动生成。用 git 凭据管理器 token（git credential fill，未回显）通过 GitHub API 创建 v0.9.8 Release 成功。
2. review 审查发现两个 should-fix 并修复（lib/import-sources.ts）：reasonixProjectSessions 拒绝含路径分隔符/`.`/`..` 段的 projectName（防路径穿越逃出 ~/.reasonix，输入来自 POST /api/import/execute 请求体）；发现层 PI_SESSIONS_DIR 改用 getAgentDir() 与写入层统一（兼容 PI_CODING_AGENT_DIR）。
3. github.com 直连被网络阻断（api.github.com 正常），用户确认使用本地代理 7890（Clash 混合端口），设置仓库级 git http.proxy 后推送成功。
4. 用户确认 npm 发布 0.9.9（0.9.8 已发布不可覆盖，安全修复随 0.9.9 发布）：npm version 0.9.9 --no-git-tag-version + Turbopack next build + tag v0.9.9 + npm publish + v0.9.9 Release。

### Testing
- `node_modules/.bin/tsc --noEmit`：通过。
- 全量 node --test：fail 0（279 项）。
- Turbopack `next build`：成功（含 proxy middleware）。
- git push（代理 7890）：8949968..f91cd41 成功。
- 代理验证：curl -x http://127.0.0.1:7890 https://github.com → HTTP 200。

### Notes
改动文件清单：
- `lib/import-sources.ts`：projectName 路径穿越校验 + PI_SESSIONS_DIR 用 getAgentDir()。
- `package.json` / `package-lock.json`：version 0.9.8 → 0.9.9。
- `progress.md`：本记录。

回滚方式：`git reset --hard f91cd41~1`；npm 0.9.9 已发布不可撤回。

## 2026-08-07 - Task: 覆盖回线上版本（qt/beta v0.9.17-beta.3）并重新适配 Reasonix 导入

### What was done
本地 main 此前含 90 个 fork 提交 + 未提交的 APPDATA 适配补丁（lib/import-sources.ts），且混入了 origin/main 合并（6b75ae3）。按用户要求：先记录适配方案，再把线上版本拉取覆盖本地，最后重新适配导入。

1. 记录：`docs/reasonix-import-adaptation.md`（完整适配历史 + APPDATA 补丁说明）+ lrnev 记忆 patterns-246e34011353。
2. 备份：`git branch backup/pre-reset-20260807`（含未提交 APPDATA 补丁的完整工作树，可无损恢复）。
3. 覆盖：`git fetch qt && git reset --hard qt/beta`（= fc5fe82, v0.9.17-beta.3，即线上运行中的 @qt4798/pi-web 版本；origin/main 上游 v0.8.7 无导入功能）。
4. 重新适配：重放 patch_import_sources.py 时发现两个问题——
   - 脚本 Python 转义 bug：`[\/]` 被解析成单反斜杠，与 TS 源码双反斜杠永不匹配（已修复）；
   - 脚本只覆盖 2 个函数，而完整适配共 5 处改动（reasonixHomeDirs 定义、多根遍历、docstring、import 精简），单独运行会产生引用未定义 reasonixHomeDirs 的坏文件。
   最终直接 `git restore --source=backup/pre-reset-20260807 --worktree -- lib/import-sources.ts` 恢复完整适配。

### Testing
- `tsc --noEmit` 全量 0 错误
- 运行时冒烟：discoverReasonix() available=true，从 %APPDATA%/reasonix/projects 发现 75 会话
- 本机 ~/.reasonix 只有 locks，数据全在 %APPDATA%\reasonix —— 无 APPDATA 适配则导入不可用

### Notes
- lib/import-sources.ts 当前为未提交修改（相对 qt/beta +314/-278）
- 恢复点：backup/pre-reset-20260807（含原 6b75ae3 合并状态）
