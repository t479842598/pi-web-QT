# Changelog

> 版本号约定：`0.x.y`，最后一位 `y` 可从 0 递增到 **999**；到达 999 后进位到 `x+1.0`（见 `AGENTS.md`「版本发布规范」）。

## v0.10.5 — 2026-08-20（新会话首条消息即时上侧边栏：promote 提前 + 会话文件即时落盘）

### 修复
- **新对话创建后发送首条消息：界面卡住、弹出会话窗口、侧边栏延迟显示（重要）** — 根因有两处叠加：① 客户端 `promoteNewSession`（通知 AppShell 接管新会话并刷新侧边栏的唯一切换点）位于 `await sendAgentCommand(prompt)` **之后**，SSE 握手（最多 4 秒）+ prompt 网络往返 + 模型冷启动全部被夹在「界面卡住（新会话意图态）」与「一次性视图切换」之间，观感即卡住后弹出会话窗口，且异常路径可能永不触发 promote；② 服务端 pi SDK 在第一条 assistant 消息产出前**不写会话文件**（`SessionManager` 延迟落盘设计），而 `/api/sessions` 通过 `SessionManager.listAll()` 扫描磁盘文件，新会话创建成功但侧边栏扫不到 → 需等首条回复落盘 + 列表刷新（节流 2s）才可见。修复：① `handleSend`/`executeBash` 在拿到真实 sid 后**立即** `promoteNewSession`（AppShell 即时接管：选中新会话、URL 更新、列表刷新），当前聊天窗不重挂载、在会话内正常等待流式结果；② 服务端 `startRpcSession` 新会话创建成功后立即调用 `persistSessionFileIfMissing()`（复用原 bash-only 落盘逻辑泛化而来），会话 `.jsonl` 文件在 `/api/agent/new` 响应前已落盘，侧边栏刷新立即可见；③ AppShell `handleSessionCreated` 在 1200ms 重试基础上增加 4000ms 二次刷新兜底（文件系统/缓存滞后场景）。
- **新会话页面顶部项目标题显示成「最左侧下拉固定的项目」（显示错、归属对）** — 在顶部项目标签页切换到项目 B 后点击「新建会话」，新会话欢迎页上方显示的项目标题仍是下拉固定的项目 A 名字，但实际创建的会话 cwd 属于 B。根因：`dropdownPinnedProject`（最左侧下拉固定项）只在首次加载与「通过下拉切换」时更新，点击项目标签页走 `selectProject(project)`（不带 `fromDropdown`）只更新 `selectedCwd`，而欢迎页大控件（`workspaceControls` welcome 位置）label 取的一直是 `compactProjectLabel`（=`dropdownPinnedProject` 名）。修复：welcome 位置新增基于当前 `selectedProject` 的 `currentProjectLabel` 并优先显示（`isLargeWorkspaceControl ? currentProjectLabel : compactProjectLabel`），标题栏最左侧下拉仍保留固定标签（设计意图不变）。

### 其他
- `lib/rpc-manager.ts`：`persistBashOnlySession()` 泛化为 public `persistSessionFileIfMissing()`（幂等：文件已存在则跳过；bash-only 会话同样安全）。

### 构建（随本次 0.10.5 发布补齐 CI 打包修复）
- **桌面端 Release All 全平台 1 秒失败修复（重要）** — tauri build 步骤的假 HOME 沙箱（`HOME=runner.temp/piweb-fakehome`，原本用于规避 Windows nft 扫用户主目录 EACCES）会让 rustup 找不到默认 toolchain（rustup 默认读 `$HOME/.rustup/settings.toml`），`cargo metadata` 立即失败，macOS/Windows/Ubuntu 四个矩阵全挂。修复：`release-all.yml` 在 rust-toolchain 后把真实 `RUSTUP_HOME`/`CARGO_HOME` 固化到 `GITHUB_ENV`（假 HOME 沙箱继续服务于 beforeBuildCommand 的 next build）。
- **本地 bundle-backend 偶发 `TypeError: generate is not a function` 修复** — standalone `server.js` 会把 nextConfig 序列化进 `__NEXT_PRIVATE_STANDALONE_CONFIG`（函数成员如 generateBuildId 被 JSON 丢弃），若宿主环境带此变量再跑 next build，Next 会直接采用这份旧配置导致构建异常；`bundle-backend.mjs` 构建前显式删除该环境变量。

## v0.10.4 — 2026-08-20（桌面端开箱即用：内置后端 + 可信域名 + 启动连接页）

### 新增
- **全局错误边界 ErrorBoundary** — 捕获 React 组件渲染异常，不再整页白屏：`RootLayout` 以 `<ErrorBoundary>` 包裹 `{children}`，渲染出错时显示「应用加载失败」提示页（含错误堆栈摘要、「刷新页面」「清除缓存并刷新」两个按钮），适用于远程服务器数据异常或网络问题导致的界面崩溃。
- **桌面端内置后端，双击即用（M1）** — Next.js `output:'standalone'` + 随包内置 Node 官方二进制（Tauri sidecar），`probe.rs` 优先拉起内置 `node server.js`（绑 `0.0.0.0:30141`，注入密码 + 内存上限），不再依赖本机 npm/CLI；`scripts/bundle-backend.mjs`（`npm run bundle:backend`）装配 standalone + `public`，构建期排除 `.env*` 防密码泄漏，undici 补丁构建期固化；CI（`release-all.yml`）接入 `bundle:backend` + 按 `node_dist` 矩阵下载匹配架构 Node（`PI_WEB_NODE_BIN`）。
- **连接页新增「可信域名」配置** — 本机连接卡片可填写可信域名（如 `piweb.274747.xyz`），保存后作为 `PI_WEB_ALLOWED_HOSTS` 注入内置后端，Cloudflare 隧道等外部域名访问可过后端 Host 校验（此前返回 403 `Untrusted API request`）。
- **启动直接进入连接设置页** — 桌面端启动即打开连接设置页，可选择远程服务器连接，或点击本地条目一键拉起内置本地环境（无密码先引导设置）。

