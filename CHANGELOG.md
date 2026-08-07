# Changelog

## v0.9.17-beta.3 — 2026-08-07

### 修复
- **标题生成 524 超时** — 会话正在运行时点「生成标题」会无限等待会话空闲，超过 Cloudflare 100 秒网关超时返回 524。现在等待空闲最多 10 秒后直接用当前对话快照生成，模型调用超时收紧到 80 秒，总时长稳在 100 秒内。
- **默认协作模式改为常规** — 新对话默认任务模式改为「常规」，不再继承之前的「计划」。
- **任务看板开关实时生效** — 在设置-功能里关闭/打开任务看板后立即同步顶部入口与看板视图，无需刷新页面；刷新后当前对话正常恢复。
- **settings.json 并发写保护** — 模式、功能开关、标题模型三个设置模块共用 settings.json，写入增加文件锁（proper-lockfile + 原子写），避免并发保存时互相覆盖丢失配置。

### 新增
- **设置-功能页新增模式默认项配置** — 可配置默认任务模式（常规 / 计划 / 目标）、默认运行档位（轻量 / 均衡 / 交付，默认均衡）、默认工具权限（批准 / 自动 / Yolo），保存后已打开的对话立即生效、新对话自动继承。

## 0.9.17-beta.2 — 2026-08-06

### 新增
- **对话框模式系统**（移植自 Reasonix）— 输入框工具栏新增三组模式控件：
  - **任务模式（常规 / 计划 / 目标）**：常规边做边推进；计划为只读分析并产出计划、完成后弹出确认卡（开始执行 / 提出建议 / 退出计划）；目标为输入目标后自动持续推进，带轮次预算（默认 10 轮）、无进展检测（连续 4 轮无进展自动暂停）、运行条实时显示进度，可暂停 / 恢复 / 结束。
  - **运行档位（轻量 / 均衡 / 交付）**：轻量收窄工具集为白名单并注入省 token 指令；均衡为默认完整工具；交付注入强制验收指令（先立验收标准、复现、验证、复查 diff）。
  - **工具权限（批准 / 自动 / Yolo）**：PC 端常显三段按钮，对话中可随时切换。选择 Yolo 时输入框显示红色警示边框。
- **工具调用审批（真拦截）** — 权限模式为「批准」时，agent 的写类工具调用（写文件 / 编辑 / 非只读命令等）在真正执行前挂起，弹出来自输入框上方的审批卡：可查看工具名与参数、允许、拒绝、附理由拒绝；并行工具批次逐个审批；120 秒无响应自动拒绝。权限规则（deny > ask > allow）持久化到 `~/.pi/agent/settings.json`，支持 `ToolName` / `ToolName(glob)` / `Bash(command:*)` 规则，可在设置中编辑。
- **模式与权限持久化** — 三组模式选择与权限规则保存到 `settings.json`（`modes` 键），刷新页面与新建会话自动继承；可通过 `/api/modes` 接口读写。
- **Yolo 模式红色警示** — 选择 Yolo（跳过普通审批）时输入框外圈变红，直观提醒当前处于高权限模式。
- **长粘贴自动折叠** — 粘贴超过 2000 字符或 20 行的大段代码时，自动折叠为 `[已粘贴文本 #N · X 行]` 占位卡（可预览 / 删除），输入框保持轻量不卡顿；发送时自动展开为完整文本交给 agent。
- **标题失败气泡 + 换模型弹窗** — 自动生成标题失败时，在会话行右侧弹出气泡显示失败原因，提供「重试」与「换模型」（弹出模型选择弹窗，按 provider 分组，选中后保存并自动重试）。

