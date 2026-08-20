//! 本地 Pi Web 服务探测与 CLI 拉起。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
#[cfg(not(mobile))]
use tauri::Manager;

use crate::config::{Config, DEFAULT_LOCAL_URL};

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// V8 堆上限（与 bin/with-memory-limit.js 保持一致）。独立打包时无法依赖
/// 该脚本，直接在 Rust 侧注入 NODE_OPTIONS 兜底。
const MEMORY_LIMIT_MB: u32 = 3072;
const SEMI_SPACE_MB: u32 = 128;

#[derive(Serialize, Clone, Debug)]
pub struct ProbeResult {
    pub local_alive: bool,
    pub cli_found: bool,
    pub candidates: Vec<String>,
    /// 实际探测到的本机服务地址（供「获取本机链接」直接填入）
    pub alive_url: Option<String>,
    /// 本机服务在线但未启用密码认证（无凭据访问 /api/home 返回 200 而非 401），
    /// 连接页据此给出警告。
    pub unauthenticated_local: bool,
}

/// 移动端无本地服务概念。
#[cfg(mobile)]
pub fn spawn_local(
    _app: &AppHandle,
    _password: Option<&str>,
    _trusted_domain: Option<&str>,
) -> Option<std::process::Child> {
    None
}

/// 探测候选地址：默认 30141 + localhost + 上次使用的本地服务器。
pub fn candidates(cfg: &Config) -> Vec<String> {
    let mut list = vec![
        DEFAULT_LOCAL_URL.to_string(),
        "http://localhost:30141".to_string(),
    ];
    if let Some(id) = &cfg.last_server_id {
        if let Some(s) = cfg.find(id) {
            if !s.is_local && is_local_host(&s.base_url) {
                list.push(s.base_url.clone());
            }
        }
    }
    list.dedup();
    list
}

pub fn is_local_host(base: &str) -> bool {
    // 解析出 host 后精确比对，避免子串误判（如 127.0.0.1.evil.com / localhost.evil.com）
    let Some(host) = url::Url::parse(base)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
    else {
        return false;
    };
    // 注意：url crate 对 IPv6 的 host_str() 返回带括号形式 "[::1]"
    if host == "localhost" || host == "::1" || host == "[::1]" {
        return true;
    }
    // 纯 IP 才按网段判断；域名（含 evil.com 前缀伪造）解析 IpAddr 失败 → 非本机
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v4)) => v4.octets()[0] == 127, // 127.0.0.0/8 环回网段
        Ok(std::net::IpAddr::V6(_)) => false,
        Err(_) => false,
    }
}

/// GET {base}/api/home 健康探测。
/// 任何 HTTP 响应（含 401/403 需认证）都视为服务在线；仅连接失败视为不在线。
pub fn alive(base: &str) -> bool {
    let url = format!("{}/api/home", base.trim_end_matches('/'));
    match ureq::get(&url).timeout(PROBE_TIMEOUT).call() {
        Ok(_) => true,
        // 401/403 等：服务在跑，只是需要 Basic Auth
        Err(ureq::Error::Status(_code, _)) => true,
        Err(_) => false,
    }
}

/// 探测本机服务是否「在线但未启用认证」：无凭据 GET /api/home 若返回 200
/// 说明 PI_WEB_PASSWORD 未生效（0.0.0.0 无认证暴露），连接页据此警告。
/// 返回 401/403（已启用认证）或连接失败（不在线）均视为 false。
pub fn local_unauthenticated(base: &str) -> bool {
    let url = format!("{}/api/home", base.trim_end_matches('/'));
    match ureq::get(&url).timeout(PROBE_TIMEOUT).call() {
        Ok(resp) => resp.status() == 200,
        Err(_) => false,
    }
}

/// 逐个探测候选，返回第一个存活的地址。
pub fn probe_alive(cfg: &Config) -> Option<String> {
    for c in candidates(cfg) {
        if alive(&c) {
            return Some(c);
        }
    }
    None
}

