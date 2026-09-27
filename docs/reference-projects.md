# 参考项目可借鉴功能清单

来源：2026-09-27 对两个外部项目的调研。**本文件只是候选清单，不含实现承诺**；采纳时按 pi-web 的 spec 流程单独立项。

---

## 一、PI-Desktop（vastsa/PI-Desktop）

Electron + Rust host core + pi Agent Harness，0.15.x。技术栈与 pi-web 差异大（Rust 核心、独立进程插件），但交互设计与数据契约层面有可直接借鉴之处。

### 1. 整体信息架构 / 布局

- **三栏可调 Shell** — 275px 侧边栏（240–520 可拖，拖到 <160 自动折叠）+ 主区 + 右侧 Work Panel（in-flow dock 而非 overlay，≥244px）；主聊天列 760px 可调、硬下限 450px，空间不足先挤侧边栏。纯 CSS flex + 拖拽宽度，Web 可照搬。**可移植性：高**
- **Work Panel 会话级上下文保留** — 每个 session 独立保存 open 状态 / 标签集 / 激活标签 / 浏览器资源，切会话只换投影不销毁；后台产出的 artifact 只更新其来源会话的保留上下文，**绝不自动打开或改变宽度**。逻辑与渲染解耦，可原样移植。**高**
- **目的地页面化 + 懒加载** — Settings / Plugins / PR / Scheduled 是整页替换主区（非 modal），路由级 lazy chunk，聊天与 shell chrome 留在首屏 bundle。**高**
- **会话 Pane 保留** — 同时挂载可见 + 最近 2 个 SessionPane，隐藏用 `visibility: hidden` + `content-visibility`（**不能 `display: none`，会丢 scroll offset**），切回是 visibility swap 而非重建。Web 内存成本需按设备降级。**中**

### 2. 会话管理

- **双区侧边栏 + path-keyed 项目组** — Sessions（无项目会话，最多 5 行）+ Projects（每项目独立折叠 / 拖拽排序 / 多文件夹 root）；pin 是全局置顶、archive 非破坏可恢复；时间分组 today/yesterday/thisWeek/older14d/archived，每项目默认 10 行后 "Load N more"。**高**
- **会话全文搜索** — Rust FTS5 三元组索引消息正文 + 主机侧 Unicode lowercase 校验短查询，命中高亮映射回原文（含大小写膨胀字符），分页 controller 按查询 generation 归属异步。Web 版用 SQLite FTS 或 Postgres tsvector 即可。**高**
- **Session Fork / Branch** — `session.fork` 带 throughMessageId，子会话获得独立完整 transcript，成功后选中子会话并聚焦 composer，失败保持源会话不变。**中**
- **破坏性操作两段确认** — 删除先 arm 再点第二次（arm 会自动过期），archive 不动 transcript，重命名限 1–80 code points；会话草稿按 session 缓存在模块级 Map（含 home 槽位），发送只清自己那份。**高**

### 3. Agent 交互层

- **结构化工具展示** — 工具结果不是裸 JSON，而是带语义 role 的 blocks：`command` / `stdout` / `stderr` / `diff` / `files` / `matches` / `fields` / `note` / `error`，统一渲染标题、复制按钮、点击预览，权限卡复用同一套。**高**（pi-web 当前最可能的短板）
- **消息级 Review 卡 + 回滚** — 每次 Write/Edit 在 host 侧落一份不可变快照（旧内容存在 workspace 之外，commit 也擦不掉），卡片展示 hunk 与增删计数，可回滚且用 post-tool hash 守卫冲突。需要服务端快照存储。**中**
- **Thinking 分级 + 过程分组** — detailed/compact 两档显示；TurnProcess 把一轮里的 thinking / 工具 / 子代理折叠成组，含自动展开规则、耗时、失败态；7 档 thinking level 用滑块选。**高**
- **Composer 交互套件** — `@` 文件引用（host 索引 + fuzzy）、`/` 命令按 template/builtin/plugin/extension/skill 分组且第二 token 只出 Skills、图片附件以 chip 形式留在文本外、中文 IME 的 `、` 自动改写为 `/`、大段粘贴转引用、Sparkles 一键增强 prompt 且可 Undo、`Alt+Enter` 中途 steer 当前轮、发送队列 FIFO + Send now、Smart Stop 未产出时恢复草稿。**高**（每条都小、独立、用户可感知）
- **流式与导航** — 增量 markdown 解析（不整段重渲）、100ms 节流自动滚动、首个上滑手势立即脱离 follow mode、中断保留 partial 并可 Continue、ConversationMinimap 用 dash 堆叠 + dock 式余弦放大 + hover 预览跳转。**高**（minimap 中）