### 修复
- **发送消息在 MCP 未启动/未连接时不再失败** — `AgentSessionWrapper.waitForExtensionsBound` 在扩展绑定（MCP 作为扩展加载）失败或超时时直接抛错，导致 `send("prompt")` 失败且此后每次发送都失败；现改为失败/超时放行，消息照常发出。
- **桌面端远程服务器 502（系统代理）** — 反向代理的 reqwest 默认不读系统代理，Cloudflare 隧道域名直连 DNS 失败；现加 `system-proxy` feature + loopback `no_proxy` 绕过，与浏览器行为一致。
- **发消息 `dark.json` ENOENT** — standalone 追踪（`@vercel/nft`）漏掉 pi-* 包运行时 `fs.readFileSync` 加载的 JSON 主题资源；打包时整包补齐 4 个 `@earendil-works/pi-*` 包。
- **关闭重开后不自动拉起/残留进程占端口** — 退出清理（`RunEvent::Exit`/托盘退出）改用 `kill_child_tree` 杀整个进程组（Unix `kill(-pgid)` / Windows `taskkill /T /F`），孤儿 node 不再占用 30141。
- **Windows 兼容修复** — 导航 401 错误页改 200（避免 WebView2 内置错误页白屏）、`taskkill` 加 `CREATE_NO_WINDOW` 抑制黑框、内置后端绑 `0.0.0.0` 恢复远程/隧道访问。
- **发送消息与排队插入时实时显示等待态** — SSE 连接初始 `state_sync`（空闲快照）不再冲掉乐观等待相位；排队插入（steer/followUp）补位 `waiting_model`。
- **v0.10.3 三端版本号脱节（桌面构建隐患）** — 已通过 `scripts/sync-version.mjs` 统一同步（本次发布进一步同步至 0.10.4）。

### 其他
- 桌面端启动路由重构为「启动即连接页」，移除已失效的「无服务时自动拉起」开关（`local_auto_start`）。
- 技术选型方案详见 `docs/desktop-runtime-selection.md`。

## v0.10.3 — 2026-08-18（本地运行内存优化 + 发送消息无响应修复）

### 优化
- **本地运行内存占用全面优化** — ① **会话生命周期收敛**：SSE 最后一条订阅断开且会话空闲时 60s 宽限自动回收（`AgentSessionWrapper` 新增订阅计数/宽限回收/活动时间戳，重连或发送即取消）；会话注册表 LRU 上限 12 个，仅淘汰"空闲且无订阅"的最旧 wrapper；② **会话列表缓存失效去抖 300ms** + 缓存 TTL 5s→10s + `firstMessage` 截断 300 字符，流式期不再被事件风暴触发全量重扫；③ **语法高亮瘦身**：`react-syntax-highlighter` 全量 Prism(~180 语言)替换为共享 `PrismLight` 模块（按需注册 33 个常用语言+别名，`MarkdownBody`/`FileViewer` 共用），未注册语言自动回退纯文本，首屏 bundle 与解析内存同步下降；④ dev/start 堆上限 4GB→3GB（`with-memory-limit.js`），GC 更早介入。
- 完整方案与实施状态见 `docs/local-memory-optimization.md`。

### 修复
- **纯净环境下发送消息无响应/无报错/无网络请求（重要）** — 根因：`handleSend` 在发出任何请求前就把 `agentRunning` 置为 `true`，而新会话创建 `POST /api/agent/new` 无超时；服务端模型目录网络刷新（`getAvailable`/`ModelRuntime.create`）在纯净环境联网挂起时无限阻塞 → `agentRunning` 永久卡 `true` → 后续发送被静默守卫拦截（无响应、无报错、无网络请求）。修复：① 客户端 `ensureNewSession` 加 30s 硬超时，`sid` 为 null 时显式抛错（不再静默空跑）；② 服务端 `startRpcSession` 加 25s AbortSignal 超时并透传 `modelRuntimeSignal`/`signal`，真正取消底层网络请求（无孤儿会话）；③ 发送失败时移除乐观消息并回填输入框，用户可直接重发；④ 发送守卫命中时打印诊断日志。

## v0.10.2 — 2026-08-15（完整修复版：会话切换 + 桌面端偏好持久化）

### 修复
- **切换/新建会话不再显示上一个会话的内容（移动端）** — ① 新建会话时 `newChat` 清空消息后立即通知 UI 刷新（此前要等模型/技能加载完成才刷新，慢网络下旧会话内容会残留显示）；② `openSession`/`newChat` 增加代际计数，快速连续切换会话时 `getSession` 乱序返回的旧结果不会覆盖新会话内容。
- **桌面端每次连接后网页端偏好丢失（主题/收藏模型/手风琴折叠状态）** — 根因：本地代理端口每次随机分配，WebView 的 localStorage 存储域（`127.0.0.1:port`）随之变化，浏览器偏好全部丢失。现代理端口持久化到服务器配置并优先复用：端口首次分配后写回 `config.json`，后续连接/重启复用同一端口，WebView origin 稳定，偏好完整保留；端口被其他进程占用时回退随机端口并重新保存。

### 新增
- **自定义供应商向导增强** — 向导新增 API Key 直接填写（明文切换/环境变量/`!shell` 命令）、「添加模型」手动填写、调用格式新增「自定义调用格式」与 `mistral-conversations` 选项。

## v0.10.1 — 2026-08-15（自定义供应商向导增强）

### 新增
- **自定义供应商向导可直接填 API Key** — 向导 URL 区块下方新增 API Key 输入框（支持明文切换、环境变量/`!shell` 命令/字面值），与 URL 一并持久化到 `provider.apiKey`。
- **供应商详情页手动添加模型** — 「导入模型…」按钮旁新增「添加模型」按钮，点击即添加空白模型并跳转详情手填。
- **调用格式下拉「自定义调用格式」选项** — 选中即展开完整 URL 输入框；URL 区块标题改为「完整 URL」。

## v0.10.0 — 2026-08-15（移动端网页端风格化 + 桌面端远程认证修复 + 模型列表故障可见化）

### 新增
- **移动端首页/项目分层** — 首页为所有项目目录页（可折叠项目手风琴，含会话数与相对时间，空态可直接选目录新建）；点击项目进入后只显示该项目会话，按 置顶/今天/昨天/更早 手风琴分组（对齐网页端 SessionSidebar）。
- **移动端侧边栏** — 抽屉内项目切换条（展开全部项目 + 「选择其他目录…」新增选择目录）；会话行显示相对时间与消息条数；长按会话行可生成标题/重命名；「回首页」按钮修复（抽屉打开时 PopScope 拦截 pop，改为先关抽屉再 pop）。
- **移动端对话交互** — 运行中输入框可继续输入、回车即插队发送（steer），移除「继续」按钮；思考/处理过程默认折叠（展开限高+滚动）；实时工具卡片显示具体命令（bash 等参数多字段解析）。
- **移动端状态显示** — 「工作中」+ 每秒 token 速率（流式估算，对齐网页端）；已消耗 token 输入/输出/总计替代步骤/工具计数；项目层不再显示处理中、运行状态只在会话卡片内展示。
- **网页端模型列表故障可见化** — `/api/models` 加载失败返回错误（不再静默空列表）；ChatInput 显示失败原因 + 重试；新增自定义供应商向导对话框（支持从已有提供商导入）。
- **桌面端自定义用户名** — 连接页新增用户名输入框（默认 pi），远程可配任意 Basic Auth 用户名。