pub fn probe(app: &AppHandle, cfg: &Config) -> ProbeResult {
    let live = probe_alive(cfg);
    let unauthenticated_local = live.as_deref().map(local_unauthenticated).unwrap_or(false);
    ProbeResult {
        local_alive: live.is_some(),
        // 「可启动」= 服务已在线（探测本身证明）或本机有 pi-web CLI 或随包内置后端；
        // 纯内置安装（无 npm CLI）时也必须为 true，否则连接页误判「未检测到」。
        cli_found: live.is_some() || find_cli().is_some() || bundled_available(app),
        candidates: candidates(cfg),
        alive_url: live,
        unauthenticated_local,
    }
}

/// 平台相关的 pi-web 可执行文件名候选（按优先级）。
/// - Windows：npm 生成的启动器是 `pi-web.cmd`（无扩展名的 `pi-web` 是 sh 脚本，
///   CreateProcess 无法直接执行，且会闪 cmd 黑框），优先 .cmd；同时兼容独立安装的 .exe。
/// - Unix：直接是可执行脚本 `pi-web`。
#[cfg(all(not(mobile), windows))]
const CLI_NAMES: [&str; 2] = ["pi-web.cmd", "pi-web.exe"];
#[cfg(all(not(mobile), not(windows)))]
const CLI_NAMES: [&str; 1] = ["pi-web"];

/// 在单个目录内按平台候选名查找 pi-web。
#[cfg(not(mobile))]
pub(crate) fn find_in_dir(dir: &Path) -> Option<PathBuf> {
    for name in CLI_NAMES {
        let cand = dir.join(name);
        if is_executable(&cand) {
            return Some(cand);
        }
    }
    None
}

/// 查询 npm 全局 prefix 目录。
/// Windows 上 npm 是 npm.cmd：Rust std 会按 PATHEXT 解析 npm.cmd，并经 cmd.exe /c
/// 执行（CreateProcess 本身只补 .exe 扩展名）；GUI 应用无控制台，用 CREATE_NO_WINDOW
/// 抑制黑框闪动。
#[cfg(not(mobile))]
fn npm_prefix() -> Option<String> {
    use std::io::Read;
    use wait_timeout::ChildExt;

    let mut cmd = Command::new("npm");
    cmd.arg("prefix").arg("-g").stdout(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    // 最多等 3s（首次 npm.cmd → node 冷启动较慢，杀软扫描时更久）；超时杀掉
    let mut stdout = child.stdout.take()?;
    match child.wait_timeout(Duration::from_secs(3)).ok()? {
        Some(status) if status.success() => {}
        _ => {
            let _ = child.kill();
            return None;
        }
    }
    let mut buf = String::new();
    let _ = stdout.read_to_string(&mut buf);
    let p = buf.trim().to_string();
    if p.is_empty() {
        None
    } else {
        Some(p)
    }
}

/// 查找 pi-web 可执行文件：PATH + 常见安装目录（移动端无 CLI）。
#[cfg(not(mobile))]
pub fn find_cli() -> Option<PathBuf> {
    // 1. PATH（Windows 上含 npm 全局 bin 目录 %APPDATA%\npm，文件直接位于该目录）
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            if let Some(cand) = find_in_dir(&dir) {
                return Some(cand);
            }
        }
    }
    // 2. 常见目录（npm 全局 bin / homebrew / ~/.local/bin）
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".fnm/aliases/default/bin"));
        dirs.push(home.join("bin"));
        #[cfg(windows)]
        dirs.push(home.join("AppData").join("Roaming").join("npm"));
    }
    if let Some(prefix) = npm_prefix() {
        let base = PathBuf::from(prefix);
        // Windows：npm 全局脚本直接放在 prefix 目录；Unix：在 prefix/bin 下
        dirs.push(base.clone());
        #[cfg(not(windows))]
        dirs.push(base.join("bin"));
    }
    #[cfg(not(windows))]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    for d in dirs {
        if let Some(cand) = find_in_dir(&d) {
            return Some(cand);
        }
    }
    None
}

/// 移动端没有 pi-web CLI。
#[cfg(mobile)]
pub fn find_cli() -> Option<PathBuf> {
    None
}