### 4. 插件系统

- **manifest 贡献点 + 权限清单** — 一个 `manifest.json` 声明 commands / panels / widgets / views / agentTools / skills / themes / mcpServers / services / bus / agentExtensions；插件入口跑独立 Node 进程，panel 是 sandbox 窗口只暴露 `window.pluginBridge`，调用过 host 权限网关，未声明或未授权一律 `PERMISSION_DENIED`；权限按 low/med/high 分级，`fs` scope glob 与 `net.domains` 白名单双双 fail-closed。Web 端可用 iframe sandbox + postMessage 复刻 bridge。**中**
- **插件即 Agent 能力** — 插件可注册模型可调工具（namespaced、带 risk、110s 超时、Plan 模式禁用、经正常权限管线与审计）、贡献 Skill 文档（按需读正文）、以及 `ExtensionAPI` 模块直接在 agent 进程内挂 tool / slash command / hook（高权限、明确未沙箱）。工具 + Skill 两项 Web 版可完整实现。**中/高**
- **打包与分发** — `.piplug` 是 store-only ZIP（≤2000 文件 / 50MiB），`pi-plugin check/pack/publish` 带 SHA-256、git commit pin、幂等 submission；marketplace 四源切换（official / GitHub / CNB / 自定义 URL），host 侧校验安装。Web 版换成 npm/CDN + 同一套校验审查。**高**
- **开发体验** — 4 个模板脚手架（panel-basic / agent-tool-basic / skill-pack / full-demo）、dev plugin 热重载（300ms debounce、最多 16 个）、权限变更阻止热重载要求重新授权。**中**

### 5. 模型管理

- **发现优先的 Provider 表单** — Name/BaseURL/Key 同屏（非 wizard），先问服务端 `/models`，models.dev 只做 enrich，空结果才退回内置 catalog；自定义 model ID 永远接受；600ms debounce + 单调请求序列防乱序，缓存列表先画再被 live 结果替换。**高**
- **选择顺序即数据** — 已选模型是一个有序 binding 数组，拖拽或键盘上下移动，第一个 binding 同步为 provider default，过滤只隐藏不改变顺序；每模型 Advanced 里放 context/output/thinking levels/wire API style。**高**
- **用量与上下文检查器** — 环形占用 + 输入/输出/cache read 命中率/cache write/reasoning/工具 token 聚合/吞吐，compaction 记录占用；`formatCompactTokenCount` 单点实现避免各处四舍五入不一致。**高**
- **OAuth 厂商账号** — PKCE 本地回调、device code、粘贴 code 三种流程走同一事件流，一个 dialog 渲染厂商要什么就显示什么，支持同厂商多账号。**中**

### 6. 其他亮点

