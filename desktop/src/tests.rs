//! 核心逻辑单元测试（不依赖 GUI/网络）。

use crate::config::{Config, Server, DEFAULT_LOCAL_URL};
use crate::probe;
use crate::proxy;
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
        proxy_port: None,
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
    // 由本地反向代理注入 Authorization（见 proxy.rs）。
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
    // 含 @ 等特殊字符的密码经 base64 后写入 Authorization，不受 URL 编码限制
    let s = server("http://127.0.0.1:30141", Some("p@ss:w0rd"), false);
    let v = proxy::basic_auth_value(&s).expect("有密码应返回凭据");
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
    assert!(proxy::basic_auth_value(&s).is_none());
}

/* ---------------- 本地反向代理（proxy.rs） ---------------- */

#[test]
fn proxy_upstream_parts_resolves_host_and_port() {
    // 无端口 → 默认端口不进 authority
    let (origin, authority) = proxy::upstream_parts("https://pi.example.com").unwrap();
    assert_eq!(origin, "https://pi.example.com");
    assert_eq!(authority, "pi.example.com");
    // 显式端口保留
    let (origin, authority) =
        proxy::upstream_parts("http://192.168.1.8:30141").unwrap();
    assert_eq!(origin, "http://192.168.1.8:30141");
    assert_eq!(authority, "192.168.1.8:30141");
    // https 默认端口不重复携带
    let (_, authority) = proxy::upstream_parts("https://a.com:443").unwrap();
    assert_eq!(authority, "a.com");
    assert!(proxy::upstream_parts("ftp://x").is_none());
}

#[test]
fn proxy_upstream_url_joins_path_and_query() {
    let base = "https://pi.example.com/";
    assert_eq!(
        proxy::upstream_url(base, "/api/home"),
        "https://pi.example.com/api/home"
    );
    assert_eq!(
        proxy::upstream_url("https://pi.example.com", "/api/x?a=1&b=2"),
        "https://pi.example.com/api/x?a=1&b=2"
    );
    // absolute-form 请求行：取 path+query，替换 host
    assert_eq!(
        proxy::upstream_url(base, "http://127.0.0.1:9999/api/home?k=v"),
        "https://pi.example.com/api/home?k=v"
    );
}

