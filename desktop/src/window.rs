//! 窗口管理：连接页 / 服务器主窗口 / 托盘 / 启动路由。
//! 移动端（Android/iOS）为单窗口 navigate 模型，无托盘/菜单/多窗口。

#[cfg(not(mobile))]
use tauri::menu::Menu;
#[cfg(not(mobile))]
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::config::{Config, Server};
use crate::AppState;

pub const CONNECT_LABEL: &str = "connect";

/// 服务器窗口 label。
pub fn server_label(id: &str) -> String {
    format!("server-{id}")
}

/// 拼装服务器 URL：附加 ?piweb_connected=1 标识桌面壳环境（网页端据此显示设置入口）。
/// 凭据**不**放入 URL（fetch 规范禁止子资源 URL 携带 userinfo，WebView 会拦截所有
/// /api/* 请求），改为由 on_web_resource_request 在请求头注入 Authorization。
pub fn build_url(server: &Server) -> String {
    let base = url::Url::parse(&server.base_url)
        .unwrap_or_else(|_| url::Url::parse(crate::config::DEFAULT_LOCAL_URL).unwrap());
    let mut u = base;
    u.query_pairs_mut().append_pair("piweb_connected", "1");
    u.to_string()
}

/// Basic Auth 请求头值（base64("pi:密码")），供 WebView 请求拦截注入。
pub fn basic_auth_header(server: &Server) -> Option<tauri::http::HeaderValue> {
    let pw = server.password()?;
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        format!("{}:{}", server.username, pw).as_bytes(),
    );
    tauri::http::HeaderValue::from_str(&format!("Basic {token}")).ok()
}

/// 服务器菜单项显示名。Windows 原生 Win32 菜单不支持彩色 emoji（渲染为方框），
/// 用纯文本标记替代；macOS/Linux 保留 emoji 图标。
pub fn server_menu_label(s: &Server) -> String {
    // 本地/远程标识由 base_url 派生（用户编辑 URL 后立即正确），不依赖持久化 is_local
    let is_local = crate::probe::is_local_host(&s.base_url);
    #[cfg(windows)]
    {
        // Win32 菜单中 & 是助记符前缀，需转义为 && 才能原样显示
        let name = s.name.replace('&', "&&");
        let tag = if is_local { "[本机] " } else { "[远程] " };
        format!("{tag}{name}")
    }
    #[cfg(not(windows))]
    {
        let icon = if is_local { "🖥 " } else { "🌐 " };
        format!("{icon}{}", s.name)
    }
}

/// 「服务器」子菜单：当前窗口切换服务器 + 连接管理入口。
#[cfg(not(mobile))]
pub fn build_servers_submenu(
    app: &AppHandle,
    cfg: &Config,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};

    let connect = MenuItem::with_id(app, "open-connect", "连接管理…", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let mut server_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for s in &cfg.servers {
        server_items.push(MenuItem::with_id(
            app,
            format!("switch-{}", s.id),
            server_menu_label(s),
            true,
            None::<&str>,
        )?);
    }
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&connect, &sep1];
    for it in &server_items {
        items.push(it);
    }
    Submenu::with_items(app, "服务器", true, &items)
}

/// 窗口级菜单（Windows/Linux 显示在窗口内菜单栏；macOS 不使用，见 install_app_menu）。
#[cfg(not(mobile))]
pub fn build_window_menu(app: &AppHandle, cfg: &Config) -> tauri::Result<Menu<tauri::Wry>> {
    let sub = build_servers_submenu(app, cfg)?;
    Menu::with_items(app, &[&sub])
}

/// macOS 应用菜单：默认菜单 + 「服务器」子菜单（macOS 菜单栏项必须是顶级 submenu）。
#[cfg(all(target_os = "macos", not(mobile)))]
pub fn install_app_menu(app: &AppHandle, cfg: &Config) {
    if let Ok(menu) = Menu::default(app) {
        if let Ok(sub) = build_servers_submenu(app, cfg) {
            let _ = menu.append_items(&[&sub]);
            let _ = app.set_menu(menu);
        }
    }
}

