//! 本地反向代理：为带凭据的服务器提供 `127.0.0.1:<port>` 入口。
//!
//! 背景：Tauri 2 的 `on_web_resource_request` 只作用于 tauri:// 自定义协议资源
//! （wry 仅为其注册 WebView2/WKWebView 拦截器），**无法拦截外部 http(s) 请求**；
//! 因此"WebView 直接加载远程 URL + 请求头注入 Basic Auth"的方案从未生效——
//! Windows WebView2 对 401 弹系统凭据对话框（要求重输账号密码），macOS
//! WKWebView 直接白屏。本模块让 WebView 的全部请求（首屏导航、子资源、
//! /api/*、SSE）先打到本地代理，由代理实时读取最新服务器配置、注入
//! Authorization 后转发到上游，两平台行为一致。
//!
//! 实现：hyper(1.x) HTTP/1.1 server + reqwest 流式转发。响应逐 chunk 透传
//! （hyper 对流式 body 每 chunk 即 flush，SSE 实时性有测试保障）。
//!
//! 转发时的头重写（对应服务端 `lib/request-security.ts` 的校验）：
//! - `Host` → 上游 authority（远程按 PI_WEB_HOSTNAME/ALLOWED_HOSTS 白名单校验）
//! - `Origin` → 上游 origin（否则 POST 类 API 被判跨站 403）
//! - 剔除 `Referer`/`Accept-Encoding`（代理不解压，上游返回明文）与
//!   hop-by-hop 头；注入实时 `Authorization`

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::service::service_fn;
use hyper::Response;
use hyper_util::rt::TokioIo;
use tauri::{AppHandle, Manager};

use crate::config::Server;
use crate::AppState;

/// 代理注册表值：server_id -> 本地端口（挂 AppState，进程生命周期内复用）。
pub type ProxyMap = Mutex<HashMap<String, u16>>;

/// Basic Auth 凭据值（base64("user:pass")），转发时注入 Authorization 头。
pub fn basic_auth_value(server: &Server) -> Option<String> {
    use base64::Engine;
    let pw = server.password()?;
    let token = base64::engine::general_purpose::STANDARD
        .encode(format!("{}:{}", server.username, pw).as_bytes());
    Some(format!("Basic {token}"))
}

/// 上游地址信息：从 base_url 解析 (origin, authority)。
/// - origin: `scheme://host[:port]`（重写 Origin 头用）
/// - authority: `host[:port]`（重写 Host 头用；仅非默认端口带 :port）
pub(crate) fn upstream_parts(base_url: &str) -> Option<(String, String)> {
    let u = url::Url::parse(base_url).ok()?;
    let host = u.host_str()?;
    let default_port = match u.scheme() {
        "https" => 443,
        "http" => 80,
        _ => return None,
    };
    let authority = match u.port() {
        Some(p) if p != default_port => format!("{host}:{p}"),
        _ => host.to_string(),
    };
    let origin = format!("{}://{authority}", u.scheme());
    Some((origin, authority))
}

/// 拼接上游完整 URL（base_url + 请求的 path+query）。
/// 兼容 origin-form（`/api/x`）与 absolute-form（`http://…/api/x`，取其 path 部分）。
pub(crate) fn upstream_url(base_url: &str, path_and_query: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let pq = path_and_query.trim();
    let pq = if pq.starts_with('/') {
        pq.to_string()
    } else if let Some(idx) = pq.find("://") {
        // absolute-form：跳过 scheme://host[:port]，取 path+query；无 path 时保留 query
        let rest = &pq[idx + 3..];
        match rest.split_once('/') {
            Some((_, tail)) => format!("/{tail}"),
            None => rest
                .split_once('?')
                .map(|(_, q)| format!("/?{q}"))
                .unwrap_or_else(|| "/".to_string()),
        }
    } else {
        format!("/{pq}")
    };
    // 去掉可能残留的 userinfo 前缀（防 URL 注入）
    format!("{base}{pq}")
}

/// 请求侧不转发的头（小写）。
/// content-length：请求体用流式（chunked）重传，旧长度与重传实长冲突会使 POST 破包。
const REQ_DROP: [&str; 7] = [
    "host",
    "origin",
    "referer",
    "authorization",
    "accept-encoding",
    "connection",
    "content-length",
];

