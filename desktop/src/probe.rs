//! 本地 Pi Web 服务探测与 CLI 拉起。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::config::{Config, DEFAULT_LOCAL_URL};

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug)]
pub struct ProbeResult {
    pub local_alive: bool,
    pub cli_found: bool,
    pub candidates: Vec<String>,
    /// 实际探测到的本机服务地址（供「获取本机链接」直接填入）
    pub alive_url: Option<String>,
}

/// 移动端无本地服务概念。
#[cfg(mobile)]
pub fn spawn_local() -> bool {
    false
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

/// 逐个探测候选，返回第一个存活的地址。
pub fn probe_alive(cfg: &Config) -> Option<String> {
    for c in candidates(cfg) {
        if alive(&c) {
            return Some(c);
        }
    }
    None
}

pub fn probe(cfg: &Config) -> ProbeResult {
    let live = probe_alive(cfg);
    ProbeResult {
        local_alive: live.is_some(),
        // 服务已在线时无需再查 CLI（探测本身证明本机有服务在跑），
        // 避免每次轮询都 spawn 一次 npm 查 prefix。
        cli_found: live.is_some() || find_cli().is_some(),
        candidates: candidates(cfg),
        alive_url: live,
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

/// 拉起本机 pi-web CLI（--no-open 不弹浏览器）。
/// 仅负责启动进程并立即返回（不等待就绪，避免阻塞主线程/命令线程）；
/// 就绪探测由前端轮询 probe_local 完成。
#[cfg(not(mobile))]
pub fn spawn_local() -> bool {
    if alive(DEFAULT_LOCAL_URL) {
        return true;
    }
    let Some(cli) = find_cli() else {
        return false;
    };
    eprintln!("[desktop] 拉起 pi-web: {:?}", cli);
    let mut cmd = Command::new(&cli);
    cmd.arg("--no-open")
        // 重定向子进程输出，避免继承管道阻塞
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Windows：GUI 应用无控制台，直接 spawn .cmd shim 会闪出 cmd 黑框；
    // CREATE_NO_WINDOW 抑制新控制台窗口。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let spawned = cmd.spawn().map(|_| true).unwrap_or(false);
    spawned || alive(DEFAULT_LOCAL_URL)
}
