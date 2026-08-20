# Pi Web 桌面端：后端内置（即开即用）— 技术选型与架构评审

> 目标：把 pi-web-QT 从「连 localhost 网页的壳子」升级为「把后端服务（Next.js + Node 运行时 + 全部依赖）完整打包进桌面应用内部」的自包含桌面应用——**双击即用，无需 npm install、无需命令行启动**。
>
> 文档性质：技术选型 / 架构评审（研究 + 决策建议），不含代码改动。
> 事实核查日期：2026-08-19（版本号均为当日通过官方源核实）。

---

## 0. 结论速览（TL;DR）

> **范围界定**：本文档范围 = **仅打包后端、即开即用**（把 Next.js 服务 + Node 运行时 + 全部依赖打进安装包，双击即用，无需 npm install / 无需命令行启动）。**不含本地模型推理**（llama.cpp / Ollama / GGUF 下载、models.json 自定义 provider 等均不在范围内，已整体砍掉）。

- **桌面框架：继续用 Tauri v2**，把现有 `desktop/` 从「瘦壳（连外部 pi-web）」演进为「胖壳（内嵌并拉起 Node 后端）」。首选 Tauri，备选 Electron。
- **后端内置：Next.js `output: 'standalone'` + 内置 Node 二进制（sidecar）**。放弃 Node SEA / pkg / bun compile（见 3.1）。
- **打包分发：tauri-bundler（已配好）+ tauri-plugin-updater（已配好）+ macOS 签名公证（需补）+ 三平台 CI（已配好）**。
- **首要动作**：打通「Tauri 内嵌 Node standalone 后端」这条链路（即 M1）。

---

## 1. 现状盘点与关键洞察

### 1.1 现有 `desktop/` 是什么

探查结论：`desktop/` 已是**可用的 Tauri v2（Rust）瘦壳**，产物与工具链齐全，复用价值高：

- `Cargo.toml`：Tauri 2（`tray-icon`）、`tauri-plugin-single-instance`、`tauri-plugin-updater`（optional feature `updater`）、`hyper`/`hyper-util`（内置本地反向代理）、`ureq`/`reqwest`（探测/拉取）。release profile 已开 `strip/lto/codegen-units=1`。
- `src/`（约 2000+ 行，含单测）：`main.rs` / `lib.rs`（启动路由）、`config.rs`（服务器列表持久化）、`probe.rs`（**本机 pi-web CLI 探测与拉起 `spawn_local()`**）、`proxy.rs`（带凭据服务器反向代理注入 Basic Auth）、`window.rs`（连接页/主窗口/托盘/多窗口/菜单）、`commands.rs`（IPC）、`tests.rs`。
- `tauri.conf.json`：`frontendDist: "ui"`（壳内静态连接页），`plugins.updater.pubkey` 已写死、`endpoints` 指向 GitHub Releases `latest.json`。
- `capabilities/default.json`：连接页窗口的 IPC 权限。
- `bundle.*.conf.json`：三平台打包配置（macOS app/dmg、Windows NSIS、Linux deb/rpm/AppImage）。
- `.github/workflows/release-all.yml`：打 `v*` tag 三平台并行构建 + tauri-action 发布。

**关键点**：`probe.rs::spawn_local()` 已经在做「找到 pi-web 可执行文件并拉起」这件事——这正好是「内置后端」要改造的唯一切入点：从「在 PATH/常见目录里找 `pi-web`」改成「优先拉起随包内置的 standalone server」。

### 1.2 后端结构：Next.js standalone 可行性

- `package.json`：Next.js `16.2.12`、React 19、Node `>=22.19.0`；依赖 `@earendil-works/pi-*@0.84.0`、`undici`（有 CVE 修复脚本 `bin/fix-pi-agent-undici.js`）、`mermaid`/`katex`/`react-markdown` 等重依赖；`allowScripts` 含 `sharp`（native，供 Next 图片优化）。
- `next.config.ts`：`serverExternalPackages` 已把 `@earendil-works/pi-*` 声明为外部包（关键——否则 pi SDK 会因动态 require 在打包/standalone 分析中被 `@vercel/nft` 漏掉）；`experimental.proxyClientMaxBodySize: "600mb"`。
- 启动链：`bin/pi-web.js`（resolve `next/dist/bin/next` → spawn `node next start -p -H`）→ `bin/with-memory-limit.js`（V8 `--max-old-space-size=3072` 压堆）→ `bin/fix-pi-agent-undici.js`（修 pi-coding-agent 的 shrinkwrap undici CVE）。