#[cfg(unix)]
fn is_executable(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.is_file()
        && p.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(p: &std::path::Path) -> bool {
    p.is_file()
}

/// 在资源目录内定位内置 Node 二进制（随包携带，免本机 npm/CLI）。
#[cfg(not(mobile))]
fn find_node(res: &Path) -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        cands.push(res.join("node").join("node.exe"));
        cands.push(res.join("node.exe"));
    }
    #[cfg(not(windows))]
    {
        cands.push(res.join("node").join("node"));
        cands.push(res.join("node"));
    }
    cands.into_iter().find(|c| is_executable(c))
}

/// 随包内置后端的位置（Node 二进制 + standalone server.js + 工作目录）。
#[cfg(not(mobile))]
struct BundledBackend {
    node: PathBuf,
    server_js: PathBuf,
    backend_dir: PathBuf,
}

/// 从应用资源目录定位内置后端；缺失返回 None。
#[cfg(not(mobile))]
fn locate_bundled(app: &AppHandle) -> Option<BundledBackend> {
    let res = app.path().resource_dir().ok()?;
    let backend_dir = res.join("backend");
    let server_js = backend_dir.join("server.js");
    if !server_js.is_file() {
        return None;
    }
    let node = find_node(&res)?;
    Some(BundledBackend {
        node,
        server_js,
        backend_dir,
    })
}

/// 内置后端资源是否存在（probe 的 cli_found 判定用：纯内置安装无 npm CLI 也判「可启动」）。
#[cfg(not(mobile))]
fn bundled_available(app: &AppHandle) -> bool {
    locate_bundled(app).is_some()
}

#[cfg(mobile)]
fn bundled_available(_app: &AppHandle) -> bool {
    false
}

/// 拉起随包内置的 Node + Next.js standalone 后端（`resources/backend/server.js`）。
/// 成功返回子进程句柄；资源缺失或启动失败返回 None（调用方回退 CLI）。
#[cfg(not(mobile))]
fn spawn_bundled(
    app: &AppHandle,
    password: Option<&str>,
    trusted_domain: Option<&str>,
) -> Option<std::process::Child> {
    let bundled = locate_bundled(app)?;
    let mut cmd = Command::new(&bundled.node);
    cmd.arg(&bundled.server_js)
        // 命令行参数与 env 双保险：新版 standalone 读 PORT/HOSTNAME，旧版读参数。
        // 绑 0.0.0.0：允许局域网/远程直连 30141 + Cloudflare 隧道（cloudflared 连
        // localhost:30141）。代价是 Windows 首启会弹防火墙授权；本机访问密码
        // （PI_WEB_PASSWORD）已保护对外访问。
        .arg("-H")
        .arg("0.0.0.0")
        .arg("-p")
        .arg("30141")
        .current_dir(&bundled.backend_dir)
        .env("HOSTNAME", "0.0.0.0")
        .env("PORT", "30141")
        .env(
            "NODE_OPTIONS",
            format!("--max-old-space-size={MEMORY_LIMIT_MB} --max-semi-space-size={SEMI_SPACE_MB}"),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // 注入本机访问密码（Next.js middleware 据此启用 HTTP Basic Auth）
    if let Some(pw) = password {
        if !pw.is_empty() {
            cmd.env("PI_WEB_PASSWORD", pw);
        }
    }
    // 注入可信域名（Cloudflare 隧道等外部访问时后端放行的 Host）
    if let Some(domain) = trusted_domain {
        let d = domain.trim();
        if !d.is_empty() {
            cmd.env("PI_WEB_ALLOWED_HOSTS", d);
        }
    }
    // 独立进程组：改密/退出时可整组 kill（连带 next 孙进程），避免残留占用 30141
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    // Windows：GUI 应用无控制台，抑制 cmd 黑框
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[desktop] 拉起内置后端: node {:?}", bundled.server_js);
            Some(child)
        }
        Err(e) => {
            eprintln!("[desktop] 内置后端启动失败: {e}");
            None
        }
    }
}