### 修复
- **Markdown 渲染 hydration 错误** — 移除 `rehypeRaw`：粘贴含原始 `<p>` / `<div>` HTML 的错误日志等消息不再被解析成块级元素嵌套进段落，根治「`<p>` cannot be a descendant of `<p>`」等 8 类 hydration 报错；`pre` / `code` 块级渲染改用 `<div>` 包裹并收紧块级判定，`p` 组件自动检测块级子元素降级为 `div`。
- **消息气泡显示注入的模式提示词** — 计划 / 目标 / 档位模式注入的指令块不再出现在用户气泡中，只显示实际输入内容。
- **批量生成主题 500 / 页面卡死** — 标题生成上下文超限（GLM code=10040）改为截断超长工具输出（单块 600 字符、总量 8000 字符）；批量并发从 4 降到 2，避免压垮 provider。
- **模型选择弹窗 key 冲突** — 标题模型的模型列表 key 改为 `provider+id`，相同模型 id 在不同 provider 下不再触发 React key 冲突刷屏。
- **模型选择按 provider 分组** — 换模型弹窗按 provider 分组显示，与右下角模型选择一致。
- **导入功能 Windows 路径适配** — `reasonixProjectToPiCwdDir` 按 pi SDK 真实编码规则（去首斜杠、`/ \ :` → `-`）处理，Windows 下 `C:\Users\me` 正确映射为 `--C-Users-me--`。
- **标题生成失败提示不完整** — 失败气泡改为从会话行右侧浮出（fixed 定位，不被容器裁剪）。
- **审批请求幂等** — 审批 resolve 重复 / 超时时不再抛「Unknown or already-resolved」；后端超时自动拒绝并通过事件通知前端清理。
- **移动端标题栏** — git 分支在窄屏只显示图标，会话标题居中；点击标题弹出完整标题弹窗。
- **会话信息栏 popover 关闭按钮补 hover 提示**。

### 界面调整
- 输入框底部工具选择默认「完整」且不再显示按钮；思考强度移到原工具选择位置。
- 移动端移除「更多」按钮，工具预设等直接常显；模式按钮收窄为图标。
- 计划 / 审批弹窗统一为输入框上方居中悬浮卡，操作按钮竖排（上中下）。
- 全部图标按钮补齐 hover 提示。

## 0.9.17-beta.1 — 2026-08-06

### 修复
- **导入会话自动生成标题 500** — 修复 Reasonix 导入的会话在自动/手动生成标题时返回 `Cannot read properties of undefined (reading 'length')` 的 500 错误。根因是导入转换时 `JSON.stringify(undefined)` 生成缺失 `text` 字段的消息块（`{"type":"text"}`），LLM 层序列化时崩溃；已在导入兜底与标题生成两条链路同时修复，历史已导入的坏文件也能正常生成标题。
- **超长会话标题生成慢/超时** — 上千条工具消息的全量上下文改为只取最近一段（尾部无用户消息时自动回退全量），生成速度显著提升，不再容易 90 秒超时。

### 新增
- **批量生成项目标题** — 会话列表顶部新增「生成标题」批量按钮，一键为当前项目所有会话并行生成标题，实时显示进度，完成后自动刷新列表。
- **导入后标题生成并行化** — 导入完成页的「为导入的会话生成标题」改为并发池并行（原串行 + 500ms 间隔），单条失败自动跳过，不再一个失败牵连其他。

## 0.9.16-beta.1 — 2026-08-06

### 新增
- **代理配置** — 设置弹窗新增「代理」标签页：支持 HTTP / HTTPS / SOCKS5 代理，主机与端口、用户名与密码分开填写（密码脱敏、URL 自动百分号编码）；可测试连通性；保存后运行时热生效（重建全局 Undici dispatcher），无需重启；启动时自动加载。适用于外部代理与本地代理（Clash / V2Ray 等）。
- **输入模式菜单** — 对话输入框左下角加号升级为三选项菜单：常规 / 计划 / 上传文件。
- **计划模式** — 只读分析模式：切换到只读工具集（read/grep/find/ls），每次发送自动注入「只读分析、输出实现计划」指令；输入框显示蓝色「计划模式」徽章，模式保持直到手动退出。计划完成后弹出确认框：确认执行（退出计划模式并把计划作为执行指令重发）、提出建议（输入反馈让 agent 继续完善计划，保持只读）、退出计划。
- **用量统计** — 设置弹窗新增「用量」标签页：当前会话（实时上下文占用环形图）/ 全局（总量卡片、每日趋势柱状图、Top 会话列表）可切换；全局统计优先使用会话中真实记录的模型用量（input+output+cache），无记录时按文本估算。
- **功能开关** — 设置弹窗新增「功能」标签页，可将「任务看板（Beta）」作为整体开关；关闭后顶部工具栏入口隐藏、看板视图强制关闭。

### 任务看板增强
- **取消任务带原因** — 取消时弹窗询问原因（可选），记录到任务时间线。
- **重试 / 重新排队带备注** — 重试失败任务或重新排队已取消任务时可填写备注，注入下一次运行的提示词。
- **无变更直接完成** — review 且无文件变更（filesChanged === 0）的任务显示「直接完成」，跳过合并直接标记完成。
- **列排序** — 看板所有列按更新时间最新优先排列（此前仅完成列排序）。
- **任务从消息创建** — 用户消息悬浮工具栏新增「创建任务」按钮，自动打开看板并预填任务标题与描述。