/// 计算转发到上游的请求头。
/// incoming: WebView 原始请求头（名字原样传入，大小写不敏感比较）
pub(crate) fn forward_headers(
    incoming: &[(String, String)],
    server: &Server,
    upstream_origin: &str,
    upstream_authority: &str,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for (name, value) in incoming {
        let n = name.to_ascii_lowercase();
        if REQ_DROP.contains(&n.as_str()) {
            continue;
        }
        out.push((n, value.clone()));
    }
    out.push(("host".into(), upstream_authority.into()));
    out.push(("origin".into(), upstream_origin.into()));
    if let Some(auth) = basic_auth_value(server) {
        out.push(("authorization".into(), auth));
    }
    out
}

/// 是否为导航请求（用于 401 时返回友好 HTML 而非透传白屏）。
fn is_navigation(headers: &[(String, String)]) -> bool {
    let get = |k: &str| -> Option<String> {
        headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(k))
            .map(|(_, v)| v.to_ascii_lowercase())
    };
    if let Some(mode) = get("sec-fetch-mode") {
        return mode.contains("navigate");
    }
    get("accept")
        .map(|a| a.contains("text/html"))
        .unwrap_or(false)
}

/// 响应侧不透传的头（小写；分帧相关头由 hyper 重新生成）。
const RESP_DROP: [&str; 5] = [
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    // WebView2 对 401 + WWW-Authenticate 会弹系统凭据对话框（本次修复的源头场景）；
    // 凭据由代理统一注入，不需要向 WebView 发起挑战
    "www-authenticate",
];

type ServerLoader = Arc<dyn Fn() -> Option<Server> + Send + Sync>;

/// 共享 HTTP 客户端（连接池复用；SSE 长连接不设读超时）。
fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::ClientBuilder::new()
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("reqwest client")
    })
}

/// 校验进入代理的请求是否来自本代理入口（Host 必须是本机环回地址）。
/// 阻止本机其他端口的页面（DNS 重绑定 / same-site 端口扫描）借代理凭据访问上游。
fn host_allowed(host: &str) -> bool {
    let h = host.rsplit_once(':').map_or(host, |(h, _)| h);
    h == "127.0.0.1" || h == "localhost" || h == "[::1]"
}

/// 处理单个代理请求：读配置 → 转发 → 流式回写。
async fn handle_request(
    request: hyper::Request<Incoming>,
    load_server: &ServerLoader,
) -> hyper::Response<http_body_util::combinators::BoxBody<bytes::Bytes, std::io::Error>> {
    // 仅接受打向本代理入口（127.0.0.1[:port]）的请求
    let incoming_host = request
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !host_allowed(&incoming_host) {
        return html_response(403, "禁止访问：该地址不对外提供服务。");
    }
    let Some(server) = load_server() else {
        return html_response(503, "该服务器配置已被删除，请回到连接页重新连接。");
    };
    let Some((origin, authority)) = upstream_parts(&server.base_url) else {
        return html_response(502, "服务器地址无效，请在连接页检查后重试。");
    };

    let (parts, body) = request.into_parts();
    let incoming: Vec<(String, String)> = parts
        .headers
        .iter()
        .map(|(n, v)| (n.to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect();
    let method = parts.method.as_str().to_string();
    let url = upstream_url(&server.base_url, &parts.uri.to_string());

    let mut fwd = client().request(method.parse().unwrap_or(reqwest::Method::GET), &url);
    {
        use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
        let mut headers = HeaderMap::new();
        for (n, v) in forward_headers(&incoming, &server, &origin, &authority) {
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(n.as_bytes()),
                HeaderValue::from_str(&v),
            ) {
                headers.insert(name, value);
            }
        }
        fwd = fwd.headers(headers);
    }
    // 请求体流式转发（POST 消息/上传）
    let body_stream = body.into_data_stream().map(|chunk| {
        chunk.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    });
    let resp = match fwd.body(reqwest::Body::wrap_stream(body_stream)).send().await {
        Ok(r) => r,
        Err(e) => {
            return html_response(502, &format!("无法连接服务器：<br><code>{e}</code>"));
        }
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED && is_navigation(&incoming) {
        return html_response(
            401,
            "认证失败：用户名或密码不正确。<br>请回到连接页更新该服务器的用户名/密码后重试。",
        );
    }

    let mut builder = Response::builder().status(status);
    for (name, value) in resp.headers().iter() {
        if RESP_DROP.contains(&name.as_str()) {
            continue;
        }
        builder = builder.header(name, value);
    }
    // 响应体逐 chunk 流式透传（SSE 实时性）
    let stream = resp
        .bytes_stream()
        .map(|chunk| chunk.map(Frame::data).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, e)
        }));
    builder
        .body(BodyExt::boxed(StreamBody::new(stream)))
        .unwrap_or_else(|_| html_response(502, "代理响应构造失败"))
}