#[test]
fn proxy_forward_headers_rewrites_and_injects() {
    let s = server("https://pi.example.com", Some("secret"), false);
    let incoming = vec![
        ("Host".into(), "127.0.0.1:39999".into()),
        ("Origin".into(), "http://127.0.0.1:39999".into()),
        ("Referer".into(), "http://127.0.0.1:39999/".into()),
        ("Accept".into(), "text/html".into()),
        ("Accept-Encoding".into(), "gzip, br".into()),
        ("User-Agent".into(), "wry".into()),
        ("Connection".into(), "keep-alive".into()),
    ];
    let fwd = proxy::forward_headers(
        &incoming,
        &s,
        "https://pi.example.com",
        "pi.example.com",
    );
    let get = |k: &str| -> String {
        fwd.iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    // Host/Origin 重写为上游（对应远程 request-security 的 Host 白名单与同源校验）
    assert_eq!(get("host"), "pi.example.com");
    assert_eq!(get("origin"), "https://pi.example.com");
    // 剔除 Referer / Accept-Encoding / Connection，其余保留
    assert_eq!(get("referer"), "");
    assert_eq!(get("accept-encoding"), "");
    assert_eq!(get("connection"), "");
    assert_eq!(get("accept"), "text/html");
    assert_eq!(get("user-agent"), "wry");
    // 注入实时 Authorization
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(get("authorization").trim_start_matches("Basic "))
        .unwrap();
    assert_eq!(String::from_utf8(decoded).unwrap(), "pi:secret");
}

#[test]
fn proxy_forward_headers_no_auth_without_password() {
    let s = server("https://pi.example.com", None, false);
    let fwd = proxy::forward_headers(&[], &s, "https://pi.example.com", "pi.example.com");
    assert!(
        !fwd.iter().any(|(n, _)| n == "authorization"),
        "无密码不应注入 Authorization"
    );
}

/// 端到端（本地回环）：mock 上游 + 本地代理 + 客户端请求。
/// 验证授权注入、头重写、状态码与 body 透传。
#[test]
fn proxy_end_to_end_forwards_with_auth() {
    use std::io::Read as _;
    use std::sync::mpsc;

    // 1. mock 上游：校验收到的 Authorization/Host/Origin，回显 200
    let upstream = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let upstream_port = match upstream.server_addr() {
        tiny_http::ListenAddr::IP(a) => a.port(),
        _ => panic!("unexpected addr"),
    };
    let (tx, rx) = mpsc::channel::<(String, String, String)>();
    std::thread::spawn(move || {
        for req in upstream.incoming_requests() {
            let auth = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("authorization"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();
            let host = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("host"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();
            let origin = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("origin"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();
            let _ = tx.send((auth, host, origin));
            let resp = tiny_http::Response::from_string("ok-from-upstream");
            let _ = req.respond(resp);
        }
    });

    // 2. 起代理：配置指向 mock 上游，带密码（触发注入）
    let srv = server(&format!("http://127.0.0.1:{upstream_port}"), Some("secret"), false);
    let port = proxy::spawn_proxy(move || Some(srv.clone())).expect("spawn proxy");

    // 3. 客户端打代理：验证转发与回显
    let resp = ureq::get(&format!("http://127.0.0.1:{port}/api/home"))
        .set("Origin", &format!("http://127.0.0.1:{port}"))
        .set("Accept", "text/html")
        .call()
        .expect("proxy 请求失败");
    assert_eq!(resp.status(), 200);
    let mut body = String::new();
    resp.into_reader().read_to_string(&mut body).unwrap();
    assert_eq!(body, "ok-from-upstream");

    // 4. 上游收到的头：注入的 Authorization + 重写的 Host/Origin
    let (auth, host, origin) = rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(auth.trim_start_matches("Basic "))
        .unwrap();
    assert_eq!(String::from_utf8(decoded).unwrap(), "pi:secret");
    assert_eq!(host, format!("127.0.0.1:{upstream_port}"));
    assert_eq!(origin, format!("http://127.0.0.1:{upstream_port}"));
}

/// 401 导航请求返回友好 HTML（非导航/API 请求透传 401）。
#[test]
fn proxy_401_navigation_returns_html() {
    use std::io::Read as _;
    let upstream = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let upstream_port = match upstream.server_addr() {
        tiny_http::ListenAddr::IP(a) => a.port(),
        _ => panic!("unexpected addr"),
    };
    std::thread::spawn(move || {
        for req in upstream.incoming_requests() {
            let _ = req.respond(tiny_http::Response::empty(401));
        }
    });
    let srv = server(&format!("http://127.0.0.1:{upstream_port}"), Some("bad"), false);
    let port = proxy::spawn_proxy(move || Some(srv.clone())).unwrap();

    // 导航请求（sec-fetch-mode: navigate）→ 友好 HTML（ureq 对 401 返回 Err(Status)）
    let resp = match ureq::get(&format!("http://127.0.0.1:{port}/"))
        .set("sec-fetch-mode", "navigate")
        .set("Accept", "text/html")
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => panic!("请求失败: {e}"),
    };
    assert_eq!(resp.status(), 401);
    assert!(
        resp.header("content-type")
            .unwrap_or("")
            .starts_with("text/html")
    );
    let mut body = String::new();
    resp.into_reader().read_to_string(&mut body).unwrap();
    assert!(body.contains("认证失败"), "应返回友好提示: {body}");

    // API 请求（无 sec-fetch/accept html）→ 原样透传 401
    let resp = match ureq::get(&format!("http://127.0.0.1:{port}/api/home"))
        .set("Accept", "application/json")
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => panic!("请求失败: {e}"),
    };
    assert_eq!(resp.status(), 401);
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
fn config_roundtrip_omits_password_fields_without_password() {
    // 未设置密码的服务器，序列化产物不应包含任何密码字段
    // （历史名带 keyring，密码已改为明文内联存储后更名）
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

/// 真实远程服务器冒烟（默认忽略，手动跑）：
///   PIWEB_SMOKE_URL=https://host PIWEB_SMOKE_USER=pi PIWEB_SMOKE_PASS=xxx \
///     cargo test proxy_real_remote -- --ignored --nocapture
/// 验证：代理注入凭据 + 重写 Host/Origin 后，真实 pi-web（含 request-security
/// 的 Host 白名单与同源 Origin 校验）接受请求并返回 200。
#[test]
#[ignore = "依赖真实远程服务器（环境变量 PIWEB_SMOKE_URL/USER/PASS）"]
fn proxy_real_remote() {
    use std::io::Read as _;
    let Ok(url) = std::env::var("PIWEB_SMOKE_URL") else {
        panic!("缺 PIWEB_SMOKE_URL");
    };
    let user = std::env::var("PIWEB_SMOKE_USER").unwrap_or_else(|_| "pi".into());
    let pass = std::env::var("PIWEB_SMOKE_PASS").expect("缺 PIWEB_SMOKE_PASS");
    let mut srv = server(&url, Some(&pass), false);
    srv.username = user;
    let port = proxy::spawn_proxy(move || Some(srv.clone())).expect("spawn proxy");
    let resp = match ureq::get(&format!("http://127.0.0.1:{port}/api/home"))
        .set("Accept", "application/json")
        .set("sec-fetch-site", "same-origin")
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _r)) => {
            panic!("远程拒绝请求（HTTP {code}）—— 头重写或凭据注入有问题")
        }
        Err(e) => panic!("请求失败: {e}"),
    };
    assert_eq!(resp.status(), 200);
    let mut body = String::new();
    resp.into_reader().read_to_string(&mut body).unwrap();
    eprintln!("[smoke] 200 OK, body[:120]={}", &body.chars().take(120).collect::<String>());
}

/// SSE 流式透传：上游分块写（块间隔 200ms）→ 客户端首块应在上游写完全部
/// 内容之前到达（证明代理流式透传、不整体缓冲响应）。
/// mock 上游用 hyper（每 frame flush）；若用 tiny_http 做 mock，其自身 BufWriter
/// 会缓冲小块，把上游的缓冲误报到被测代理头上。
#[test]
fn proxy_sse_streaming_not_buffered() {
    use std::io::Read;
    use std::sync::mpsc;

    let (tx_first, rx_first) = mpsc::channel::<std::time::Instant>();
    let (tx_port, rx_port) = mpsc::channel::<u16>();
    let tx_first = std::sync::Arc::new(tx_first);
    tauri::async_runtime::spawn(async move {
        use futures_util::stream;
        use http_body_util::StreamBody;
        use hyper::body::Frame;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tx_port.send(port).unwrap();
        loop {
            let Ok((stream, _)) = listener.accept().await else { break };
            let tx_first = tx_first.clone();
            tauri::async_runtime::spawn(async move {
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(
                        hyper_util::rt::TokioIo::new(stream),
                        hyper::service::service_fn(move |_| {
                            let tx_first = tx_first.clone();
                            async move {
                                // 状态机流：块1（立即）→ sleep 200ms（通知）→ 块2 → 结束
                                let body_stream = stream::unfold((tx_first, 0u8), |(tx, step)| {
                                    async move {
                                        match step {
                                            0 => Some((
                                                Ok::<Frame<bytes::Bytes>, std::io::Error>(
                                                    Frame::data(bytes::Bytes::from_static(
                                                        b"event: agent_event\ndata: {\"n\":1}\n\n",
                                                    )),
                                                ),
                                                (tx, 1),
                                            )),
                                            1 => {
                                                tokio::time::sleep(
                                                    std::time::Duration::from_millis(200),
                                                )
                                                .await;
                                                let _ = tx.send(std::time::Instant::now());
                                                Some((
                                                    Ok(Frame::data(bytes::Bytes::from_static(
                                                        b"event: agent_event\ndata: {\"n\":2}\n\n",
                                                    ))),
                                                    (tx, 2),
                                                ))
                                            }
                                            _ => None,
                                        }
                                    }
                                });
                                Ok::<_, std::convert::Infallible>(hyper::Response::new(
                                    http_body_util::BodyExt::boxed(StreamBody::new(body_stream)),
                                ))
                            }
                        }),
                    )
                    .await;
            });
        }
    });
    let upstream_port = rx_port
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("mock 上游未启动");

    let srv = server(&format!("http://127.0.0.1:{upstream_port}"), Some("pw"), false);
    let port = proxy::spawn_proxy(move || Some(srv.clone())).unwrap();
    let t_start = std::time::Instant::now();
    let resp = ureq::get(&format!("http://127.0.0.1:{port}/api/agent/x/events"))
        .set("Accept", "text/event-stream")
        .call()
        .expect("SSE 请求失败");
    assert_eq!(resp.status(), 200);
    let mut reader = resp.into_reader();
    let mut all = String::new();
    let mut first_at: Option<std::time::Duration> = None;
    let deadline = t_start + std::time::Duration::from_secs(3);
    loop {
        if std::time::Instant::now() > deadline {
            panic!("3s 内未读全 SSE 流: {all}");
        }
        let mut chunk = vec![0u8; 256];
        let n = reader.read(&mut chunk).expect("读 SSE 失败");
        if n == 0 {
            break;
        }
        if first_at.is_none() {
            first_at = Some(t_start.elapsed());
        }
        all.push_str(&String::from_utf8_lossy(&chunk[..n]));
        if all.contains("\"n\":1") && all.contains("\"n\":2") {
            break;
        }
    }
    let first_at = first_at.expect("未读到任何数据");
    let upstream_first_written = rx_first
        .recv_timeout(std::time::Duration::from_secs(3))
        .expect("上游未写入块1");
    let upstream_done = upstream_first_written + std::time::Duration::from_millis(200);
    assert!(
        all.contains("\"n\":1") && all.contains("\"n\":2"),
        "两块都应到达: {all}"
    );
    // 首块到达须早于上游写完块2 的时刻（若代理整体缓冲，首块只能在上游 EOF 后到达）
    assert!(
        first_at < upstream_done.saturating_duration_since(t_start),
        "首块应在上游写完前到达（流式透传），first={first_at:?} upstream_done={:?}",
        upstream_done.saturating_duration_since(t_start)
    );
}

/// 固定端口优先绑定：空闲端口应被代理采用（保证 WebView origin 稳定）。
#[test]
fn proxy_fixed_port_used_when_available() {
    // 临时占一个端口号拿到可用端口，释放后让代理绑定该固定端口
    let tmp = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = tmp.local_addr().unwrap().port();
    drop(tmp);
    let srv = server("http://127.0.0.1:1", Some("pw"), false);
    let got = proxy::spawn_proxy_on(Some(port), move || Some(srv.clone())).unwrap();
    assert_eq!(got, port, "空闲固定端口应被优先采用");
}

/// 固定端口被占用时回退随机端口（连接不阻断）。
#[test]
fn proxy_fixed_port_falls_back_when_taken() {
    let holder = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = holder.local_addr().unwrap().port();
    let srv = server("http://127.0.0.1:1", Some("pw"), false);
    let got = proxy::spawn_proxy_on(Some(port), move || Some(srv.clone())).unwrap();
    assert_ne!(got, port, "被占用的端口应回退随机");
}