### 修复
- **桌面端远程连接认证失败（根因修复）** — 旧方案用 Tauri `on_web_resource_request` 注入 Basic Auth，但该 API 只作用于 tauri:// 协议资源、无法拦截外部 http(s) 请求，凭据从未真正到达远程服务器：Windows WebView2 对 401 弹系统凭据框（要求重输账号密码，只输密码则认证失败），macOS WKWebView 直接白屏。现改为壳内本地反向代理（hyper + reqwest 流式）：保存了密码的服务器经 `127.0.0.1:<port>` 访问，首屏/子资源/API/SSE 全部自动携带实时凭据，两平台行为一致；转发时重写 Host/Origin 以通过服务端 request-security 的同源/白名单校验，剔除 WWW-Authenticate（不再触发 WebView2 凭据弹框），上游重定向 Location 改写回代理地址（防绕过代理直连），代理仅响应打向 127.0.0.1 入口的请求，改用户名/密码后已开窗口立即生效；导航请求认证失败返回友好提示页而非白屏。
- **桌面端代理/窗口生命周期加固**（二轮审查）— 已存在窗口点「连接」重新导航到最新 URL；删除服务器时关闭窗口并清理代理注册；菜单切换目标排除连接页；切换后同步窗口注册表（防重复建窗/标题错乱）；连接页「自动拉起」勾选框从持久化配置初始化；代理 accept 循环遇瞬时错误不再静默退出。
- **发布 CI macOS 构建必挂** — `release-all.yml` 桌面 job 的 `sed -i`（GNU 写法）在 macOS BSD sed 下报错，两个 macos-latest job 会在 Sync version 步骤失败；改为 `sed -i.bak … && rm -f …bak`（与 iOS job 一致的 BSD 兼容写法）。
- **「启动本机 pi-web」并发误报** — 启动互斥窗口期内重复触发返回 false 被前端误报「未检测到 pi-web CLI」；改为返回 true（正在启动，前端继续轮询就绪），双开进程仍被互斥拦住。更名过时测试 `config_roundtrip_…_when_keyring_ok`（keyring 已移除）。
- **桌面端 Windows 适配** — ① 本机 pi-web CLI 探测在 Windows 上失效：npm 生成的启动器是 `pi-web.cmd`（无扩展名的 `pi-web` 是 sh 脚本，CreateProcess 无法执行），且 `npm prefix -g` 返回的 bin 目录就是 prefix 本身而非 `prefix/bin`；现按平台候选名（Windows `.cmd`/`.exe`）查找，并兼容 `%APPDATA%\npm`。
② 拉起 CLI 不再闪出 cmd 黑框（GUI 应用无控制台，`CREATE_NO_WINDOW` 抑制）。③ Windows 原生菜单不支持彩色 emoji（渲染为方框），服务器菜单/托盘菜单改纯文本标记（macOS/Linux 保留 emoji）。④ 发布 CI 补上 `updater:default` capability 注入（README 声称已带但实际缺失，导致「检查更新」永远失败）。⑤ 版本同步补 `desktop/Cargo.toml`（Tauri 构建要求 `tauri.conf.json` 与 `Cargo.toml` 版本一致，此前脱节会导致构建失败），本地与 CI 均已同步。⑥ 探测/拉起命令改后台执行（`spawn_blocking`），连接页探测不再冻结 UI；`switch-` 菜单导航目标改用聚焦窗口；Basic Auth 凭据注入改为本地反向代理实时读取配置（见上条根因修复）；窗口标题同步改名。⑦ 探测逻辑加固：`is_local_host` 精确解析 host（不再误判 `127.0.0.1.evil.com`）、npm prefix 查询加 3s 超时、服务在线时跳过 CLI 查找、`spawn_local` 并发去重、启动时按「无服务自动拉起」开关后台拉起本机服务、菜单名转义 `&`。
- **桌面端支持自定义用户名** — 连接页新增「用户名」输入框（默认 `pi`），保存服务器时可选填任意 Basic Auth 用户名；此前用户名写死 `pi`，远程服务器（用户名非 pi）一律连不上。已保存服务器列表显示用户名，编辑时回填。

## v0.9.28 — 2026-08-13（发消息卡死修复 + 桌面端体验）

### 修复
- **发消息卡死（重要）** — 根因：本地代理（Clash 等）拦截 `127.0.0.1` 的 SSE 长连接，EventSource 收不到任何事件，且 SSE 连接失败会阻断发送、兜底轮询又依赖 SSE 驱动的运行标志 → UI 永久卡住。修复：① SSE 连接最多等 4 秒，失败照发消息（降级）；② 发送后无条件轮询对账，agent 完成即拉取并显示结果。代理环境下消息可正常发出、结果可显示（网页端/桌面端/移动端同代码受益）。

### 新增
- **桌面端启动不再自动连接** — 打开 App 总是进入连接管理弹窗，由用户自己填写服务器地址；不恢复上次服务器、不自动连本地、不自动使用本地密钥/密码；「获取本机链接」检测到的地址由用户填写确认。
- **设置里的服务器入口** — 网页端设置弹窗新增「服务器」tab（仅桌面壳显示）：显示当前服务器地址 +「切换服务器」按钮（打开桌面连接管理，可切换/添加服务器）。
- **移除钥匙串弹窗** — 桌面端密码改明文存配置（不再弹 macOS 钥匙串授权框）。

### 移动端（mobile2/）
- **网页端风格重构 M1** — 新主壳 `WorkspaceShell`（顶部标题栏 + 会话列表主页，按项目分组/搜索/新建，玻璃拟态视觉），替换 MonkeyCode 三 tab 壳；任务看板入口移除；goal/plan 后续在对话框内显示。

## v0.9.27 — 2026-08-13（桌面端 + 双移动端 + 三端打包）

### 新增
- **桌面端（desktop/）** — Tauri 2（Rust）壳 + WebView 加载 Pi Web：启动自动探测本机服务，在线直接进入工作台；本机装有 `pi-web` CLI 且未运行时后台自动拉起并轮询就绪后连接；支持 URL+密码（Basic Auth，用户名 `pi`）保存多台服务器、多窗口同时连接；密码存系统钥匙串（macOS Keychain / Windows Credential Manager / Linux Secret Service），配置不落明文；关闭窗口驻留托盘、托盘菜单切换/新开服务器窗口；自更新（tauri updater，发布 CI 启用）。桌面端与网页端/手机端连接同一 Pi Web 实例时数据天然同步。
- **主窗口内来回切换服务器** — 主窗口菜单栏「服务器」菜单（macOS 挂应用菜单栏，Windows/Linux 挂窗口菜单）列出全部已保存服务器，点击把当前窗口直接导航到目标服务器（同步更新标题与最近使用记录），可与托盘「新开/聚焦窗口」配合使用。
- **设置服务器 URL** — 启动不再自动连本地：无上次服务器时进入连接页，可弹窗填写 URL+密码，或点「获取本机链接」按钮自动探测本机运行的 Pi Web 地址填入，「启动本机 Pi Web」一键拉起 CLI。
- **Tauri 三端（桌面 + Android + iOS 同栈）** — 用桌面端技术栈直接生成移动端（mobile2 = Tauri 移动端）：Android APK + iOS 自签 IPA，显示名 Pi Web New（包名 com.piweb.app）；Rust 代码 `cfg(mobile)` 适配（单窗口 navigate、无托盘/菜单/CLI）；Android 无钥匙串降级明文。Flutter 旧移动端保留（mobile/，打包名 pi-web）。- **两个移动端 + 一个桌面端** — `mobile/`（Flutter，打包名 **pi-web**，显示名 Pi Web）与 `mobile2/`（Flutter 新版，打包名 **pi-web-new**，显示名 Pi Web New，包名 `top.zknas.pi.pi_mobile_new` / iOS `com.pimobile.piMobileNew`）各自单独发布 Android + iOS；`desktop/`（Tauri）发布桌面端三平台。
- **三端一块打包 CI** — `.github/workflows/release-all.yml`：打 `v*` tag 同时产出 mobile（pi-web-*）、mobile2（pi-web-new-*）的 APK/AAB/IPA，以及 Tauri 桌面三平台安装包；版本号统一跟随 web（`scripts/sync-version.mjs` 同步 desktop/tauri.conf.json 与 mobile、mobile2 的 pubspec.yaml，Flutter 取 x.y.z 主体）。

