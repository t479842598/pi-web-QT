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

/// 是否为服务器主窗口 label（红绿灯居中只对这类窗口生效）。
#[cfg(target_os = "macos")]
pub fn is_server_label(label: &str) -> bool {
    label.starts_with("server-")
}

/// macOS：把原生红绿灯垂直居中进 48px 前端标题栏。
///
/// tauri 2.11 的 `WebviewWindowBuilder::traffic_light_position` 把 inset 存到
/// webview 侧，而红绿灯按钮挂在 window 侧的 titlebar 容器上——该 builder
/// 方法形同虚设。这里按 tao `inset_traffic_lights` 的做法直接用 AppKit 移动
/// titlebar 容器与三个按钮：容器高度压到 (按钮高 + Y)，AppKit 坐标原点在
/// 左下，容器 y = 窗口高 - 容器高，按钮随容器下移；x 再逐个排布。全屏/
/// 还原后 macOS 会重置按钮位置，lib.rs 在 WindowEvent::Resized 重新调用。
#[cfg(target_os = "macos")]
pub fn center_traffic_lights(win: &WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_core_foundation::{CGPoint, CGRect};

    const X: f64 = 12.0;
    const Y: f64 = 18.0; // 48px 标题栏垂直居中：(48 - 按钮 12px) / 2 = 按钮顶边距 18
    let Ok(ns_window) = win.ns_window() else {
        return;
    };
    unsafe {
        let window = ns_window as *const AnyObject;
        // NSWindowButton 枚举值：Close=0 / Miniaturize=1 / Zoom=2
        let close: *const AnyObject = msg_send![window, standardWindowButton: 0_usize];
        let miniaturize: *const AnyObject = msg_send![window, standardWindowButton: 1_usize];
        let zoom: *const AnyObject = msg_send![window, standardWindowButton: 2_usize];
        if close.is_null() || miniaturize.is_null() || zoom.is_null() {
            return;
        }
        let superview: *const AnyObject = msg_send![close, superview];
        let title_bar_container: *const AnyObject = msg_send![superview, superview];
        if title_bar_container.is_null() {
            return;
        }
        let close_rect: CGRect = msg_send![close, frame];
        let button_height = close_rect.size.height;
        let miniaturize_rect: CGRect = msg_send![miniaturize, frame];
        let space_between = miniaturize_rect.origin.x - close_rect.origin.x;
        // 容器顶边贴窗口顶边，高度 = 按钮高 + Y；按钮显式钉在容器底
        // （origin.y = 容器高 - 按钮高 - Y），使按钮顶边距窗口顶恰为 Y，
        // 中心落在 48px 标题栏的垂直中点。容器与按钮 x/y 全部显式设置，
        // 不依赖 AppKit 布局继承，避免被异步布局覆盖后残留偏移。
        let container_height = button_height + Y;
        let mut title_bar_rect: CGRect = msg_send![title_bar_container, frame];
        title_bar_rect.size.height = container_height;
        let window_frame: CGRect = msg_send![window, frame];
        title_bar_rect.origin.y = window_frame.size.height - container_height;
        let _: () = msg_send![title_bar_container, setFrame: title_bar_rect];
        let button_y = container_height - button_height - Y;
        for (i, button) in [close, miniaturize, zoom].into_iter().enumerate() {
            let origin = CGPoint::new(X + (i as f64 * space_between), button_y);
            let _: () = msg_send![button, setFrameOrigin: origin];
        }
    }
}

/// 拼装服务器直连 URL：附加 ?piweb_connected=1 标识桌面壳环境（网页端据此显示设置入口）。
/// 凭据不放入 URL（fetch 规范禁止子资源 URL 携带 userinfo）。
/// 带凭据的服务器请用 [`window_url`]（经本地代理注入 Basic Auth）。
pub fn build_url(server: &Server) -> String {
    let base = url::Url::parse(&server.base_url)
        .unwrap_or_else(|_| url::Url::parse(crate::config::DEFAULT_LOCAL_URL).unwrap());
    let mut u = base;
    u.query_pairs_mut().append_pair("piweb_connected", "1");
    u.to_string()
}