### Git 操作
- **一键推送** — 会话信息栏新增推送按钮，推送当前分支到远端，显示成功/失败反馈。
- **Stash 管理** — 会话信息栏新增 Stash 按钮：查看 stash 列表、保存（带说明）、恢复（pop）、删除（drop）。

### 其他
- **设置分组卡片** — 新增 SettingCard / SettingRow / SettingNote 组件，功能设置页改用卡片分组布局。

## 0.9.15 — 2026-08-05

### 修复
- **内置模型配置持久化重构** — 内置供应商模型编辑（上下文窗口 / 最大输出 / reasoning / 思考映射 / 名称 / 隐藏）不再写入 `providers[].models[]` 整模型替换条目，改为服务端 PATCH 写入 SDK 原生的 `modelOverrides` 字段级覆盖，避免重置模型其它元数据。
- **models.json 并发写入保护** — 所有读改写统一走 `proper-lockfile` 互斥 + 原子写盘（`lib/models-config-store.ts`），局部保存与设置页全局保存交错时不再互相覆盖；全局 PUT 始终保留服务端最新的 `modelOverrides`。
- **草稿不丢** — 切换供应商、点击全局保存、关闭设置前都会先等待未提交的内置模型草稿保存完成；保存失败保留 dirty 状态并显示错误，不再依赖组件卸载时的 fire-and-forget 请求。
- **保存期间继续编辑不丢失** — 草稿修订号跟踪，保存请求在途时的新编辑不会被旧响应清掉 dirty 标记。
- **旧配置兼容** — 历史 `models[]` 覆盖仍可回显；编辑时仅迁移 UI 管理的字段到 `modelOverrides`，`api`/`baseUrl`/`compat`/`cost` 等自定义与传输字段原样保留。
- **隐藏模型兼容** — `hidden` 同时识别 `modelOverrides` 与旧 `models[]` 两种格式；内置模型配置页通过 `includeHidden` 仍可查看并编辑已隐藏的模型。

## 0.9.14 — 2026-08-05

### 修复
- **切换供应商自动保存** — 在内置模型配置区有未保存修改时切换供应商，会自动保存当前草稿（此前草稿会随组件卸载丢失）。
- **隐藏字段序列化对齐** — `handleSave` 与自动保存路径对 `hidden` 字段的序列化逻辑保持一致。

## 0.9.13 — 2026-08-05

### 修复
- **内置模型属性修改保存不生效** — 上下文窗口、最大 tokens 等属性编辑后未持久化：`OverrideDraft` 接口补全 `name`/`hidden` 字段，`buildOverrideEntries` 同步写入。
- **内置模型隐藏** — 新增"隐藏此模型"开关，勾选后该模型将不出现在模型选择器中；隐藏状态写入 `models.json` 的 overlay 条目，通过 `resolveVisibleModels` 全局过滤。
- **隐藏模型过滤** — `lib/model-scope.ts` 在 visible model list 中过滤掉 `hidden: true` 的模型。

## 0.9.12 — 2026-08-05

### 修复
- **内置模型名称编辑后保存不生效** — `BuiltinModelsDetail` 组件 Draft 接口缺少 `name` 字段，编辑后的名称未写入 `models.json`。新增 name 编辑框并将值正确合并到 overrides 持久化。

## 0.9.11 — 2026-08-05

### 关键修复
- **修复 `Cannot find module 'undici'` 启动崩溃** — 将 undici 从 `serverExternalPackages` 中移除，改为由 Webpack 打包进 bundle。npm 全局安装时，macOS `com.apple.provenance` 安全属性阻止在 `node_modules/` 内创建新文件，导致 `serverExternalPackages` 标记的 undici 无法被安装。将 undici 打包进 bundle 彻底消除此运行依赖问题。

## 0.9.10 — 2026-08-05

### 关键修复
- **修复 npm 安装后启动崩溃（Turbopack 产物）** — 0.9.9 发布时误用了 Turbopack 构建产物，Turbopack 将 `serverExternalPackages` 中的 undici 映射为 `undici-<hash>` 虚拟模块名，导致 `next start` 时找不到该模块（`Cannot find module 'undici-43b6dae3674542ed'`）。本次重新用 `npm run build`（`env -u TURBOPACK next build --webpack`）构建，undici 引用恢复为正常的 `require("undici")`。但因 macOS `com.apple.provenance` 阻止新文件创建，undici 依赖仍然装不上——此问题在 0.9.11 彻底修复。

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