- **MCP 市场 + 手工编辑** — 内置 catalog + Official Registry + 自发布 Catalog JSON 三源合并，registry 失败仍显示内置；安装时弹必填密钥表单，写入 env/header；`My servers` 接受 http 并对非加密连接显式警告。**高**
- **统一 Scope 控件** — Plugins / MCP / Skills 三者共用一个「开/关 + Global/Project 作用域」控件，用户学一次。多项目场景直接受益。**高**
- **Subagent 可检查性** — 子代理在 transcript 里是拓扑节点（含委派链、耗时、结果），Work Panel 里可开只读的 subagent transcript tab（完整对话但无发送框）。**中**
- **Session Orchestrator** — 跨会话协作：spawn/send/list/status/result/cancel，消息与回执在 host 侧记账，插件只能经网关调用。是子代理之上的升级路径。**中**
- **持久化与通知** — transcript 每会话一个 JSONL（可读、可 grep）+ SQLite 只做索引（含 FTS）；渲染端只留 5 个快照 + trailing window（首屏 15 行、稳态 60、每次 +40）；通知是 host 持久化 inbox，只展示 failed、点击恢复窗口并激活会话，aborted 不入库。**高**（思路）
- **其他可选项** — 定时任务（hourly/daily/weekly/manual + 每任务 project/model/permission + 100 条运行历史）、WebDAV 加密配置同步（只同步偏好/技能/项目，明确不含对话）、SSH 远程 pi-host 配对、从 claude-code/opencode/codex/pi 导入会话与模型配置、可自定义快捷键（含冲突检测与 Unbound）、插件全局启动器（Option+Space）。多为**中/低**。

> 注意：`docs/plugin-development.md` 提到 work panel 里 "Review, Terminal, Browser, Files" 并列，但 0.15 源码 `lib/work-panel-tabs.ts` 的 `WorkPanelTabKind` 只有 new/review/file/plugin/subagent —— 没有 Terminal 视图，别按文档去找。

### 最值得抄的 Top 5

1. **Work Panel（会话级多标签 dock）** — 三栏 shell 里投入产出比最高的一块，其「后台产物不改动可见面板」的规则能根治多会话并行时的焦点抢夺。
2. **结构化工具展示 blocks** — 工具调用可读性最可能的短板，语义 block 模型可直接套在消息组件上。
3. **Composer 交互套件** — 每条都小、独立、用户可感知。
4. **侧边栏信息架构 + FTS 全局搜索** — 直接决定多项目可用性。
5. **插件 manifest 权限 / 作用域模型** — 即使先只实现 iframe panel + agent tool + skill 三类贡献，「声明式权限 + fail-closed scope」这套契约值得一次定对。

---

## 二、ZCode（本地源码 `zcode-selfhost/upstream`）

调研时用于对齐本次侧边栏与布局改造，实测数据如下（源码路径相对 `packages/ui/src/`）。

### 侧边栏实测规格

| 项 | ZCode 实现 | 出处 |
|---|---|---|
| 默认宽度 | 264px（下限也是 264，上限 = 容器宽 × 0.5） | `app-shell/WorkspaceShellLayout.tsx:99-107` |
| 键盘微调 | 步长 16px，支持 Home/End/Arrow | 同上 `:645-706` |
| 宽度持久化 | localStorage `zcode:workspace-shell:sidebar-width-px` | 同上 `:102` |
| 收起宽度 | 4px（**不是 icon rail**；`WorkspaceSidebarCollapsedRail.tsx` 是死代码） | 同上 `:354` |
| 拖拽手柄 | 自绘 `role="separator"`，4px 透明热区 + hover 才显形的 2px 圆角线 | 同上 `:1611-1635` |
| 拖拽实现 | 拖动期间**直接写 CSS 变量**不 setState，pointerup 才提交并落盘 | 同上 `:531-557` |
| 顶部顺序 | 新建任务 → 搜索按钮 → 自动化 → 插件市场 | `WorkspaceSidebar.tsx:1275-1336` |
| 搜索形态 | **不是输入框**，是 ghost 按钮开 Command Center（⌘K / ⌘⇧P） | `command-center/CommandCenterDialog.tsx` |
| 项目行 | 高 32px、`rounded-lg`(8px)、`pl-2.5 pr-1`、16px 图标 | `WorkspaceSidebarItem.tsx:826-830` |
| 会话行 | 单行 `rounded-lg pl-2.5 pr-1 py-1`；timeline 变体两行 | `TaskListItem.tsx:543-550` |
| 组内缩进 | 34px（`pl-8.5`） | `TaskList.tsx:436,471` |
| 行状态 | 运行中 16px 转圈、未读 6px 蓝点、错误 6px 红点 | `TaskListItem.tsx:583` |
| 归档确认 | 二次点击（首次变 Confirm，Esc/点外部取消） | `TaskListItem.tsx:180-207` |
| 分区标题 | 高 28px、`px-2.5`、chevron 默认 `opacity-0`（hover 才显形） | `WorkspacePurposeSection.tsx:48-58` |
| Footer | 头像 + 用户名 + 套餐徽标 / 右侧远控 + 设置齿轮；**用量不是常驻进度条** | `WorkspaceSidebarFooter.tsx:217-399` |
| 图标库 | `lucide-react`（默认 `size-4`，行内 `size-3.5`） | `packages/ui/package.json` |

