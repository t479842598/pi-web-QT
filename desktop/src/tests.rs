//! 核心逻辑单元测试（不依赖 GUI/网络）。

use crate::config::{Config, Server, DEFAULT_LOCAL_URL};
use crate::probe;
use crate::window;

fn server(base: &str, password: Option<&str>, is_local: bool) -> Server {
    let mut s = Server {
        id: "t1".into(),
        name: "测试".into(),
        base_url: base.into(),
        username: "pi".into(),
        password_inline: None,
        has_password: false,
        last_used_at: None,
        is_local,
    };
    if let Some(pw) = password {
        // 直接写 inline 降级值，绕开 keyring（测试环境不弹钥匙串授权框）
        s.has_password = true;
        s.password_inline = Some(pw.to_string());
    }
    s
}

#[test]
fn build_url_no_password() {
    let s = server("http://127.0.0.1:30141", None, true);
    let u = window::build_url(&s);
    assert!(u.starts_with("http://127.0.0.1:30141/"), "got {u}");
    assert!(u.contains("piweb_connected=1"), "桌面环境标识缺失: {u}");
}

#[test]
fn build_url_keeps_clean_no_userinfo() {
    // 密码**不**进 URL（fetch 规范禁止子资源 URL 携带 userinfo），
    // 由 on_web_resource_request 注入 Authorization 头。
    let s = server("http://127.0.0.1:30141", Some("secret123"), false);
    let u = window::build_url(&s);
    assert!(
        u.starts_with("http://127.0.0.1:30141/"),
        "userinfo 泄漏进 URL: {u}"
    );
    assert!(!u.contains("secret123"), "密码泄漏进 URL: {u}");
    assert!(!u.contains("@"), "URL 不应包含 userinfo 分隔符: {u}");
}

#[test]
fn build_url_https_keeps_scheme() {
    let s = server("https://pi.example.com", Some("pw"), false);
    let u = window::build_url(&s);
    assert!(u.starts_with("https://pi.example.com/"), "got {u}");
    assert!(!u.contains(":pw@"), "密码泄漏进 URL: {u}");
}

#[test]
fn basic_auth_header_injects_credentials() {
    // 含 @ 等特殊字符的密码经 base64 后写入 Authorization 头，不受 URL 编码限制
    let s = server("http://127.0.0.1:30141", Some("p@ss:w0rd"), false);
    let h = window::basic_auth_header(&s).expect("有密码应返回 header");
    let v = h.to_str().unwrap();
    assert!(v.starts_with("Basic "), "got {v}");
    // base64("pi:p@ss:w0rd") 可解码回原文
    let b64 = v.trim_start_matches("Basic ");
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .expect("base64 解码");
    assert_eq!(String::from_utf8(decoded).unwrap(), "pi:p@ss:w0rd");
}

#[test]
fn basic_auth_header_none_without_password() {
    let s = server("http://127.0.0.1:30141", None, true);
    assert!(window::basic_auth_header(&s).is_none());
}