**结论**：后端是标准 Next.js 服务，`output: 'standalone'` 完全适用（下一节展开）。需要注意 `serverExternalPackages` 的 pi-* 必须以 `node_modules` 形式存在于 standalone 产物中，且 `undici` 的修复脚本要在内置启动前执行（对应现有 `bin/fix-pi-agent-undici.js`）。

### 1.3 关键洞察：后端 provider 复用既有配置

后端内不内置本地模型推理；模型调用仍走远程 provider，pi 的模型层（`@earendil-works/pi-ai`）会自动复用 `~/.pi/agent` 下既有配置（含自定义 provider），因此内置后端无需改动 SDK 的模型接入逻辑。

### 1.4 需求边界

- **不包含**：账号体系、跨设备同步（本地数据在 `~/.pi/agent/`，天然单机）；替代 pi SDK 的会话/工具执行引擎；把 UI 静态打包进壳（UI 继续由内置 Next.js 服务渲染）；本地模型推理（llama.cpp / Ollama / GGUF 下载等）。
- **包含**：后端服务内置（Next.js + Node 运行时 + 全部依赖）、打包分发、自动更新、签名公证。

---

## 2. 桌面端框架选型

### 2.1 候选与一句话定位（2026-08 事实）

| 框架 | 最新版本 | 渲染 | 后端语言 |
|---|---|---|---|
| **Electron** | v43 stable（2026-07，Chromium 150 / Node 24.16）；v44 alpha | 自带 Chromium | Node.js |
| **Tauri v2** | 2.11.x 线（项目已用 `@tauri-apps/cli ^2.11.4`） | 系统 WebView（macOS WKWebView / Win WebView2 / Linux WebKitGTK） | Rust |
| Wails v2/v3 | v2 stable，v3 alpha/beta | 系统 WebView（同 Tauri） | Go |
| Neutralino | 活跃但小众 | 系统 WebView | C++/原生，无 Node |
| 原生（Qt/Flutter/Compose） | — | 原生控件 | 各自语言 |

### 2.2 逐项优劣对比（按需求逐条）

**① 包体大小**

- Electron：80–300MB（自带完整 Chromium + Node）。本场景因还要打包 Node 后端，最终 ~250–400MB。
- Tauri：壳 5–15MB；但本场景需额外内置 Node 二进制（~50–90MB）+ standalone 后端（~80–150MB），最终 **~140–250MB**。仍比 Electron 省 ~100MB+，主要省在「不打包 Chromium」。
- Neutralino：壳 2–5MB，最轻，但生态/成熟度不足以承载本项目。

**② 内存占用（空闲）**

- Electron：空窗口 ~150–250MB（Chromium）。加上 Node 后端（V8 ~150–250MB），总计空闲 ~300–500MB。
- Tauri：WebView 30–80MB。加上同等的后端进程，总计 ~180–330MB。**省下的就是那一整份 Chromium 常驻**。
- 诚实说明：一旦「后端」成为主体，两者内存差距被稀释；但 WebView vs Chromium 的 ~150–250MB 常驻差是实实在在的。

**③ 冷启动**

- Electron：1–3s（Chromium init + V8 boot）。
- Tauri：壳 0.2–0.8s；但本场景冷启动瓶颈是「Node 后端就绪」，壳本身的启动优势被部分掩盖。仍比 Electron 快（少了 Chromium 预热）。

**④ WebView vs Chromium**

- Chromium（Electron）：渲染三平台**完全一致**，CSS/WebGL/Service Worker 全兼容，无平台差异。
- WebView（Tauri）：Windows WebView2 也是 Chromium（最兼容）；macOS WKWebView 有 Safari 差异；**Linux WebKitGTK 明显落后**（CSS/编解码/JS 引擎坑最多）。本项目 UI 是标准 React+Tailwind 的 coding-agent 工作台，未发现需要 Chromium 独有特性的点；但「三端像素级一致」是 Electron 的硬优势，需在决策中明示。

**⑤ 是否需要 Rust 工具链**

- Tauri：**需要**。但本项目已具备：`desktop/` 有完整 Cargo 工程 + CI 已配 `dtolnay/rust-toolchain` + Linux 系统依赖 + 三平台构建。此成本已支付。
- Electron：纯 JS/TS，无 Rust；但项目团队已有 Rust 侧代码，学习成本也不是零起点。