### 修复
- **桌面端切换主题卡顿** — ① 主题列表 hover 预览无防抖且每次触发 `/api/themes` fetch + 全量 CSS 变量重算：改为 160ms 防抖 + 仅预览已缓存主题（未缓存需点击加载），扫过列表不再卡；② 亮暗切换的 `startViewTransition` + clipPath 动画在 WKWebView 上开销大：WebKit WebView 环境直接切换、跳过动画。
- **切换项目 tab 后会话标题显示 id 片段（编码乱码）** — 恢复会话用的是最小记录（无 name），标题回退到会话 id：现在标题回退链加入 ChatWindow 加载后回传的真实标题（sessionStats.sessionName），并在恢复时从会话列表异步补全真实会话名。
- **桌面端启动不再自动连接** — 打开 App 总是先进入连接管理弹窗，由用户自己填写服务器地址；不恢复上次服务器、不自动连本地、不自动使用本地密钥/密码；「获取本机链接」检测到的地址由用户填写确认。

## v0.9.26-fix — 2026-08-13（修复版）

### 修复
- **添加供应商后模型列表不刷新** — 全新安装（无任何凭据）时模型列表为空且被进程内缓存 60 秒；此前添加 API key / OAuth 登录 / 登出只清除了 `/api/models` 的缓存，漏清了 `model-scope` 的进程内模型缓存，导致添加完供应商后输入框无法选择模型（约 60 秒后自行恢复）。现 auth 变更（添加/删除 API key、登录、登出）会同时失效两处缓存，添加供应商后模型立即可选。

## v1.3.0 — 2026-08-14（移动端正式版）

### 新增
- **输入框与加号按钮卡死修复** — 移动端 SSE 在网络切换/后台挂起时被「黑洞」会导致 `running` 永久卡 true、输入框与加号按钮同时失效；新增运行状态回查看门狗：运行中每 5s 探测 `GET /api/agent/[id]`，App 恢复前台立即 reconcile，错过的终态事件在秒级内自愈（不依赖 `prompt_done` 事件）。
- **加号菜单重做** — 原单一图片入口改为五项菜单：计划（plan 协作模式）/ 目标（goal 模式）/ 上传文件 / 使用命令 / 引用对话。
- **网页端主题系统接入** — 功能抽屉可切换全部服务器主题（gruvbox / nord / tokyo / solarized / onedark / dracula / catppuccin 及 OpenChamber 扩展集），App 配色随网页端 CSS 变量（明/暗双变体）；默认主题与网页端 teal 系对齐。
- **goal 协作模式** — 设定目标后展示实时状态条（状态点 + 目标文本 + 用时 + 暂停/继续/停止），状态与网页端 GoalPanel 同源。
- **运行中可发送（排队）** — 运行中点击发送=steer 干扰当前运行、长按=follow-up 排队到最后；排队消息带 ⏳ 徽标。
- **@ 文件引用与 # 快捷片段** — 输入框 `@` 触发文件补全（`/api/file-index`）、`#` 触发片段补全（`/api/snippets`），行为与网页端一致。
- **任意文件上传** — 图片并入附件管线（10 张/10MB）；文本类（≤512KB）内容注入输入框供继续编辑。
- **思考级别切换** — 功能抽屉新增 thinking level（off…max），与网页端 `set_thinking_level` 同接口。
- **项目备注（显示+编辑）** — 抽屉目录组显示网页端项目备注，可编辑同步到服务器。
- **运行中项目/会话置顶** — 含运行中会话的项目与会话在抽屉中置顶并有进度标识。
- **供应商管理** — 内置 API-Key 供应商列表、添加/更新/删除 Key，状态与网页端一致。
- **移动端气泡对齐网页** — 用户气泡 `min(85%, 680px)` / padding 9×14 / radius 9 / 300px 内部滚动；助手全宽无背景。

## v0.9.26 — 2026-08-14（正式版）

### 修复
- **计划模式退出与评审卡修复** — ① 退出计划模式不再依赖可能被吞掉的 `/plan exit` 异步命令：退出时显式恢复完整工具集（`set_tools`），即使扩展命令失败也不会把会话锁死在只读工具集（修复「UI 显示已退出但调用不了其他工具」）；② 模式切换（协作模式 / plan 开关）同步刷新内部 ref，避免切换后立即发送消息仍注入旧模式指令块；③ 计划评审卡（PlanReviewDialog）直接展示计划全文（默认展开，可收起）——此前计划只在 `plan_mode_complete` 工具结果里，容易在折叠的工具卡片中漏看；④ 本地化 plan-mode 扩展的英文通知（`Plan mode enabled/disabled` 等），中文界面下弹窗不再全英文。

### 新增
- **许愿式开发（goal 模式升级）** — goal 状态机与自动续跑迁到服务端 `AgentSessionWrapper`：目标持久化到 `<session>.jsonl.goal.json` sidecar，刷新/重开页面后目标与消耗统计完整恢复并自动续跑，离开后回来愿望达成；新增 token 预算（超限自动停）、时间统计、`goal_start/pause/resume/stop/edit` 服务端命令；GoalBanner 重构为 Codex 风格 GoalPanel（状态点 + statusLabel + 时长 + `已用token/预算` + 内联编辑 + 暂停/恢复/清除），状态经 `goal_state_changed` SSE 实时同步（参考 lyhue1991/pi-codex 与 lyhue1991/pi-web 的 GoalPanel）。
- **长命令追踪（异步 bash）** — 注册 `bash`（覆盖内置）与 `bash_io` 工具：短命令直接返回，长命令超过阈值返回 `session_id` 而非阻塞等待；agent 通过 `bash_io` 每隔几分钟轮询增量输出、写 stdin 或 Ctrl-C 中断，像人一样决定继续等待或杀掉调整；后台进程带 head+tail 缓冲（上限 256KiB）、进程树清理、session 销毁兜底。