/// 拉起本机 pi-web CLI（--no-open 不弹浏览器）——内置后端缺失时的回退。
#[cfg(not(mobile))]
pub(crate) fn spawn_cli(
    password: Option<&str>,
    trusted_domain: Option<&str>,
) -> Option<std::process::Child> {
    let cli = find_cli()?;
    eprintln!("[desktop] 拉起 pi-web: {:?}", cli);
    let mut cmd = Command::new(&cli);
    cmd.arg("--no-open")
        // 重定向子进程输出，避免继承管道阻塞
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // 注入本机访问密码（bin/pi-web.js 透传 process.env 给 Next.js）
    if let Some(pw) = password {
        if !pw.is_empty() {
            cmd.env("PI_WEB_PASSWORD", pw);
        }
    }
    // 注入可信域名（Cloudflare 隧道等外部访问时后端放行的 Host）
    if let Some(domain) = trusted_domain {
        let d = domain.trim();
        if !d.is_empty() {
            cmd.env("PI_WEB_ALLOWED_HOSTS", d);
        }
    }
    // 独立进程组：改密/退出时可整组 kill（连带 next 孙进程），避免残留占用 30141
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    // Windows：GUI 应用无控制台，直接 spawn .cmd shim 会闪出 cmd 黑框；
    // CREATE_NO_WINDOW 抑制新控制台窗口。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().ok()
}

/// 杀掉子进程及其整个进程树（改密重启/退出清理用）：
/// - Unix：spawn 时已 process_group(0) 建立独立进程组，这里 kill(-pgid) 整组清除
/// - Windows：taskkill /T /F 杀进程树
/// kill 后 wait 回收，避免僵尸。
#[cfg(not(mobile))]
pub(crate) fn kill_child_tree(child: &mut std::process::Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        // SIGKILL 负 pid = 杀整个进程组（组 id == 子进程 pid）
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("taskkill");
        cmd.args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            // CREATE_NO_WINDOW：GUI 应用无控制台，抑制 taskkill 弹出的 cmd 黑框
            .creation_flags(0x0800_0000);
        let _ = cmd.status();
    }
    let _ = child.wait();
}

/// 杀掉壳拉起的本机后端子进程并清空句柄（改密/退出清理用）。
/// 幂等：句柄为空（外部启动或已清理）时无副作用。
/// 放在独立函数里，供退出路径（quit 命令 / 托盘「退出」/ RunEvent::Exit）复用，
/// 避免清理逻辑散落或遗漏导致 30141 被孤儿 node 进程占用。
#[cfg(not(mobile))]
pub(crate) fn kill_local_child(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let child = state.local_child.lock().unwrap().take();
    if let Some(mut child) = child {
        kill_child_tree(&mut child);
    }
}

/// 忽略「已在线」检查直接拉起（改密重启用：刚 kill 旧进程，端口可能仍在
/// TIME_WAIT，不能因 alive 短路）。
#[cfg(not(mobile))]
pub(crate) fn spawn_local_force(
    app: &AppHandle,
    password: Option<&str>,
    trusted_domain: Option<&str>,
) -> Option<std::process::Child> {
    spawn_bundled(app, password, trusted_domain).or_else(|| spawn_cli(password, trusted_domain))
}

/// 拉起本机 Pi Web 后端：优先随包内置的 Node + standalone；找不到内置资源时
/// 回退本机已装的 pi-web CLI。仅负责启动进程并立即返回（不等待就绪，避免阻塞
/// 主线程/命令线程）；就绪探测由前端轮询 probe_local 完成。
/// 返回 Some(child) = 本次新拉起的子进程；None = 已在跑 / 无可用后端。
/// `password`：本机访问密码，非空时作为 PI_WEB_PASSWORD 注入（先设密码再拉起，
/// 避免 0.0.0.0:30141 无认证暴露）。
#[cfg(not(mobile))]
pub fn spawn_local(
    app: &AppHandle,
    password: Option<&str>,
    trusted_domain: Option<&str>,
) -> Option<std::process::Child> {
    if alive(DEFAULT_LOCAL_URL) {
        return None;
    }
    spawn_local_force(app, password, trusted_domain)
}