/// 打开（或聚焦）服务器主窗口。
#[cfg(not(mobile))]
pub fn open_server_window(app: &AppHandle, server: &Server) -> tauri::Result<WebviewWindow> {
    let label = server_label(&server.id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(w);
    }
    let url = build_url(server);
    let url = url::Url::parse(&url)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    // 窗口菜单（macOS 用应用菜单栏，不挂窗口菜单）
    #[cfg(target_os = "macos")]
    let menu: Option<Menu<tauri::Wry>> = None;
    #[cfg(not(target_os = "macos"))]
    let menu: Option<Menu<tauri::Wry>> = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        build_window_menu(app, &cfg).ok()
    };
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(&server.name)
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 600.0)
        .center()
        // 保存密码时，对发往该服务器的所有请求（首屏导航 + /api/* fetch + SSE）
        // 注入 Basic Auth 头。URL 保持干净 —— 不带 userinfo，避免 fetch 规范
        // 拦截子资源请求（"URL is not valid or contains user credentials"）。
        // 注意：不在这里快照 header —— 每次请求从 AppState 读最新服务器配置，
        // 用户在连接页改密码/名称后已打开的窗口立即生效，无需重建。
        .on_web_resource_request({
            let app_handle = app.clone();
            let server_id = server.id.clone();
            move |mut request, _response| {
                let state = app_handle.state::<AppState>();
                let cfg = state.config.lock().unwrap();
                if let Some(srv) = cfg.find(&server_id) {
                    if let Some(v) = basic_auth_header(srv) {
                        request.headers_mut().insert("authorization", v);
                    }
                }
            }
        })
        // 网页端设置里的「切换服务器」走 piweb-switch:// 自定义导航：
        //   piweb-switch://manage -> 打开连接页
        //   piweb-switch://<id>   -> 当前窗口导航到该服务器
        .on_navigation({
            let app_handle = app.clone();
            let label_owner = label.clone();
            move |url| {
                let s = url.as_str();
                if let Some(rest) = s.strip_prefix("piweb-switch://") {
                    if rest == "manage" {
                        let _ = open_connect_window(&app_handle);
                    } else if !rest.is_empty() {
                        let state = app_handle.state::<AppState>();
                        let cfg = state.config.lock().unwrap().clone();
                        if let Some(srv) = cfg.find(rest) {
                            let target = build_url(srv);
                            if let Ok(u) = url::Url::parse(&target) {
                                if let Some(w) = app_handle.get_webview_window(&label_owner) {
                                    let _ = w.navigate(u);
                                    let _ = w.set_title(&srv.name);
                                }
                            }
                        }
                    }
                    false // 阻止原始导航
                } else {
                    true
                }
            }
        });
    if let Some(m) = menu {
        builder = builder.menu(m);
    }
    let win = builder.build()?;
    app.state::<AppState>()
        .server_windows
        .lock()
        .unwrap()
        .insert(server.id.clone(), label);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(win)
}

/// 打开连接页窗口（壳内静态页）。
#[cfg(not(mobile))]
pub fn open_connect_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(CONNECT_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(w);
    }
    let win = WebviewWindowBuilder::new(
        app,
        CONNECT_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Pi Web — 连接管理")
    .inner_size(920.0, 660.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true)
    .build()?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(win)
}

/// 二次启动聚焦：优先连接页，其次最近使用的服务器窗口。
#[cfg(not(mobile))]
pub fn focus_existing(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(CONNECT_LABEL).or_else(|| {
        let state = app.state::<AppState>();
        let reg = state.server_windows.lock().unwrap().clone();
        let mut labels: Vec<String> = reg.values().cloned().collect();
        labels.reverse();
        labels
            .into_iter()
            .find_map(|label| app.get_webview_window(&label))
    })
}