## v1.2.0 — 2026-08-13（移动端正式版）

### 变更
- **移动端对话工作过程与网页版对齐** — 对话流中「工作中」区域改为实时面板：工具卡片（等宽工具名 + 参数预览 + 耗时 + 运行/完成/失败状态，可展开查看完整 JSON 参数与结果）、阶段指示（等待模型 / 运行命令 / 正在运行工具: 名称列表）、流式思考自动展开；历史工具调用渲染为可展开卡片而非纯文本行。
- **移动端斜杠命令面板视图切换** — 命令面板支持「横排 chips ↔ 竖排分组列表」两种布局切换。

## v0.9.25 — 2026-08-13（正式版）

### 变更
- **顶部项目 tab 与下拉选中项目多端同步** — 项目 tab 列表与标题栏下拉选中的项目改由服务端统一存储（`~/.pi/agent/project-tab-state.json`，经 `/api/project-state` 读写）：任一窗口/设备增删 tab 或在下拉切换项目后，其它已打开的窗口/设备通过 SSE 事件实时同步（下拉选中项目变化时自动切换当前项目）；刷新页面从服务端恢复；tab 恢复时校验并剔除失效目录；首次使用自动把本地旧 localStorage 里的 tab 迁移到服务端。
- **移动端斜杠命令面板视图切换** — 命令面板支持「横排 chips ↔ 竖排分组列表」两种布局切换。

### 修复
- **切换项目 tab 不再丢失已打开的会话** — 每个项目按 projectRoot 记忆最后打开的会话：切到其它项目 tab / 下拉时关闭当前会话并清空会话 URL，切回时自动恢复该项目上次打开的会话（同步恢复，聊天区按会话 id 自行加载内容）；多项目往返切换各自恢复各自的会话；选中/新建/分支会话同步更新记忆，任何显式导航会取消待恢复；修复恢复抑制标志残留导致真实切换被吞的问题。

## v0.9.24 — 2026-08-12（正式版）

### 新增
- **顶部项目 tab 栏** — 桌面端标题栏左侧新增项目 tab：默认显示当前项目一个 tab，最多 5 个（固定宽度、超长省略）；首个 tab 无关闭按钮、点击下拉可切换项目，其余 tab 带 ✕ 可关闭；最右 tab 右侧 + 号新增项目（支持「选择文件夹…」）；tab 列表持久化到 localStorage；移动端不显示。
- **主题实时预览** — 设置页主题 tag 悬停即时预览配色（不写入本地存储），移开恢复原主题，点击才生效。
- **日志筛选增强** — 日志页错误码下拉改为动态聚合日志中实际出现的全部状态码；新增日志级别（error/warning/info）筛选。

### 变更
- **移除 OpenCode Zen 网关** — 删除账号/代理池、429 自动切号、日限额冷却与外部 OpenAI 兼容网关（127.0.0.1:7474）；opencode/opencode-go 回归普通供应商，在模型设置页单独填写 API key（存 `auth.json`），设置页不再有 OpenCode Zen tab。
- **主题单 key 模型** — 主题选择改由单一 `pi-theme` 键承载，暗黑/明亮模式共用同一套主题（各用各的 light/dark 变体）；修复所选主题（如 `vitesse-dark`）刷新后被重置成默认的问题；旧版 per-mode 键自动迁移。
- **自定义供应商支持 http baseUrl** — 添加供应商时允许 `http://`（含 localhost/内网）地址，本机 Ollama/LM Studio/vLLM 等可完整走通「保存→获取模型→测试→聊天」；仍拒绝非 http/https 协议。

### 修复
- **日志仅保留 web 模型调用与运行日志** — 彻底移除 opencode-zen 各来源（external/switch/runtime/sync）的日志，历史遗留条目启动时自动清洗；新增全部供应商的模型调用日志（成功 info / 失败 error 含状态码，source=`model-call`）。
- **修复 SSE 长连接空闲泄漏** — agent 事件流与运行中会话流增加 2 小时空闲关闭，防止半开连接长期占用。

## v0.9.23 — 2026-08-11（正式版）

### 新增
- **回复下展示本轮写入的文件列表** — 每条助手回复底部列出本轮实际写入/编辑的文件徽章（来自本轮成功的 `write`/`edit` 工具调用，不扫描回复文本），点击即在预览窗格打开；生成的 HTML 文件默认以预览模式展示（与 markdown 一致）。移植上游 #378。
- **流式运行期间可添加图片附件** — agent 运行时仍可点击附加菜单上传图片或拖入图片，图片随下一次 steer / follow-up 一起入队发送；非图片文件引用在流式中仍被拦截，避免注入文本破坏进行中的 prompt。移植上游 #243016e。
- **会话估算活跃耗时** — 会话统计面板新增「估算活跃耗时」行：基于 session 日志各条目的时间戳剔除人工空闲间隔（用户消息与用户发起 bash 作为边界），分支与压缩历史各计一次。移植上游 #380。
- **目录选择器子目录实时筛选** — 选目录弹窗列表顶部新增筛选框，输入关键词实时过滤当前目录的子目录（大小写不敏感），无匹配时显示「没有匹配的子目录」。移植上游 PR #461 并适配本地无路径输入框的 UI。

### 修复
- **发送消息后偶发跳到对话顶部** — `pendingScrollToUser` 在虚拟列表目标行尚未挂载时被消费，滚动目标错误指向旧一轮用户消息；改为目标行真正挂载后才触发滚动（挂载回调消费），effect 仅作兜底。
- **进入会话页面不在最底部** — 虚拟列表行高异步测量导致初始滚动基于估算高度、实测后停在半路；改为轮询容器 scrollHeight 直至稳定，打开会话必然落在最后一条消息。
- **运行时最后消息被底部输入框遮挡** — 滚动 keep-out 从固定 88px 改为动态测量输入框实际高度（图片预览/多行输入/横幅时更高），最后一行始终完整可见。
- **模式提示词泄漏到标题与编辑回填** — 注入的 `<delivery/economy/goal-profile>` 与「PLAN MODE」指令块（含仅开标签的截断形态）在会话标题、编辑回填、回显气泡中剥离；新增统一 `stripModeInstructionBlocks` 并覆盖标题生成、自动命名写入、显示端与 `/name` 命令，同时清理已写入 session 文件的 4 条污染标题。
- **旧会话标题下方小时/消息数/分支名换行** — meta 行容器强制不换行，时间/消息数不再被挤压换行，分支名保持省略。
- **会话统计面板第二列与第三列文字重叠** — 面板宽度随内容自适应（上限视口 92%），列加溢出保护，窄屏时可收缩。

## v0.9.22 — 2026-08-10（正式版）

