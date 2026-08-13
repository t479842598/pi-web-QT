//! 本地 Pi Web 服务探测与 CLI 拉起。

use std::path::PathBuf;
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
    let lower = base.to_ascii_lowercase();
    lower.contains("127.0.0.1") || lower.contains("localhost") || lower.contains("::1")
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
        cli_found: find_cli().is_some(),
        candidates: candidates(cfg),
        alive_url: live,
    }
}

/// 查找 pi-web 可执行文件：PATH + 常见安装目录（移动端无 CLI）。
#[cfg(not(mobile))]
pub fn find_cli() -> Option<PathBuf> {
    // 1. PATH
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let cand = dir.join("pi-web");
            if is_executable(&cand) {
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
    }
    if let Ok(prefix) = Command::new("npm").arg("prefix").arg("-g").output() {
        if prefix.status.success() {
            let p = String::from_utf8_lossy(&prefix.stdout).trim().to_string();
            if !p.is_empty() {
                dirs.push(PathBuf::from(p).join("bin"));
            }
        }
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    for d in dirs {
        let cand = d.join("pi-web");
        if is_executable(&cand) {
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
fn is_executable(p: &PathBuf) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.is_file()
        && p.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(p: &PathBuf) -> bool {
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
    // 已存在同名进程则直接返回 true，由前端轮询确认
    let spawned = Command::new(&cli)
        .arg("--no-open")
        // 重定向子进程输出，避免继承管道阻塞
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| true)
        .unwrap_or(false);
    spawned || alive(DEFAULT_LOCAL_URL)
}