### 布局框架（本次已采纳）

ZCode 的 `WorkspaceShellLayout.tsx` 结构：

```
外层（外壳底色 bg-background-win-alt）
├── 侧边栏列（w-[--workspace-sidebar-panel-width]，透出外壳底色，无 border-right）
└── 主区容器（bg-background + rounded-[--workspace-panel-radius] + border）
    ├── 标题栏（WorkspaceHeader）
    ├── 对话列（section bg-background）
    └── 右侧面板（rounded + border 的卡片）
```

- 面板圆角 `--workspace-panel-radius`：Mac Tahoe 26+ = 12px、旧 Mac = 6px、Windows = 5px、其他 = 12px（`workspaceShellWindowChrome.ts:18-33`）
- 侧边栏右边界**无 border**，仅靠 4px 分隔条（hover 才显形）
- 响应式：**没有移动端断点/抽屉实现**（手机端是独立远控页复用同一 bundle），只有「窗口 resize 后 conversation 列 < 360px 自动收起侧栏、< 480px 自动收起右侧面板，延迟 300ms 判定」

### 其他可移植的交互点

1. **宽度拖拽用 CSS 变量 + 释放时提交** — 拖动期间零 React 重渲染，Web 上性能收益同样明显。
2. **`role="separator"` 的 4px 手柄 + hover 才显形的 2px 视觉线 + 键盘 Arrow/Home/End** — 可访问性与观感成本极低。
3. **「窗口变窄自动收起侧栏」策略** — 以主内容区实际宽度（<360px）而非视口宽度触发，且只在 resize 停止 300ms 后判定，避免抢用户手动打开的面板。
4. **会话行二次点击确认归档** + hover 才挂载操作按钮（`hover: none` 触屏常驻）。
5. **折叠/排序偏好全部落 localStorage 且带 schema 校验与降级** — Next.js SSR 下需改成 `useEffect` 内读取以避免 hydration mismatch，存储结构与默认值逻辑可直接复用。

### 快捷键（`packages/shared/src/shortcutCommands.ts`）

⌘B 切侧栏 / ⌘K、⌘⇧P 命令面板 / ⌘N 新建任务 / ⌘O 打开项目 / ⌘F 会话内查找 / ⌘J 终端 / ⌘⌥B 右侧面板 / ⌘⇧[ ] 上/下一个会话 / ⌘[ ] 历史前进后退 / ⌘, 设置。分发在 `hooks/useAppKeyboard.ts`（window capture 阶段，IME/长按过滤），改键存 setting.json。

### 状态与数据流

| 状态 | 位置 | 跨设备同步 |
|---|---|---|
| 显隐 | `useAppPanels` 组件 state | 否 |
| 宽度 | localStorage `zcode:workspace-shell:sidebar-width-px` | 否 |
| 视图/排序 | localStorage `zcode-sidebar-task-preferences` | 否 |
| 分区折叠/顺序 | localStorage `zcode-sidebar-purpose-section-preferences` | 否 |
| 项目展开 | localStorage `zcode-workspace-expansion` | 否 |
| 项目 tab 顺序 | zustand tabStore → settingService | **是** |
| pin/归档/重命名 | 服务端 sqlite（乐观更新 + 回滚） | **是** |