### 新增
- **子代理舰队监控** — 会话运行 Agent/Task 工具时，聊天区右上角出现「N 个子代理运行中」脉冲气泡，点击展开右栏子代理面板：状态圆点（运行/完成/失败/停止）+ 类型 + 描述 + token 用量 + 耗时（运行中每秒刷新）；点击某行可进入该子代理的只读对话视图，实时轮询其 `.output` 转录（自动滚动、角色着色、工具调用与结果展示）。子代理状态由 `tool_execution_start`（Agent/Task spawn）与 `subagents:record` 完成记录合并而来，最多保留 20 行。
- **会话侧栏分组视图 + 搜索 + 置顶** — 侧栏会话区新增「列表 / 分组」双视图切换（localStorage 记忆）：分组视图按 **置顶 / 今天 / 昨天 / 更早** 手风琴收纳（置顶会话同时在时间组内重复展示，方便按时间定位）；新增会话搜索框，按会话标题或 git 分支名实时过滤；会话可置顶（图钉）——乐观更新即时生效、失败自动回滚，置顶状态写入 `settings.json` 的 `sessionPins` 并经 `session_pin_changed` 总线广播，多窗口/多设备同步刷新。
- **设置页「立即应用」** — MCP、模型、技能、子代理配置页新增「立即应用」按钮：触发当前会话 `reload`（重读 settings/供应商/资源加载器并重跑扩展初始化），MCP/技能等配置改动免重启 pi 即刻生效，无需再等新会话。
- **DeepSeek Vision 独立配置卡** — 视觉模块配置从「功能」页迁入 MCP 页：内置 `deepseek-vision` 服务器专属卡片，同时管理 MCP 注册（mcp.json 的命令/生命周期）与模型配置（.env 的 provider/地址/Key/模型/最大 tokens）；新增「重启服务器」一键生效（经 `/mcp:stop` + `/mcp:start`，无需重启 pi）；该内置服务器从通用服务器列表中隐藏、名称保留，避免误删。
- **流式 Token 速率** — 输出过程中的流程摘要行实时显示 tokens/s（基于流式文本增量的一秒滑动窗口估算，约 4 字符/token）。
- **计划评审内联化** — 计划评审卡片从悬浮在输入框上方改为消息流尾部内联呈现：可先读完上方完整计划再点「确认执行 / 提出建议 / 退出计划」，不再遮挡输入区；建议编辑器与关闭按钮布局同步调整。
- **Goal 横幅** — goal 协作模式下，目标文本、开始时间与「暂停/继续/停止」操作常驻显示在消息区与输入框之间（Reasonix 风格参考）。

### 修复
- **虚拟化消息列表上滚回弹** — 完全禁用虚拟列表按行高变化自动修正滚动位置（此前行测量滞后于手势结束时仍会回拽视口，造成「上滚后被拉回底部」循环）；滚动位置现在只归用户手势与流式自动跟随，另加 200ms 沉降校正确保流式末尾落在真实底部。
- **编辑历史消息残留模式指令** — 编辑带 `<delivery/economy/goal-profile>` 或「PLAN MODE」前缀块的历史消息时，回填输入框只保留用户原文，不再把指令块带回输入区。
- **会话分支徽章适用范围** — 会话列表的分支名徽章从「仅 linked worktree」放宽到任何 git 仓库会话（与新增的按分支搜索配套），主仓库会话也能看到当前分支。
- **等待模型响应相位提示** — 计划模式下 agent 处于 `waiting_model` 相位时，状态行附加旋转加载指示。

## v0.9.20 — 2026-08-10（正式版）

### 新增
- **消息列表虚拟化 + turn 分组** — 聊天消息列表改用 tanstack-virtual 全量虚拟化（方案 B）：只挂载视口窗口 ± overscan 的消息节点，上千条的长会话滚动不再随深度增加 DOM 节点数；顶部不再有「加载更早消息」分页哨兵——滚动到顶即达最早消息；消息高度自动实测（估算 + measureElement 修正），ProcessGroup、流式尾部、图片等动态高度均正确；小地图/分支定位改用虚拟化布局数据（不再依赖 DOM 测量），打开会话自动对齐最新消息。
- **OpenCode Zen 外部模型列表开关** — 设置页外部调用新增「只显示免费模型」开关（默认开启）：开启时 `GET /v1/models` 仅返回 `-free` 免费模型，关闭后返回全部模型（含付费）；开关变化自动热生效（网关按配置签名重启），提示文案随开关状态切换。
- **用量页当前会话与全局同屏** — 设置-用量页去掉「当前会话/全局」切换按钮，两个报表区块同时展示：上文当前会话上下文用量环，下文全局总用量/条数、近 14 日柱状与 Top 会话列表。

### 修复
- **旧对话使用新增供应商/模型不再报 Model not found** — 会话 wrapper 存活期间 modelRuntime 是创建时的快照，设置页新增供应商/导入模型后旧对话切换模型会报 `Model not found`（新对话正常）；`set_model` 找不到模型时先重读 models.json 再查，旧对话立即可用新模型。
- **OpenCode Zen 429 冷却记忆持久化** — 冷却/轮转/最近成功账号落盘 `opencode-zen-state.json`：进程重启、设置页保存配置不再清空冷却，已限额账号不会复活反复吃 429；429 后切换的账号进入日级冷却直到 UTC 0 点，全池限额时直接 503 提示而非白试。
- **子代理可设置模型** — 子代理设置页每个已发现代理新增模型下拉：选项来自当前已配置供应商（内置已认证供应商 + 自定义供应商，与聊天模型选择器同源）；选择即保存写回 `~/.pi/agent/agents/<name>.md` 的 frontmatter `model` 字段（新 PATCH 接口，目录穿越/文件名校验，其余字段字节级保留），首项「默认（不指定）」可移除已设模型。
- **OpenCode Zen 全自动保存** — 账号/代理/外部端口/API Key/免费模型开关等所有字段编辑改为 500ms 防抖自动保存，移除「保存」按钮；关窗时 flush 未落盘修改（与 models.json 共用设置页关闭钩子），不再丢最后输入。
- **设置页移动端输入框不再点击放大** — 移动端（≤767px）设置弹窗内所有 input/select/textarea 字号强制 16px（iOS Safari 对低于 16px 的表单控件聚焦时自动放大页面），桌面端布局零影响（仅移动端媒体查询生效）。
- **OpenCode Zen 批量导入自动保存** — 「批量导入账号」与「批量导入并测试代理」完成后配置立即持久化，不再需要再点「保存」；导入成功提示同步说明已自动保存，账号与代理导入流程彻底去手动化。
- **外部调用开关显示实际运行状态** — 开关从「配置意向」改为「实际监听状态」：服务重启后网关自动恢复启动（instrumentation 挂载拉起），启动失败/端口被占/未设置 API Key 时开关如实显示关闭并给出原因，不再出现「开关开着但服务没跑」的误导；点击开关按实际状态启停（未运行→尝试启动，运行中→停止）。
- **新对话不再继承上一个对话的计划模式** — 新对话（会话未创建）里切换模式不再写入全局默认（settings.json `modes`，仅「设置-功能」页可改），而是暂存为待生效的会话级配置、会话创建后写入 `modesPerSession`；修复「新对话继承了上个对话的计划模式」的污染问题。
- **进入对话时计划模式重置为常规** — 计划模式视为临场模式：每次进入对话（含上次遗留计划模式的会话）自动重置为设置里的默认模式，并清理遗留记录、恢复非只读工具集（会话包装器存活时入口轻量对账），不再跨进入恢复只读状态。