**⑥ 后端内置方式（本场景的关键差异）**

去掉本地推理后，「原生模块（llama.cpp 等）跨平台编译」这一维度已失效；真正的关键权衡变成「后端怎么内置」：

- **Electron 自带 Node 运行时**：后端 Next.js standalone 可直接跑在 Electron 主进程或 `utilityProcess` 里，**无需再内置一份独立 Node 二进制**——「后端内置」这条链路 Electron 更省事（少维护一个 sidecar 二进制与三端 × 2 arch 的版本矩阵）。
- **Tauri 需额外内置 Node 官方二进制 sidecar**（`externalBin` + `-$TARGET_TRIPLE` 后缀，专为「随包内置外部二进制」设计）：多一步内置与生命周期管理，但换来的是一整份 Chromium 的体积/内存节省 + 现有 `desktop/` 壳的完全复用。

**⑦ 与现有 `desktop/` Rust 产物的契合度**

- **Tauri：极高**。托盘、多窗口、服务器列表、Basic Auth 反向代理、本机服务探测/拉起、自更新全部现成，改动聚焦在「拉起内置后端」。
- Electron：**需要重写整套壳**（托盘/多窗口/代理/更新都要用 Electron 重做），与现有 Rust 产物零复用，成本显著；但其「后端内置」最省事（自带 Node）。

### 2.3 综合对比表

| 维度 | Tauri v2（首选） | Electron（备选） | Wails | Neutralino |
|---|---|---|---|---|
| 包体（本场景） | ~140–250MB | ~250–400MB | 同 Tauri | 最小但不可行 |
| 空闲内存 | 中（省 Chromium） | 高 | 中 | 低 |
| 冷启动 | 快 | 慢 | 快 | 快 |
| 渲染一致性 | 三端有差异（Linux 差） | **完全一致** | 同 Tauri | 同 Tauri |
| Rust 工具链 | 需要（已具备） | 不需要 | Go | C++ |
| 后端内置 | 需内置 Node sidecar（多一步） | **自带 Node（最省事）** | 同 Tauri | 弱 |
| 复用现有 desktop/ | **极高** | 无（重写） | 无 | 无 |
| 生态/更新/签名 | 成熟（v2） | 最成熟 | 一般 | 弱 |

### 2.4 小结

**选 Tauri v2 的决定性理由是「复用现有 desktop/ Rust 壳」**，其次才是体积/内存。需如实标注：**Electron 在「后端内置」上更简单**（自带 Node 运行时，无需独立 Node sidecar）。若未来出现「三端渲染必须 100% 一致」的硬需求，再评估 Electron 迁移，但当前需求下 Electron 意味着推倒重写，不划算。

---

## 3. 运行环境内置方式

### 3.1 Node.js 后端怎么打包进去

| 方案 | 结论 | 理由 |
|---|---|---|
| **`output: 'standalone'` + 内置 Node 二进制** | ✅ **推荐** | 官方、稳定；产出 `.next/standalone/server.js` + 精简 node_modules（~80–150MB，vs 完整 node_modules 300–800MB）；只需额外内置一个 Node 官方二进制。 |
| Node SEA（`--build-sea`，v25.5+） | ❌ 不适用 | 需要把应用打包成**单个 JS 文件**（Next.js 是复杂多文件服务，无法单文件化）；native 模块（sharp、以及 standalone 里的 .node）**无法打进 blob**，仍需外置；ESM 模式下无 V8 code cache。适合 CLI 工具，不适合 Next.js 服务。 |
| vercel/pkg | ❌ 弃用 | 2024-01 已归档，CVE-2024-24828 未修。 |
| bun compile | ⚠️ 不建议 | 换运行时，Next.js 在 bun 上的兼容性非官方支持，风险高；体积/启动优势对本场景意义不大。 |
| nexe | ⚠️ 不推荐 | 需自建 Node 构建，维护成本高。 |

**推荐实现**（对齐现有 `probe.rs::spawn_local()`）：