/// HTML 提示页响应（导航类错误场景，避免白屏难懂）。
fn html_response(
    status: u16,
    msg: &str,
) -> hyper::Response<http_body_util::combinators::BoxBody<bytes::Bytes, std::io::Error>> {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:system-ui;padding:40px;color:#333\">\
         <h2 style=\"margin-bottom:8px\">Pi Web 桌面端</h2><p>{msg}</p></body>"
    );
    Response::builder()
        .status(status)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .body(http_body_util::Full::new(bytes::Bytes::from(body)).map_err(|never| match never {}).boxed())
        .unwrap()
}

/// 启动一个代理实例，返回本地端口。
/// `load_server` 在**每次请求**时调用以读取最新配置（URL/用户名/密码实时生效）。
#[cfg(test)]
pub(crate) fn spawn_proxy<F>(load_server: F) -> Result<u16, String>
where
    F: Fn() -> Option<Server> + Send + Sync + 'static,
{
    spawn_proxy_on(None, load_server)
}

/// 启动一个代理实例，返回实际绑定的本地端口。
/// `preferred`：优先绑定该固定端口（保证 WebView origin 稳定，localStorage
/// 偏好不因端口变化丢失）；端口被占用时自动回退随机端口。
/// `load_server` 在**每次请求**时调用以读取最新配置。
pub(crate) fn spawn_proxy_on<F>(preferred: Option<u16>, load_server: F) -> Result<u16, String>
where
    F: Fn() -> Option<Server> + Send + Sync + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    let load: ServerLoader = Arc::new(load_server);
    tauri::async_runtime::spawn(async move {
        // 先尝试固定端口；被占则随机（端口冲突只影响本次 origin，不阻断连接）
        let mut listener = None;
        if let Some(p) = preferred {
            if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
                listener = Some(l);
            }
        }
        let listener = match listener {
            Some(l) => l,
            None => match tokio::net::TcpListener::bind("127.0.0.1:0").await {
                Ok(l) => l,
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                    return;
                }
            },
        };
        let port = listener
            .local_addr()
            .map(|a| a.port())
            .map_err(|e| e.to_string());
        if let Err(e) = &port {
            let _ = tx.send(Err(e.clone()));
            return;
        }
        let _ = tx.send(Ok(port.unwrap()));
        // accept 循环：每连接独立 task（keep-alive 由 hyper 处理；SSE 长连接
        // 占住单个连接的 task，不影响其他连接）
        loop {
            // 瞬时 accept 错误不退出：代理静默死亡后 proxies 仍记着该端口，
            // 后续所有请求 connection refused 且无法自愈
            let (stream, _) = match listener.accept().await {
                Ok(v) => v,
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionAborted => continue,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    continue;
                }
            };
            let load = load.clone();
            tauri::async_runtime::spawn(async move {
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(
                        TokioIo::new(stream),
                        service_fn(move |req| {
                            let load = load.clone();
                            async move { Ok::<_, std::convert::Infallible>(handle_request(req, &load).await) }
                        }),
                    )
                    .await;
            });
        }
    });
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("代理启动超时: {e}"))?
}

/// 确保指定服务器的本地代理在运行（复用已有端口），返回端口。
/// 端口首次分配后写入配置持久化——后续启动/重连复用同一端口，
/// 保证 WebView origin 稳定（主题/收藏模型/折叠状态等 localStorage 不丢）。
pub fn ensure_proxy(app: &AppHandle, server_id: &str) -> Result<u16, String> {
    let state = app.state::<AppState>();
    {
        let proxies = state.proxies.lock().unwrap();
        if let Some(&port) = proxies.get(server_id) {
            return Ok(port);
        }
    }
    let id = server_id.to_string();
    let app_handle = app.clone();
    let load = move || {
        app_handle
            .state::<AppState>()
            .config
            .lock()
            .unwrap()
            .find(&id)
            .cloned()
    };
    // 优先复用持久化的固定端口
    let preferred = {
        let cfg = state.config.lock().unwrap();
        cfg.find(server_id).and_then(|s| s.proxy_port)
    };
    let port = spawn_proxy_on(preferred, load)?;
    // 持久化实际端口（首启分配或回退端口时写回，保证下次复用）
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        let changed = cfg
            .find_mut(server_id)
            .map(|s| {
                if s.proxy_port == Some(port) {
                    false
                } else {
                    s.proxy_port = Some(port);
                    true
                }
            })
            .unwrap_or(false);
        if changed { Some(cfg.clone()) } else { None }
    };
    if let Some(cfg) = snapshot {
        let _ = cfg.save(app);
    }
    state.proxies.lock().unwrap().insert(server_id.to_string(), port);
    Ok(port)
}
