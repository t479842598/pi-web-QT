# Pi Web Desktop — Tauri 2 桌面端

Pi Web 桌面端：**Tauri 2（Rust）瘦壳 + WebView 加载 Pi Web**。壳只负责平台能力（窗口/托盘/凭据/本地服务检测与拉起/自更新），主窗口直接加载 Pi Web 完整 UI——功能与网页端 100% 对齐，数据天然同步（全部在 Pi Web 服务端 `~/.pi/agent/`，连同一实例即一致）。

架构与选型背景见 [`.lrnev/scenes/05-desktop/`](../.lrnev/scenes/05-desktop/)。

## 功能

- **设置服务器 URL**：启动进入连接页（无上次服务器时），弹窗填写 URL+密码（用户名固定 `pi`，Basic Auth）保存多台服务器；「获取本机链接」按钮自动探测本机运行的 Pi Web 地址填入；「启动本机 Pi Web」一键拉起 CLI。
- **本机服务检测**：连接页显示本机服务状态（401 带密码的服务也能正确识别）。
- **主窗口内来回切换服务器**：主窗口菜单栏「服务器」菜单（macOS 在系统菜单栏）列出全部服务器，点击即把当前窗口导航到目标服务器，可来回切换；托盘菜单「连接管理…」打开设置，列表项新开/聚焦窗口。
- **多服务器同时连接**：每台服务器一个独立窗口，托盘菜单随时切换/新开。
- **密码安全存储**：系统钥匙串（macOS Keychain / Windows Credential Manager / Linux Secret Service），配置文件不落明文；Linux 无 Secret Service 时降级明文并告警。
- **托盘常驻**：关闭窗口 = 隐藏到托盘，托盘菜单退出才真正退出。
- **自更新**：tauri updater（发布 CI 启用 `updater` feature 时生效）。

## 发布

正式打包走 GitHub Actions：打 `v*` tag 触发 `release-all.yml`，一次产出两个移动端（`mobile/` → pi-web-*、`mobile2/` → pi-web-new-*）和桌面端三平台安装包。版本号统一跟随 web（`node scripts/sync-version.mjs` 同步三端）。

## 开发

前置：Rust 工具链、Node 22（仅用于生成图标/同步版本号）。

```bash
cd desktop
cargo run          # 开发运行（连接页/主窗口按启动路由弹出）
cargo test         # 核心逻辑单测（Basic Auth 编码/配置往返/探测候选）
cargo check --features updater   # 验证 updater 发布路径可编译
```

> 连接页是壳内静态资源（`desktop/ui/`），改完直接生效，无需构建前端。

## 版本号同步

桌面端版本号**跟随 web 端**（`package.json`）。发版前执行：

```bash
node scripts/sync-version.mjs   # 读 package.json version → 写 desktop/tauri.conf.json
```

## 打包

```bash
npm i -g @tauri-apps/cli   # 或用 npx
cd desktop && npx tauri build --config bundle.macos.conf.json          # macOS .app/.dmg
cd desktop && npx tauri build --config bundle.windows.conf.json        # Windows NSIS
cd desktop && npx tauri build --config bundle.linux.conf.json          # Linux deb/rpm/AppImage
```

CI：`.github/workflows/desktop-release.yml`（tag `desktop-v*` 触发，tauri-action 三平台构建 + 签名产物）。

### updater 发布密钥

- 公钥已写入 `desktop/tauri.conf.json` 的 `plugins.updater.pubkey`（可提交）。
- 私钥：`desktop/.keys/piweb-updater.key`（**已 gitignore，切勿提交**）+ 密码 `desktop/.keys/piweb-updater.key.pass`。
- CI 需要仓库 Secrets：`TAURI_SIGNING_PRIVATE_KEY`（私钥内容）、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 发布构建需 `--features updater`（workflow 已带）并给 capabilities 注入 `updater:default`（workflow 已带）。

## 目录

```
desktop/
  src/
    main.rs      入口
    lib.rs       Builder / 启动路由 / 窗口关闭拦截
    config.rs    服务器列表持久化（atomic 写）
    keyring.rs   系统钥匙串密码存取
    probe.rs     本地探测 + pi-web CLI 查找/拉起
    window.rs    连接页/主窗口/托盘/多窗口管理
    commands.rs  IPC 命令（连接页调用）
    tests.rs     核心逻辑单测
  ui/            壳内连接页（静态 HTML/CSS/JS，无构建）
  icons/         tauri icon 产物（app-icon.svg 为源图）
  capabilities/  IPC 能力声明
  bundle.*.conf.json  三平台打包配置
```