1. `next.config.ts` 增加 `output: 'standalone'`；`next build` 后把 `.next/standalone` + `.next/static` + `public` 作为资源内置（注意 `serverExternalPackages` 的 pi-* 会以 node_modules 形式出现在 standalone 里，需保留；`undici` CVE 修复仍需在启动前跑 `fix-pi-agent-undici`）。
2. Node 官方二进制按平台/arch 以 **Tauri sidecar**（`externalBin`）内置；Rust 侧新增 `spawn_local()` 分支：优先拉起内置 `node .next/standalone/server.js -H 127.0.0.1 -p <随机端口>`，找不到再回退旧逻辑（PATH 找 `pi-web`）。
3. 端口：沿用「随机端口 + 前端轮询 `/api/home` 健康探测」的既有机制；Windows 用 `CREATE_NO_WINDOW` 抑制黑框。

> 为何不在 Tauri Rust 里用 `http` 直接内嵌一个精简 server 替代 Next.js？——不可行：UI 是 Next.js SSR + 大量 `/api/*` 路由 + pi SDK 进程内 AgentSession，重写等价于重写整个后端，价值为负。

### 3.2 推荐组合

```
Tauri 壳（Rust）
 ├─ Node 官方二进制（sidecar）           → 跑 .next/standalone/server.js（内置后端）
 └─ WebView 加载 http://127.0.0.1:<port>（内置后端渲染的完整 UI）
```

---

## 4. 打包与分发

### 4.1 electron-builder vs tauri-bundler

- **tauri-bundler（已配好）**：`bundle.*.conf.json` 已覆盖 macOS app/dmg、Windows NSIS、Linux deb/rpm/AppImage；tauri-action 三平台 CI 已就绪。加 sidecar 只需补 `externalBin` + `resources`。
- electron-builder：仅当迁 Electron 才需要，成熟但本方案用不到。
- **结论：沿用 tauri-bundler，零额外选型。**

### 4.2 目标平台与格式

| 平台 | 格式 | 现状 |
|---|---|---|
| macOS | `.app` / `.dmg` | 已配；**需补签名 + 公证**（见 4.4） |
| Windows | NSIS（可考虑 MSI） | 已配 NSIS；需代码签名证书（EV/OV） |
| Linux | AppImage / deb | 已配；AppImage 免依赖、deb 需补依赖声明 |

### 4.3 自动更新

- **tauri-plugin-updater（已配）**：`plugins.updater.pubkey` 已写死、`endpoints` 指向 GitHub Releases `latest.json`；CI 已注入 `updater` feature + capability + 签名私钥 Secret。**沿用即可**。
- 注意点：tauri updater 是全量二进制下载（对 ~5MB 壳无感，但本方案整体包 ~150–250MB，全量更新偏重）。
- electron-updater：仅 Electron 路径需要（支持差分更新，但此处用不到）。

### 4.4 代码签名 / 公证（关键补课项）

macOS（Apple Silicon 上无签名直接被杀）：
- 需 **Developer ID Application 签名 + 公证（notarytool）+ stapler**；Hardened Runtime（`--options runtime`）。
- V8（Node）运行时需要 JIT/可执行内存，需声明 entitlement：`com.apple.security.cs.allow-jit`。
- 现状：`bundle.macos.conf.json` 里 `signingIdentity: null`（未签名），CI 未做公证——**这是上线前必须补的一项**。

Windows：需 EV/OV 代码签名证书（~$200–700/年），否则 SmartScreen 拦；NSIS 安装器本身也要签。

### 4.5 体积 / 足迹估算（每 arch，压缩前约值）

| 组件 | 估算 |
|---|---|
| Tauri 壳 | 5–15MB |
| Node 官方二进制 | 50–90MB |
| `.next/standalone` + static + public | 80–150MB（本项目依赖重，偏上） |
| **安装包合计** | **~140–250MB** |
| 空闲内存（WebView+后端） | ~180–330MB |

---

## 5. 推荐方案

### 5.1 首选：Tauri v2 + 内置 Node standalone（sidecar）

- 复用现有 `desktop/` 全部能力；改动集中在 `probe.rs`（拉起内置后端）。
- 后端：`output: 'standalone'` + 内置 Node 官方二进制（sidecar）。
- 分发：tauri-bundler + tauri-updater + 补 macOS 签名公证。

### 5.2 备选 A：Electron + 进程内后端（自带 Node，无需独立 Node sidecar）

- 适用：未来要求「三端渲染完全一致」或「纯 JS 团队、彻底远离 Rust」。
- 后端：自带 Node 运行时，standalone 后端可直接跑在 Electron 主进程或 `utilityProcess` 里，**无需内置独立 Node 二进制**（后端内置最省事）。
- 代价：重写整壳；体积/内存更高（Chromium）。