## v0.9.19 — 2026-08-09（正式版）

### 新增
- **外部调用启动开关** — 设置页外部调用「启用」复选框改为开关：点击立即保存并热生效（后端自动重启网关），无需再点保存；开关后直接显示状态/错误（运行中/端口占用/未设置 API Key），不再有困惑的「保存后自动启动」。
- **外部调用网关调用日志** — 每次转发记录方法/路径/模型/上游状态码（info 级）；上游非 2xx（400/401/5xx）读响应体摘要记 error 级（含具体错误消息，如 `CreditsError: No payment method`、模型不支持等），429 记 warning 级，错误日志页可查。
- **错误日志页来源过滤** — 设置日志页新增「全部来源」下拉（按 source 筛选，如只看 `opencode-zen-external` 外部调用日志），错误码下拉补 200，warning 级日志橙色显示；日志改为客户端过滤（一次拉全量 500 条）。

### 修复
- **i18n 缺失 `desktop.saving` 补录** — MCP/子代理配置页保存按钮引用但目录缺失，catalog 测试转绿。
- **外部调用不支持 Anthropic 端点的明确提示** — 网关拦截 `POST /v1/messages`（Anthropic 格式）并返回中文指引：该端点对应 opencode zen 上游对推理模型多轮/工具调用存在缺陷（`Error from provider (Console): ... reasoning_content must be passed back` / `Empty input messages`），透传只会得到迷惑的 400；请将客户端配置为 OpenAI 兼容格式使用 `/v1/chat/completions`。
- **`/v1/responses` 字符串 input 归一化** — zen 上游要求数组格式 `input`（字符串会报「Empty input messages」400），网关自动转换为数组格式，修复 Codebuff 等客户端调用。
- **`/v1/responses` reasoning 字段冲突归一化** — Codebuff 等客户端请求体同时携带顶层 `reasoning_effort` 与嵌套 `reasoning.effort`（值冲突）时，zen 上游返回 400 `"reasoning_effort" and "reasoning.effort" are both provided with conflicting values`；网关转发前删除顶层重复字段、保留 Responses API 标准嵌套字段（单独出现顶层 `reasoning_effort` 时原样透传，上游接受）。
- **账号导入保留当前使用账号** — 导入 Key 时此前会把「当前使用账号」重置为列表第一个；现在导入保持原激活账号不变，新账号仍不自动分配代理、已有账号/代理/外部调用配置不受影响。
- **代理批量导入去重** — 同一节点（协议+主机+端口，忽略用户名/密码与大小写）只保留首次出现，跳过重复节点并提示数量，不再重复测试/重复绑定。
- **设置页外部调用状态提示** — 未设置 API Key 时状态行明确显示「未设置 API Key，服务未启动」（橙色），保存提示同步说明，不再笼统显示「已停止」。

## v0.9.18 — 2026-08-09（正式版）

### 新增
- **DeepSeek 用量监控（余额 / 本次回复 / 窗口费用）** — 底部统计条新增「余额」chip：使用 DeepSeek 官方 API（provider=deepseek）时显示账户实时余额（`GET /user/balance`，回合结束自动刷新，失败静默隐藏）；统计弹窗新增「本次回复」区块（最近一回合输入/输出/缓存/费用）；凡模型名包含 `deepseek-v4-flash` / `deepseek-v4-pro` 的消息（含 zenmux 等网关代理，不限官方 provider）费用均按 DeepSeek 官网 CNY 刊例价实时折算显示 `¥`（flash ¥1/2/¥0.02 缓存，pro ¥3/6/¥0.025 缓存），窗口统计按「官网价 ¥ / 其它模型 $」双货币分行汇总，全部文案中文显示。
- **OpenCode Zen 外部调用（OpenAI 兼容网关）** — 设置页 OpenCode Zen 页新增「外部调用」区块：启用后监听 `http://127.0.0.1:7474/v1`，可设置/生成外部 API Key（Bearer 认证），Cline / Roo Code / Open WebUI 等外部工具可直接以 OpenAI 兼容方式调用，复用账号/代理池与 429 自动切号、冷却逻辑；`/v1/models` 仅返回免费模型（`-free` 后缀）；支持流式（SSE）输出；端口与 Key 修改保存后热生效，无需重启；仅监听本机回环地址，可通过 cloudflared 等隧道对外暴露。外部调用区块展示**调用地址与调用方式**（baseURL + curl 示例 + 客户端配置说明）；**API Key 生成后明文仅显示一次**（可随时复制，保存后不再显示明文）；未配置 Key 不启动。
- **MCP 服务器配置页** — 设置新增「MCP」标签页：可视化增删改 `~/.pi/agent/mcp.json` 服务器（stdio/sse/http 传输、eager/lazy 生命周期、启动参数、请求超时、环境变量 JSON），服务器名白名单校验，重启 pi 后生效。
- **子代理（Subagents）配置页** — 设置新增「子代理」标签页：配置 `subagents.json` 并发数/最大轮数/宽限轮数/加入模式/调度/模型范围/舰队视图/输出转录等（字段白名单，未知键丢弃），并列出 `agents/*.md` 已发现代理（frontmatter 容错解析）。
- **#snippet 片段补全** — 用户可定义常用代码/文本片段，输入 `#` 时弹出补全列表，选中即展开到输入框；设置页「片段」标签页管理增删改。
- **主题语义 token 扩展** — 主题系统新增状态色（error/warning/success/info）与代码语法高亮色（keyword/string/number/function/comment）语义 token，全部内置/用户主题输出统一映射；明暗主题独立记忆。
- **OpenCode Zen 429 日限额冷却** — 账号返回 429 视为当日免费额度耗尽，冷却至次日 UTC 0 点自动重置（不再按固定毫秒数冷却）；日级冷却账号不会被冷却池兜底/最近成功账号回退硬试；全池日限额时返回 503 且 `Retry-After` 指向 UTC 0 点；外部调用收到 429 时返回 OpenAI 格式提示「当前账号已限额，请重新请求」，客户端重试即自动换号。
- **OpenCode Zen 429 轮换增强** — 单请求最多尝试 3 个账号（剩余留给后续请求）；全败后回退最近成功账号。