/// 托盘菜单构造（桌面）。
#[cfg(not(mobile))]
fn build_menu(app: &AppHandle, cfg: &Config) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem};

    let open = MenuItem::with_id(app, "open-connect", "连接管理…", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let mut server_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for s in &cfg.servers {
        server_items.push(MenuItem::with_id(
            app,
            format!("server-{}", s.id),
            server_menu_label(s),
            true,
            None::<&str>,
        )?);
    }
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&open, &sep1];
    for it in &server_items {
        items.push(it);
    }
    items.push(&sep2);
    items.push(&quit);
    Menu::with_items(app, &items)
}

/// 构建托盘（含服务器列表菜单）。
#[cfg(not(mobile))]
pub fn build_tray(app: &AppHandle, cfg: &Config) -> tauri::Result<tauri::tray::TrayIcon> {
    let menu = build_menu(app, cfg)?;
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Pi Web 桌面端")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "open-connect" => {
                    let _ = open_connect_window(app);
                }
                "quit" => app.exit(0),
                _ => {
                    if let Some(server_id) = id.strip_prefix("server-") {
                        let state = app.state::<AppState>();
                        let cfg = state.config.lock().unwrap().clone();
                        if let Some(srv) = cfg.find(server_id) {
                            let _ = open_server_window(app, srv);
                        }
                    }
                }
            }
        })
        .build(app)?;
    Ok(tray)
}

/// 服务器列表变化后重建托盘菜单，并同步更新所有主窗口的「服务器」切换菜单。
#[cfg(not(mobile))]
pub fn rebuild_tray(app: &AppHandle, cfg: &Config) {
    let state = app.state::<AppState>();
    // 1. 托盘菜单
    let tray_guard = state.tray.lock().unwrap();
    if let Some(tray) = tray_guard.as_ref() {
        if let Ok(menu) = build_menu(app, cfg) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    drop(tray_guard);
    // 2. 所有服务器窗口的切换菜单（Windows/Linux）+ 标题同步（改名后立即生效）
    let reg = state.server_windows.lock().unwrap().clone();
    if let Ok(menu) = build_window_menu(app, cfg) {
        for (sid, label) in &reg {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.set_menu(menu.clone());
                if let Some(srv) = cfg.find(sid) {
                    let _ = w.set_title(&srv.name);
                }
            }
        }
    }
    // 3. macOS 应用菜单同步
    #[cfg(target_os = "macos")]
    install_app_menu(app, cfg);
}

/// 启动路由（桌面）：总是进入连接页，由用户自己填写服务器地址。
/// 不自动恢复上次服务器、不自动连本地、不自动使用本地密钥/密码。
/// 仅当用户开启「无服务时自动拉起」（local_auto_start）时，后台尝试拉起本机
/// pi-web CLI —— 拉起不等于连接，连接仍由用户在连接页确认。
#[cfg(not(mobile))]
pub fn route_startup(app: &AppHandle, cfg: &Config) {
    if cfg.local_auto_start {
        // 后台执行，不阻塞启动路由（探测 ~2s + 拉起；结果由连接页轮询 probe_local 呈现）
        tauri::async_runtime::spawn(async move {
            let _ = crate::probe::spawn_local();
        });
    }
    // 连接页：用户填写 URL（+密码）、点「获取本机链接」或「启动本机 pi-web」
    let _ = open_connect_window(app);
}

/* ============================ 移动端（Android/iOS） ============================ */

/// 移动端主窗口 label（单窗口）。
#[cfg(mobile)]
pub const MAIN_LABEL: &str = "main";

/// 打开（或聚焦）移动端主窗口，初始加载连接页。
#[cfg(mobile)]
pub fn open_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }
    let win = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("Pi Web")
        .build()?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(win)
}

/// 移动端：把主窗口导航到指定 URL（服务器或连接页）。
#[cfg(mobile)]
pub fn navigate_main(app: &AppHandle, url: &str) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        if let Ok(u) = url::Url::parse(url) {
            let _ = w.navigate(u);
            let _ = w.set_title("Pi Web");
        }
    }
}

/// 移动端启动路由：始终进入连接页（用户选择服务器后 navigate）。
#[cfg(mobile)]
pub fn route_startup(app: &AppHandle, _cfg: &Config) {
    let _ = open_main_window(app);
}