### 5.3 两方案对比

| | 首选 | 备选 A |
|---|---|---|
| 复用现有壳 | ✅ 高 | ❌ 重写 |
| 后端内置 | standalone + Node sidecar | Electron 自带 Node（最省事） |
| 体积 | ~140–250MB | ~250–400MB |
| 内存 | 中 | 高 |
| 上手难度（用户） | 中 | 中 |
| SDK 改动 | 零 | 零 |

---

## 6. 分阶段落地计划

1. **M1 后端内置打通（唯一核心里程碑，最高优先，先行验证）**：
   - `next.config.ts` 加 `output: 'standalone'`；`next build` 后收集 `.next/standalone` + `.next/static` + `public` 作为内置资源（保留 `serverExternalPackages` 的 pi-* node_modules；undici CVE 修复需在启动前执行 `fix-pi-agent-undici`）。
   - Node 官方二进制按平台/arch 以 Tauri sidecar（`externalBin`）内置。
   - 改 `probe.rs::spawn_local()` 优先拉起内置 `node .next/standalone/server.js -H 127.0.0.1 -p <随机端口>`（含 undici 修复前置 + 内存上限），找不到再回退旧逻辑（PATH 找 `pi-web`）。
   - 端口沿用「随机端口 + 前端轮询 `/api/home` 健康探测」；Windows 用 `CREATE_NO_WINDOW` 抑制黑框。
   - **验收：安装包 → 双击 → WebView 加载内置后端，无需 npm install / 无需命令行，全链路可用。**
2. **M3 打包分发加固**：macOS Developer ID 签名 + 公证 + entitlements（`allow-jit`）；Windows 代码签名证书；三平台 CI 补 sidecar 打包。
3. **M4 体验与收口**：内存/端口策略、后端进程生命周期管理（启动/健康探测/退出回收）、错误与日志收口、文档与发布。

---

## 7. 风险与开放问题（Anything UNCLEAR）

- **standalone 打包与 pi-* 外部包**：`serverExternalPackages` 已声明 pi-*，standalone 会以 node_modules 原样保留；需实测 `undici` symlink 修复在只读/打包目录下是否可写（standalone 目录在应用内可能只读，`fix-pi-agent-undici` 会 `rm`+`symlink`，需改为「启动时在可写位置预打补丁」或提前在构建期固化）。
- **Node 二进制授权/体积**：内置官方 Node 需遵守其 LICENSE；三端 × 2 arch = 6 份二进制，CI 产物体积与构建时长需评估。
- **后端进程生命周期管理差异**：Electron「进程内后端」与 Tauri「Node sidecar」在生命周期管理上不同——进程内后端随主进程崩溃域耦合、更省事但更难独立重启；Tauri sidecar 可独立启动/健康探测/退出回收，但需自管一套 sidecar 生命周期（含三平台差异，如 Windows 黑框、退出回收）。需在选定方案后明确「谁负责拉起/监控/回收后端进程」。
- **内存**：现有 `--max-old-space-size=3072` 是针对 dev/start 的堆上限；内置模式下后端常驻内存，需给出最低内存门槛与「低配降档」提示。
- **认证**：内置后端仍走 `PI_WEB_PASSWORD` Basic Auth（本地默认可空）；WebView 经 `127.0.0.1` 访问，安全模型与现有「本机信任假设」一致。
- **待向 PM/团队确认**：后端内置后首次启动是否需要联网；是否需要支持用户已有本机后端 / 远程 server 的复用（复用现有「服务器列表」机制）。

---

## 附录：关键事实与版本来源（2026-08-19 核查）

- Electron：v43 stable（2026-07-02，Chromium 150 / Node 24.16），v44 alpha（releases.electronjs.org）。
- Tauri v2：2.11.x 线（本项目 `@tauri-apps/cli ^2.11.4`）；sidecar/`externalBin` 为官方 v2 机制（v2.tauri.app/develop/sidecar）。
- Node SEA：v25.5.0 起 `--build-sea` 进核心，ESM 支持（PR #61813，2026-02）；native 模块不可入 blob；pkg 已归档（2024-01）。
- Next.js `output: 'standalone'`：产出 `.next/standalone/server.js` + 精简 node_modules（典型 50–150MB）；`.next/static` 与 `public` 需手动复制。
- macOS：需 Developer ID 签名 + notarytool 公证 + stapler；Hardened Runtime；V8 需 `allow-jit` entitlement。