/// 窗口实际加载的 URL：
/// - 已保存密码 → 启动/复用该服务器的本地反向代理，返回 `http://127.0.0.1:<port>/…`。
///   Tauri 的 on_web_resource_request 只拦截 tauri:// 资源、无法给外部 URL 注头
///   （WebView2 对 401 弹系统凭据框、WKWebView 直接白屏），凭据注入必须由代理完成；
///   代理每次转发时读取最新配置，改用户名/密码后已打开窗口立即生效。
/// - 无密码 → 直连（无需注入）。
pub fn window_url(app: &AppHandle, server: &Server) -> String {
    if server.has_password {
        match crate::proxy::ensure_proxy(app, &server.id) {
            Ok(port) => {
                return format!("http://127.0.0.1:{port}/?piweb_connected=1");
            }
            Err(e) => {
                eprintln!("[desktop] 本地代理启动失败，回退直连: {e}");
            }
        }
    }
    build_url(server)
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
/// 仅 macOS 的系统菜单栏（install_app_menu）使用；Windows/Linux 无边框后不再
/// 挂窗口菜单栏，因此在非 macOS 编译下该函数无调用者，标注以消除 dead_code 误报。
#[cfg(not(mobile))]
#[allow(dead_code)]
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

/// 创建（或复用）一个无边框主窗口：先加载壳内本地页 `start_page`，build
/// 返回后再导航到 `target_url`。`registry_id` 非空时写入 server_windows 注册表。
///
/// 为什么必须「先本地页、后 navigate」两步：Windows WebView2 上
/// `WebviewUrl::External` 的初始导航可能因 controller 未就绪而丢失（窗口停在
/// about:blank → 白屏），先以本地页建窗、build 返回后显式 navigate 是 08-14
/// 已验证的修复路径。启动等待页（loading.html）与服务器窗口共用这条构造路径，
/// 避免两条路径行为漂移。
#[cfg(not(mobile))]
fn create_shell_window(
    app: &AppHandle,
    label: &str,
    title: &str,
    start_page: &str,
    target_url: Option<&str>,
    registry_id: Option<&str>,
) -> tauri::Result<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(start_page.into()))
        .title(title)
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 600.0)
        .center();
    if let Some(theme) = crate::theme::stored_theme(app) {
        builder = crate::theme::apply_theme_to_builder(builder, theme);
    }
    // 无边框：macOS 保留原生 traffic lights（title_bar_style Overlay + hidden_title，
    // 前端标题栏内缩让出红绿灯）；Windows/Linux 完全无边框，窗口控制由前端绘制。
    // 注意：tauri 2.11 的 WebviewWindowBuilder::traffic_light_position 把 inset
    // 存到 webview 侧而红绿灯归 window 侧管理（形同虚设），因此位置在 build
    // 之后由 center_traffic_lights 直接调整。
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }
    // Windows：多虚拟显卡/远程控制环境（Oray/GameViewer/MuMu 等）下
    // WebView2 GPU 渲染会导致 browser 进程崩溃或主线程挂起（AppHangB1）→
    // 白屏。禁用 GPU 强制软件渲染，实测可稳定加载远程页面。
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args("--disable-gpu");
    }
    // 远程凭据注入由本地反向代理完成（见 window_url）：Tauri 的
    // on_web_resource_request 只作用于 tauri:// 资源，无法拦截外部 http(s)，
    // 早期"请求头注入"方案在两个平台都未生效过（WebView2 弹凭据框 /
    // WKWebView 白屏）。URL 保持干净 —— 不带 userinfo。
    // 网页端右上角「切换服务器」走 piweb-switch:// 自定义导航：
    //   piweb-switch://manage -> 打开连接页
    //   piweb-switch://<id>   -> 当前窗口导航到该服务器
    builder = builder.on_navigation({
        let app_handle = app.clone();
        let label_owner = label.to_string();
        move |url| {
            let s = url.as_str();
            if let Some(rest) = s.strip_prefix("piweb-switch://") {
                if rest == "manage" {
                    let _ = open_connect_window(&app_handle);
                } else if !rest.is_empty() {
                    let state = app_handle.state::<AppState>();
                    let cfg = state.config.lock().unwrap().clone();
                    if let Some(srv) = cfg.find(rest) {
                        let target = window_url(&app_handle, &srv);
                        if let Ok(u) = url::Url::parse(&target) {
                            if let Some(w) = app_handle.get_webview_window(&label_owner) {
                                let _ = w.navigate(u);
                                let _ = w.set_title(&srv.name);
                                // 窗口已改指向新服务器：同步注册表（否则
                                // focus_existing/菜单按旧 id 重复建窗、标题错乱）
                                state
                                    .server_windows
                                    .lock()
                                    .unwrap()
                                    .insert(srv.id.clone(), label_owner.clone());
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
    let win = builder.build()?;
    #[cfg(target_os = "macos")]
    {
        center_traffic_lights(&win);
        // AppKit 会在 webview 挂载/导航后异步重排 titlebar，一次性设置会被
        // 覆盖：创建后分几次延迟重贴，直到布局稳定。
        let handle = app.clone();
        let label = label.to_string();
        std::thread::spawn(move || {
            for delay_ms in [400u64, 1100, 2500, 4000] {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                let runner = handle.clone();
                let h = handle.clone();
                let l = label.clone();
                runner.run_on_main_thread(move || {
                    if let Some(w) = h.get_webview_window(&l) {
                        center_traffic_lights(&w);
                    }
                });
            }
        });
    }
    if let Some(sid) = registry_id {
        app.state::<AppState>()
            .server_windows
            .lock()
            .unwrap()
            .insert(sid.to_string(), label.to_string());
    }
    let _ = win.show();
    let _ = win.set_focus();
    // 窗口构建完成（WebView2 controller 已就绪）后再导航到目标，避免 Windows
    // 上 External 初始导航丢失导致白屏。
    if let Some(raw) = target_url {
        if let Ok(u) = url::Url::parse(raw) {
            let _ = win.navigate(u);
        }
    }
    Ok(win)
}

/// 打开（或聚焦）服务器主窗口。
#[cfg(not(mobile))]
pub fn open_server_window(app: &AppHandle, server: &Server) -> tauri::Result<WebviewWindow> {
    let label = server_label(&server.id);
    let url = window_url(app, server);
    if let Some(w) = app.get_webview_window(&label) {
        // 已存在：重新导航到最新 URL（用户改过地址/密码后点「连接」，旧窗口
        // 停留在旧内容或 401 页），并同步标题
        if let Ok(u) = url::Url::parse(&url) {
            let _ = w.navigate(u);
        }
        let _ = w.set_title(&server.name);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(w);
    }
    // 无边框（frameless）：服务器主窗口不再有原生标题栏/边框。服务器切换
    // 由网页端右上角「切换服务器」入口（piweb-switch://）承载，因此不再挂
    // 原生「服务器」菜单栏（那行菜单在 Windows 上显示为窗口内菜单栏）。
    // 窗口拖动/最小化/最大化/关闭由前端的无边框标题栏（WindowControls +
    // data-tauri-drag-region）负责。
    let parsed = url::Url::parse(&url)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    create_shell_window(
        app,
        &label,
        &server.name,
        "index.html",
        Some(parsed.as_str()),
        Some(&server.id),
    )
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
    let mut win_builder = WebviewWindowBuilder::new(
        app,
        CONNECT_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Pi Web — 连接管理")
    .inner_size(920.0, 660.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true);
    // 主题联动：连接页窗口同样跟随已保存主题。
    if let Some(theme) = crate::theme::stored_theme(app) {
        win_builder = crate::theme::apply_theme_to_builder(win_builder, theme);
    }
    // Windows：同 open_server_window，禁用 GPU 软件渲染避免 WebView2 挂起白屏
    #[cfg(windows)]
    {
        win_builder = win_builder.additional_browser_args("--disable-gpu");
    }
    let win = win_builder.build()?;
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
                "quit" => {
                    // 进程保持策略：退出时保留本机后端常驻，下次直接复用；
                    // 需要停止时用连接页「关闭本机服务」按钮。
                    app.exit(0);
                }
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
    // 2. 所有服务器窗口标题同步（改名后立即生效）。窗口已无边框且不再挂
    //    原生「服务器」切换菜单（服务器切换由网页端右上角入口承载），因此
    //    这里只同步标题，不再 set_menu。
    let reg = state.server_windows.lock().unwrap().clone();
    for (sid, label) in &reg {
        if let Some(w) = app.get_webview_window(label) {
            if let Some(srv) = cfg.find(sid) {
                let _ = w.set_title(&srv.name);
            }
        }
    }
    // 3. macOS 应用菜单同步
    #[cfg(target_os = "macos")]
    install_app_menu(app, cfg);
}

/* ==================== 启动路由（打开即用 · F-01/F-06/D-01） ==================== */

/// 本机后端就绪等待上限（秒）。内置 Node + Next standalone 冷启动实测在数秒级，
/// 30s 已覆盖慢盘/首启解包；超时后交给等待页的兜底按钮，不再无限转圈。
#[cfg(not(mobile))]
const STARTUP_WAIT_TIMEOUT_SECS: u64 = 30;

/// 启动目标。纯决策、无副作用，便于单测。
#[cfg(not(mobile))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupTarget {
    /// 上次使用的是远程服务器 → 尊重偏好直接进入（F-06）
    Remote(String),
    /// 其余一律走本机自动连接（F-01 打开即用）
    LocalAuto,
}

/// 决定启动去向：只有「上次用的是真正的远程服务器」才直连远程，
/// 本机条目 / 本机地址 / 未知 id / 空配置一律回到本机自动连接（不 panic）。
#[cfg(not(mobile))]
pub fn decide_startup(cfg: &Config) -> StartupTarget {
    if let Some(id) = &cfg.last_server_id {
        if let Some(srv) = cfg.find(id) {
            if !srv.is_local && !crate::probe::is_local_host(&srv.base_url) {
                return StartupTarget::Remote(id.clone());
            }
        }
    }
    StartupTarget::LocalAuto
}

/// 打开本机自动连接的等待窗口。label 与最终本机窗口一致，就绪后原地
/// navigate —— 避免「先弹一个 splash、再换成主窗口」的窗口跳动。
#[cfg(not(mobile))]
pub fn open_startup_window(app: &AppHandle, server: &Server) -> tauri::Result<WebviewWindow> {
    let label = server_label(&server.id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }
    create_shell_window(app, &label, "Pi Web", "loading.html", None, Some(&server.id))
}

/// 把窗口导航到某台服务器的最新 URL；窗口不存在则新建。
/// 就绪后的落点与「点连接」走的是同一条路径，避免两套开窗逻辑。
#[cfg(not(mobile))]
fn navigate_or_open(app: &AppHandle, server: &Server) {
    let label = server_label(&server.id);
    let url = window_url(app, server);
    if let Some(w) = app.get_webview_window(&label) {
        if let Ok(u) = url::Url::parse(&url) {
            let _ = w.navigate(u);
        }
        let _ = w.set_title(&server.name);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    } else if let Err(e) = open_server_window(app, server) {
        eprintln!("[desktop] 打开服务器窗口失败: {e}");
    }
    // 记录最近使用（与菜单/托盘切换路径一致）
    let state = app.state::<AppState>();
    let mut cfg = state.config.lock().unwrap();
    cfg.touch(&server.id);
    let _ = cfg.save(app);
}

/// 通知等待窗口「启动失败」，由 loading.html 显示原因 + 重试/改连远程按钮。
#[cfg(not(mobile))]
fn notify_startup_failed(app: &AppHandle, reason: &str) {
    let label = server_label(crate::config::LOCAL_SERVER_ID);
    if let Some(w) = app.get_webview_window(&label) {
        // 走 JSON 编码再注入，避免原因里的引号/换行破坏 JS 语法
        let literal = serde_json::to_string(reason).unwrap_or_else(|_| "\"startup failed\"".into());
        let _ = w.eval(format!(
            "window.__piwebStartupFailed && window.__piwebStartupFailed({literal});"
        ));
    }
}

/// 后台拉起本机后端并轮询就绪（不阻塞主线程）。
/// 就绪 → 主线程把等待窗口导航到本机服务；超时/无后端 → 通知等待页兜底。
#[cfg(not(mobile))]
fn spawn_and_wait_for_local(app: AppHandle, server: Server) {
    std::thread::spawn(move || {
        let (password, trusted_domain) = {
            let state = app.state::<AppState>();
            let cfg = state.config.lock().unwrap();
            (cfg.local_password(), cfg.local_trusted_domain())
        };
        // 拉起：免密时由 probe::bind_host 收敛到 127.0.0.1（仅本机），
        // 设密时绑 0.0.0.0 + Basic Auth。已在跑则返回 None。
        if let Some(child) =
            crate::probe::spawn_local(&app, password.as_deref(), trusted_domain.as_deref())
        {
            let state = app.state::<AppState>();
            *state.local_child.lock().unwrap() = Some(child);
        }
        let deadline = std::time::Instant::now()
            + std::time::Duration::from_secs(STARTUP_WAIT_TIMEOUT_SECS);
        while std::time::Instant::now() < deadline {
            if crate::probe::alive(crate::config::DEFAULT_LOCAL_URL) {
                let a = app.clone();
                let s = server.clone();
                // 窗口操作必须在主线程（Windows WebView2 要求，见 connect_server）
                let _ = app.run_on_main_thread(move || {
                    navigate_or_open(&a, &s);
                });
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        notify_startup_failed(
            &app,
            &format!(
                "本机服务在 {} 秒内未就绪，可重试启动或改连远程服务器",
                STARTUP_WAIT_TIMEOUT_SECS
            ),
        );
    });
}

/// 本机自动连接（打开即用的核心分支）。**必须在主线程调用**：setup 回调天然
/// 满足；IPC 侧（retry_startup）需先用 run_on_main_thread 包裹。
#[cfg(not(mobile))]
pub fn start_local_auto(app: &AppHandle, cfg: &Config) {
    let mut next = cfg.clone();
    let local = next.ensure_local().clone();
    // 全新安装时 config.json 可能还没有任何条目，先落盘保证后续窗口/托盘一致
    if let Err(e) = next.save(app) {
        eprintln!("[desktop] 保存本机条目失败（不影响本次启动）: {e}");
    }

    // 1. 后端已在跑 → 直接连（重启应用 / 后端常驻时的最快路径）
    if crate::probe::alive(crate::config::DEFAULT_LOCAL_URL) {
        navigate_or_open(app, &local);
        return;
    }
    // 2. 内置后端与 CLI 都没有 → 连接页兜底（可填远程地址），绝不白屏
    if !crate::probe::local_backend_available(app) {
        let _ = open_connect_window(app);
        return;
    }
    // 3. 先开等待窗口，再后台拉起 + 轮询就绪
    if let Err(e) = open_startup_window(app, &local) {
        eprintln!("[desktop] 创建启动等待窗口失败: {e}，回退连接页");
        let _ = open_connect_window(app);
        return;
    }
    spawn_and_wait_for_local(app.clone(), local);
}

/// 启动路由（桌面）：**打开即用**。
///
/// 旧行为是「启动总是进入连接页 + 首次必须设本机密码」，用户要先理解
/// 服务器 / 账号 / Basic Auth 才能开始用。现在：上次用的是远程服务器就尊重
/// 该偏好直连；否则一律自动确保本机内置后端在跑并直接进入主界面。连接页
/// 降级为右上角「切换服务器」入口之后的可选设置页（F-05）。
#[cfg(not(mobile))]
pub fn route_startup(app: &AppHandle, cfg: &Config) {
    if let StartupTarget::Remote(id) = decide_startup(cfg) {
        if let Some(srv) = cfg.find(&id) {
            if let Err(e) = open_server_window(app, srv) {
                eprintln!("[desktop] 启动直连远程服务器失败: {e}，回退连接页");
                let _ = open_connect_window(app);
            }
            return;
        }
    }
    start_local_auto(app, cfg);
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