#[test]
fn config_roundtrip_keeps_servers_and_last() {
    let dir = std::env::temp_dir().join(format!("piweb-test-{}", std::process::id()));
    let path = dir.join("config.json");

    let mut cfg = Config::default();
    let s1 = server("http://127.0.0.1:30141", Some("pw1"), true);
    let s2 = server("https://remote.example.com", None, false);
    cfg.servers.push(s1.clone());
    cfg.servers.push(s2.clone());
    cfg.touch(&s1.id);

    cfg.save_to(&path).expect("save");
    let loaded = Config::load_from(&path);
    assert_eq!(loaded.servers.len(), 2);
    assert_eq!(loaded.last_server_id.as_deref(), Some(s1.id.as_str()));
    assert_eq!(loaded.servers[0].base_url, s1.base_url);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn config_roundtrip_does_not_serialize_inline_password_when_keyring_ok() {
    // 在无 keyring 的 CI/测试环境下 set_password 会降级写入 password_inline，
    // 这里只验证：明文密码绝不进入 has_password=false 的服务器。
    let dir = std::env::temp_dir().join(format!("piweb-test2-{}", std::process::id()));
    let path = dir.join("config.json");
    let mut cfg = Config::default();
    let mut s = server("https://x.example.com", None, false);
    s.password_inline = None;
    s.has_password = false;
    cfg.servers.push(s);
    cfg.save_to(&path).expect("save");
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("password_inline"), "no plaintext password expected");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn candidates_dedup_and_include_defaults() {
    let cfg = Config::default();
    let c = probe::candidates(&cfg);
    assert!(c.contains(&DEFAULT_LOCAL_URL.to_string()));
    let mut uniq = c.clone();
    uniq.dedup();
    assert_eq!(c.len(), uniq.len(), "candidates must be unique");
}

#[test]
fn ensure_local_is_idempotent() {
    let mut cfg = Config::default();
    cfg.ensure_local();
    cfg.ensure_local();
    assert_eq!(cfg.servers.iter().filter(|s| s.is_local).count(), 1);
    assert_eq!(cfg.ensure_local().id, "local");
}

#[test]
fn is_local_host_detection() {
    assert!(probe::is_local_host("http://127.0.0.1:30141"));
    assert!(probe::is_local_host("http://localhost:9999"));
    assert!(probe::is_local_host("http://[::1]:30141"));
    assert!(!probe::is_local_host("https://pi.example.com"));
}

#[test]
fn is_local_host_rejects_substring_spoofing() {
    // 127.0.0.1.evil.com / localhost.evil.com 不应被误判为本机
    assert!(!probe::is_local_host("http://127.0.0.1.evil.com"));
    assert!(!probe::is_local_host("http://localhost.evil.com"));
    assert!(!probe::is_local_host("http://127.0.0.1.evil.com:30141"));
}

/// 真实环境冒烟测试（默认忽略，手动跑：cargo test -- --ignored smoke）
/// 验证 Windows 适配核心：find_cli 命中平台候选名、alive 探测、spawn_local 幂等。
#[test]
#[ignore = "依赖真实环境（本机 pi-web 服务 / npm 全局安装）"]
fn smoke_real_environment() {
    // 1. find_cli 能找到 pi-web（本机 npm 全局装有 pi-web.cmd）
    let cli = probe::find_cli();
    assert!(cli.is_some(), "find_cli 应找到 pi-web（Windows: pi-web.cmd）");
    if let Some(c) = &cli {
        eprintln!("[smoke] CLI: {:?}", c);
    }
    // 2. is_local_host 判定
    assert!(probe::is_local_host("http://127.0.0.1:30141"));
    assert!(!probe::is_local_host("http://127.0.0.1.evil.com"));
    // 3. spawn_local：服务在线则直接 true；不在线则拉起后应尽快就绪（轮询判定）
    let spawned = probe::spawn_local();
    let alive = probe::alive(crate::config::DEFAULT_LOCAL_URL);
    assert!(spawned, "spawn_local 应返回 true");
    assert!(alive, "服务应在线（spawn_local 后）");
    eprintln!("[smoke] spawn_local={spawned} alive={alive}");
}

#[test]
fn find_in_dir_matches_platform_cli_name() {
    // 临时目录里放一个平台对应的假 CLI 文件，验证 find_in_dir 能找到
    let dir = std::env::temp_dir().join(format!("piweb-findcli-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(windows)]
    let fname = "pi-web.cmd";
    #[cfg(not(windows))]
    let fname = "pi-web";
    let fake = dir.join(fname);
    std::fs::write(&fake, "echo hi").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755));
    }
    assert_eq!(
        probe::find_in_dir(&dir).as_deref(),
        Some(fake.as_path()),
        "find_in_dir 应命中平台候选名 {fname}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