### 修复
- **LAN 写接口安全加固** — pi-web 默认监听 0.0.0.0（手机/局域网可直接访问）后，所有写接口（POST/PUT/PATCH/DELETE）要求浏览器同源 Origin 校验：局域网内 curl/脚本等无 Origin 客户端只能读取、不能改写配置（MCP/子代理/OpenCode Zen 等），明文 Key 读取接口同样受保护；外部网关请求体加 64MB 上限（超限 413）。
- **切换当前使用账号不再清空账号列表** — 设置页切换「当前使用账号」时仅提交 `activeAccountId`，此前合并逻辑会把账号数组误判为空导致全部账号被清空。
- **同步链路三连修复** — 总线事件白名单补 `agent_start`/`message_start`（修复手机发消息电脑端内容不同步）；deferred 思考内容跨设备加载失败自动重试；排队消息自愈（非空 `queue_update` 后延迟 `get_state` 对账）。
- **clear_queue 可靠性** — clear_queue 移出免重建捷径（wrapper 回收后召回不再丢文本）；顺带清理 queue-store 侧car、联动模型缓存。
- **Pi CLI 格式主题** — 语法高亮色映射生效（此前 CLI 主题的语法色未正确映射到 Web token）。
- **命令行启动默认不自动打开浏览器** — 需 `--open` 才打开。
- **移动端设置 tab 栏** — 可横向滚动，不再截断。
- **分支导航入口常驻** — 线性会话也显示分支按钮（此前无分支时会隐藏，用户无法发现导航入口）。
- **消息操作按钮** — 触摸设备常显（不再依赖 hover）；答案消息可分叉。
- **工具预设选择器默认隐藏** — 仅计划模式显示，避免误触。
- **OpenCode Zen 模型列表去重** — 只注入默认 opencode 网关 key，`opencode-go` 不再双分组。

## v0.9.18-beta.1 — 2026-08-08

### 新增
- **多客户端实时同步** — 服务端新增全局会话事件总线与 `/api/events` SSE：一个窗口发送/新建消息后，其他窗口（同一实例）秒级同步会话列表、消息内容与运行状态，无需刷新；空闲期 SSE 保活（120 秒宽限 + 总线兜底）。
- **OpenChamber 主题迁移合并** — 内置主题从 7 套扩到 24 套（Flexoki、Kanagawa、Tokyo Night、Dracula、Nord、Monokai 等 22 套 OpenChamber 主题迁移，重名时原 QT 主题优先）；主题设置中每个主题显示**真实主题色圆点**（修复所有主题圆点同色的 bug）；OpenChamber 分层格式主题 JSON 可直接放入 `~/.pi/agent/themes/` 使用，无需转换。
- **对话框体验增强** —
  - 助手回复支持**复制纯文本 / 复制 Markdown** 双格式；
  - 离开底部时显示**滚动到底**悬浮按钮；
  - 每条回复显示**本轮改动文件徽章**（点击展开可打开文件）；
  - 输入框上方显示**任务状态行**（进行中/待办，点击打开任务看板）；
  - 新消息**淡入动画**（尊重系统减弱动态效果设置）。
- **OpenCodeZen 供应商管理** — 设置新增 OpenCode Zen 页：多账号/代理池管理，模型下拉显示当前激活账号；错误日志页（分级/来源过滤）；视觉模型配置（provider/baseUrl/model/maxTokens）。

### 修复
- **冷启动提速** — `modelRuntime.getAvailable()` 结果加 60 秒进程级缓存：会话 wrapper 冷启动从 20 秒+降到 2 秒内（此前切换会话/重新连接 SSE 需等待模型列表网络拉取）；abort/clear_queue 在无活跃会话时直接返回（不再花 20 秒重建）；wrapper 空闲存活从 10 分钟延长到 30 分钟。
- **运行状态转圈残留** — `steer`/`follow_up`（目标模式循环大量使用）结束后清理运行阶段标记，不再残留「等待模型」转圈。
- **plan/goal 模式提示词精简** — 模式指令块（计划/目标/档位）只注入一次：同一会话内后续消息不再重复携带提示词，切换窗口/会话后按会话作用域重新注入。
- **模型列表缓存 SWR** — `/api/models` 上游故障不再让当前渲染丢失可用缓存。
- **平板模型名溢出** — 模型按钮宽度自适应视口，OpenCode Zen 分组标题超长截断。
- **diff 解析与 markdown 修复** — unified diff 解析 hunk 内误判 `---/+++`；remarkGfm 关闭单波浪线删除线（保留 CJK 数字范围写法）。

### 移除
- 草稿预设快捷提示（用户确认不需要）；Git 变更栏（左侧面板已有）。

## v0.9.17 — 2026-08-07（正式版）

### 升级
- **底层 pi 升级到 0.84.0** — `@earendil-works/pi-*` 四包 0.83.0 → 0.84.0（随上游 agegr/pi-web v0.8.7）。适配了 0.84 的 API 变化：`Theme` 构造收紧（`PlainTextTheme` 补 `selectedBg`）、`apiKeyAuth.login()` 需要 `req.signal`（含测试断言）。

### 新增
- **每个会话独立记忆模式配置** — 任务模式（常规/计划/目标）、运行档位（轻量/均衡/交付）、工具权限（批准/自动/Yolo）与权限规则现在按会话分别保存：新会话继承全局默认，已有会话各自记住自己的设置，切换会话不再互相覆盖（settings.json 新增 `modesPerSession`，旧会话无记录时自动回落全局默认）。
- **display math 规范化**（上游 #332）— 行内 `$$…$$`、多行公式、嵌套列表里的公式（粘连开/闭分隔符、懒续行缩进）都能被 remark-math 正确解析，不再出现公式吞掉后续文本或整段渲染成 KaTeX 错误块。
- **编辑用户消息恢复图片**（上游 #336）— 「从这里编辑」现在把消息的文本与图片一起回填到撰写栏：图片恢复为待发送附件，文本恢复到输入框。
- **随屏滚动完善**（上游 #333 部分）— streaming 期间仅在接近底部时跟随输出（用户上翻后不再被拉走），`scrollUserMsgToTop` 增加底部边界钳制。

### 导入修复（Windows）
- **Windows 导入会话不识别修复** — Reasonix 数据根目录新增 `%APPDATA%/reasonix`（Windows 桌面版 v1.x / Go/Wails 布局）与 `~/.reasonix` 双根发现：`reasonixHomeDirs()` 去重候选，projects 布局 + sessions 平铺布局跨根扫描合并，Windows 下 `discover` 实测可发现 43 个会话（历史 mac/CLI 布局不受影响）。

### 说明
- 上游 #321 Catppuccin 文件图标未合并：QT 已有更全的自研图标体系（latte/mocha 各 656 个），跳过。
- 上游 #338 斜杠命令折叠已由 QT 既有 `resolveSlashDisplayText` 覆盖显示层，本次补齐编辑回填链路（`replaceMessage`）。

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

