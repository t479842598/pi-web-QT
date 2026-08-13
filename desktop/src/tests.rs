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
fn build_url_injects_basic_auth_userinfo() {
    let s = server("http://127.0.0.1:30141", Some("secret123"), false);
    let u = window::build_url(&s);
    assert!(u.starts_with("http://pi:secret123@127.0.0.1:30141"), "got {u}");
}

#[test]
fn build_url_percent_encodes_password() {
    // 密码含 @ 和 : 必须 percent-encode，否则 URL 解析歧义
    let s = server("http://localhost:30141", Some("p@ss:w0rd"), false);
    let u = window::build_url(&s);
    assert!(u.contains("p%40ss%3Aw0rd"), "got {u}");
    assert!(!u.contains("p@ss"), "password must be encoded, got {u}");
}

#[test]
fn build_url_https_keeps_scheme() {
    let s = server("https://pi.example.com", Some("pw"), false);
    let u = window::build_url(&s);
    assert!(u.starts_with("https://pi:pw@pi.example.com"), "got {u}");
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
