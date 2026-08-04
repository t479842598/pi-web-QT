# 进度日志

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

