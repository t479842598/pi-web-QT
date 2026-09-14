# Pi Web Desktop — Tauri 2 桌面端

Pi Web 桌面端：**Tauri 2（Rust）瘦壳 + WebView 加载 Pi Web**。壳只负责平台能力（窗口/托盘/凭据/本地服务检测与拉起/自更新），主窗口直接加载 Pi Web 完整 UI——功能与网页端 100% 对齐，数据天然同步（全部在 Pi Web 服务端 `~/.pi/agent/`，连同一实例即一致）。

架构与选型背景见 [`.lrnev/scenes/05-desktop/`](../.lrnev/scenes/05-desktop/)。

## 功能

- **打开即用**：启动直接进入主界面——自动确保本机内置后端在跑（已在跑则直接复用），不再要求先经过连接页或设置密码。上次用的是远程服务器则尊重该偏好直连；内置后端与 CLI 都不可用时才回退连接页。
- **默认仅本机可访问**：未设置访问密码时内置后端只绑 `127.0.0.1:30141`（免密且安全，同网段设备连不上）；只有你在「远程访问」里主动设置密码，才改绑 `0.0.0.0` 并启用 Basic Auth（用户名固定 `pi`），供手机/其他设备/隧道访问。
- **自动继承数据**：内置后端与 CLI、开发模式共用 `~/.pi/agent/`，装好打开就能看到既有会话与已配置的模型，无需导入。
- **右上角切换服务器**：主界面右上角图标（桌面壳内显示）打开/聚焦独立的受信任壳内「连接管理」窗口，可切换已保存服务器、添加远程地址；密码表单不进入服务器文档，远程页（包括经本地代理加载的页面）没有服务器管理 IPC 权限。首次进入有一次性引导提示说明入口位置。
- **本机服务检测**：连接页显示本机服务状态（401 带密码的服务也能正确识别）。
- **服务器切换入口**：macOS 系统菜单栏「服务器」菜单由 Rust 授权后导航当前聚焦的服务器窗口，无聚焦目标时使用已有服务器窗口；Windows/Linux 不挂原生服务器菜单，使用右上角入口或托盘。托盘「连接管理…」打开壳内管理窗口，服务器列表项新开/聚焦服务器窗口。网页的 `piweb-switch://manage` 只打开连接管理，按服务器 ID 切换的 `piweb-switch` 导航被拒绝，旧服务器文档不能借此选择其他服务器凭据。
- **多服务器同时连接**：每台服务器一个独立窗口，托盘菜单随时切换/新开。
- **密码存储**：密码明文存本机配置文件（`config.json`，位于系统配置目录，权限 0600），避免弹钥匙串授权框；设置一次后免密连接。
- **远程凭据自动注入**：保存了密码的服务器经壳内本地反向代理访问（`127.0.0.1:<port>`），首屏/子资源/API/SSE 全部自动携带 Basic Auth（用户名+密码），无需在 WebView 弹框里重输；同一 origin（协议、主机和有效端口不变）下修改用户名/密码，已打开的代理窗口在后续请求中立即使用新凭据。（代理仅监听 127.0.0.1；本机其他进程可借此免密访问对应远程服务，与 config.json 明文密码同级别的本机信任假设。）
- **跨 origin 编辑须重新连接**：更改地址的 origin 不继承原密码，密码留空即清除；需要密码时请重新填写，并在壳内连接管理点击「连接」。带密码连接会启用新的本地代理端口，旧代理拒绝后续请求（403），不会转发到新服务器或使用新凭据。
- **Basic-only 代理边界**：代理只注入 Basic Auth，不转发任何请求 `Cookie` 或响应 `Set-Cookie`（包括 `Cookie2`/`Set-Cookie2`），不保存 Cookie，不支持额外依赖 Cookie 登录的网关。此限制仅针对桌面本地代理，浏览器直接访问 Pi Web 的原有 Cookie 登录不受影响。
- **托盘常驻**：关闭窗口 = 隐藏到托盘，托盘菜单退出才真正退出。
- **自更新**：tauri updater（发布 CI 启用 `updater` feature 时生效）。

## 发布

正式打包走 GitHub Actions：打 `v*` tag 触发 `release-all.yml`，一次产出两个移动端（`mobile/` → pi-web-*、`mobile2/` → pi-web-new-*）和桌面端三平台安装包。版本号统一跟随 web（`node scripts/sync-version.mjs` 同步三端）。

## 开发

前置：Rust 工具链、Node 22（仅用于生成图标/同步版本号）。

```bash
cd desktop
cargo run          # 开发运行（打开即用：自动连本机内置后端并直接进入主界面）
cargo test         # 核心逻辑单测（Basic Auth 编码/配置往返/探测候选）
cargo check --features updater   # 验证 updater 发布路径可编译
```

> 连接页是壳内静态资源（`desktop/ui/`），改完直接生效，无需构建前端。

## 版本号同步

桌面端版本号**跟随 web 端**（`package.json`）。发版前执行：

```bash
node scripts/sync-version.mjs   # 读 package.json version → 同步 tauri.conf.json / Cargo.toml / 移动端
```

## 打包

```bash
npm i -g @tauri-apps/cli   # 或用 npx
cd desktop && npx tauri build --config bundle.macos.conf.json          # macOS .app/.dmg
cd desktop && npx tauri build --config bundle.windows.conf.json        # Windows NSIS
cd desktop && npx tauri build --config bundle.linux.conf.json          # Linux deb/rpm/AppImage
```

CI：`.github/workflows/release-all.yml`（tag `v*` 触发，tauri-action 三平台构建 + 签名产物）。

### updater 发布密钥

- 公钥已写入 `desktop/tauri.conf.json` 的 `plugins.updater.pubkey`（可提交）。
- 私钥：`desktop/.keys/piweb-updater.key`（**已 gitignore，切勿提交**）+ 密码 `desktop/.keys/piweb-updater.key.pass`。
- CI 需要仓库 Secrets：`TAURI_SIGNING_PRIVATE_KEY`（私钥内容）、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 发布构建需 `--features updater` 并给 capabilities 注入 `updater:default`（`release-all.yml` 的「Inject updater capability」步骤在构建前自动注入；本地开发不启用该 feature）。

## 目录

```
desktop/
  src/
    main.rs      入口
    lib.rs       Builder / 启动路由 / 窗口关闭拦截
    config.rs    服务器列表持久化（atomic 写；密码明文存配置）
    probe.rs     本地探测 + pi-web CLI 查找/拉起（Windows 兼容 .cmd shim / CREATE_NO_WINDOW）
    window.rs    连接页/主窗口/托盘/多窗口管理
    commands.rs  IPC 命令（连接页调用）
    tests.rs     核心逻辑单测
  ui/            壳内静态页（无构建）：index.html 连接页、loading.html 启动等待页
  icons/         tauri icon 产物（app-icon.svg 为源图）
  capabilities/  IPC 能力声明
  bundle.*.conf.json  三平台打包配置
```
