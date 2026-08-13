mod commands;
mod config;
mod keyring;
mod probe;
mod window;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;

/// 壳全局状态。
pub struct AppState {
    /// 服务器配置（加载后缓存，命令并发读写用锁保护）
    pub config: Mutex<config::Config>,
    /// 主窗口（服务器窗口）注册表：server_id -> window label
    pub server_windows: Mutex<HashMap<String, String>>,
    /// 托盘图标句柄（重建菜单时需要；移动端无托盘）
    #[cfg(not(mobile))]
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(mobile))]
    let builder = tauri::Builder::default().plugin(
        tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动：聚焦已有窗口
            if let Some(w) = window::focus_existing(app) {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }),
    );
    #[cfg(mobile)]
    let builder = tauri::Builder::default();

    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // manage / setup / invoke_handler / on_window_event 均为 `mut self`（move），逐段绑定
    let builder = builder.manage(AppState {
        config: Mutex::new(config::Config::default()),
        server_windows: Mutex::new(HashMap::new()),
        #[cfg(not(mobile))]
        tray: Mutex::new(None),
    });

    let builder = builder
        .setup(|app| {
            let handle = app.handle();
            // 1. 加载配置
            let cfg = config::Config::load(handle);
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = cfg.clone();

            // 2. 托盘（桌面）
            #[cfg(not(mobile))]
            {
                let tray = window::build_tray(handle, &cfg)?;
                *state.tray.lock().unwrap() = Some(tray);
            }

            // 3. macOS 应用菜单（「服务器」切换入口挂到菜单栏）
            #[cfg(all(target_os = "macos", not(mobile)))]
            window::install_app_menu(handle, &cfg);

            // 4. 启动路由：桌面（上次服务器 > 本地检测/拉起 > 连接页）| 移动端（连接页）
            window::route_startup(handle, &cfg);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::save_server,
            commands::remove_server,
            commands::probe_local,
            commands::start_local,
            commands::connect_server,
            commands::open_connect,
            commands::set_local_auto_start,
            commands::quit_app,
        ])
        .on_window_event(|window, event| {
            // 桌面：关闭 = 隐藏（驻留托盘）；移动端用系统默认行为（返回键/手势退出）
            #[cfg(not(mobile))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(mobile)]
            let _ = (window, event);
        });

    // 主窗口菜单事件：switch-<id> = 当前窗口切换服务器（桌面；移动端无菜单 API）
    #[cfg(not(mobile))]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id.as_ref();
        if id == "open-connect" {
            let _ = window::open_connect_window(app);
        } else if let Some(sid) = id.strip_prefix("switch-") {
            let state = app.state::<AppState>();
            let cfg = state.config.lock().unwrap().clone();
            if let Some(srv) = cfg.find(sid) {
                let url = window::build_url(srv);
                if let Ok(url) = url::Url::parse(&url) {
                    // 导航目标：服务器窗口注册表中最近使用的一个（菜单挂在主窗口上，
                    // 点击时该窗口通常是当前窗口）
                    let target = {
                        let reg = state.server_windows.lock().unwrap().clone();
                        let mut labels: Vec<String> = reg.values().cloned().collect();
                        labels.reverse();
                        labels
                            .into_iter()
                            .find_map(|l| app.get_webview_window(&l))
                    };
                    if let Some(w) = target {
                        let _ = w.navigate(url);
                        let _ = w.set_title(&srv.name);
                    }
                    // 记录最近使用
                    let mut cfg = state.config.lock().unwrap();
                    cfg.touch(sid);
                    let _ = cfg.save(app);
                }
            }
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
