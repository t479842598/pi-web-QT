//! Tauri IPC 命令（连接页调用）。

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::config::{Config, Server};
use crate::probe;
use crate::window;
use crate::AppState;

/// 返回给 UI 的服务器信息（不含密码）。
#[derive(Serialize, Clone, Debug)]
pub struct ServerInfo {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub username: String,
    pub has_password: bool,
    pub is_local: bool,
    pub last_used_at: Option<u64>,
}

impl From<&Server> for ServerInfo {
    fn from(s: &Server) -> Self {
        ServerInfo {
            id: s.id.clone(),
            name: s.name.clone(),
            base_url: s.base_url.clone(),
            username: s.username.clone(),
            has_password: s.has_password,
            is_local: s.is_local,
            last_used_at: s.last_used_at,
        }
    }
}

fn with_cfg<R>(
    app: &AppHandle,
    f: impl FnOnce(&mut Config, &AppHandle) -> Result<R, String>,
) -> Result<R, String> {
    let state = app.state::<AppState>();
    let mut cfg = state.config.lock().unwrap().clone();
    let r = f(&mut cfg, app)?;
    cfg.save(app)?;
    *state.config.lock().unwrap() = cfg;
    // 桌面端：同步托盘与主窗口菜单（移动端无托盘/菜单）
    #[cfg(not(mobile))]
    let cfg_snapshot = state.config.lock().unwrap().clone();
    #[cfg(not(mobile))]
    window::rebuild_tray(app, &cfg_snapshot);
    Ok(r)
}

#[tauri::command]
pub fn list_servers(state: State<AppState>) -> Vec<ServerInfo> {
    let cfg = state.config.lock().unwrap();
    cfg.servers.iter().map(ServerInfo::from).collect()
}

#[tauri::command]
pub fn save_server(
    app: AppHandle,
    name: String,
    base_url: String,
    username: String,
    password: String,
    id: Option<String>,
) -> Result<ServerInfo, String> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("请填写服务器地址".into());
    }
    // 用户名为空时回退默认 pi（本机服务/历史配置保持兼容）
    let username = if username.trim().is_empty() {
        crate::config::DEFAULT_USERNAME.to_string()
    } else {
        username.trim().to_string()
    };
    with_cfg(&app, |cfg, _app| {
        let mut srv: Server;
        if let Some(pid) = &id {
            let existing = cfg
                .find_mut(pid)
                .ok_or_else(|| "服务器不存在".to_string())?;
            existing.name = if name.trim().is_empty() {
                existing.name.clone()
            } else {
                name.trim().to_string()
            };
            existing.base_url = base_url.clone();
            existing.username = username.clone();
            if !password.is_empty() {
                existing.set_password(&password);
            }
            srv = existing.clone();
        } else {
            srv = Server {
                id: Uuid::new_v4().to_string(),
                name: if name.trim().is_empty() {
                    host_of(&base_url)
                } else {
                    name.trim().to_string()
                },
                base_url: base_url.clone(),
                username: username.clone(),
                password_inline: None,
                has_password: false,
                last_used_at: None,
                is_local: false,
            };
            if !password.is_empty() {
                srv.set_password(&password);
            }
            cfg.servers.push(srv.clone());
        }
        cfg.touch(&srv.id);
        Ok(ServerInfo::from(&srv))
    })
}

fn host_of(base: &str) -> String {
    url::Url::parse(base)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "Pi Web".to_string())
}

#[tauri::command]
pub fn remove_server(app: AppHandle, id: String) -> Result<(), String> {
    with_cfg(&app, |cfg, _app| {
        if let Some(srv) = cfg.find_mut(&id) {
            srv.clear_password();
        }
        cfg.remove(&id);
        Ok(())
    })?;
    // 同步清理：关闭该服务器的窗口、移除本地代理注册（端口随进程存续，
    // 但注册表条目会导致端口复用错误判断，且反复删增会泄漏条目）
    #[cfg(not(mobile))]
    {
        let label = window::server_label(&id);
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
        let state = app.state::<AppState>();
        state.server_windows.lock().unwrap().remove(&id);
        state.proxies.lock().unwrap().remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn probe_local(state: State<'_, AppState>) -> Result<probe::ProbeResult, String> {
    // spawn_blocking：探测最长 ~6s，放后台线程避免冻结连接页 UI（窗口拖动/关闭/托盘响应）
    let cfg = state.config.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || probe::probe(&cfg))
        .await
        .map_err(|e| e.to_string())
}

/// 拉起本机 pi-web 并立即返回（不阻塞等待就绪）；
/// 就绪状态由前端轮询 probe_local 判断。成功后前端自行打开连接表单/服务器窗口。
#[cfg(not(mobile))]
#[tauri::command]
pub async fn start_local(state: State<'_, AppState>) -> Result<bool, String> {
    // 互斥：启动窗口期内重复触发直接返回 true（正在启动 = 前端继续轮询就绪即可，
    // 避免被误报“未检测到 CLI”；双开进程仍被互斥拦住）
    {
        let mut starting = state.starting_local.lock().unwrap();
        if *starting {
            return Ok(true);
        }
        *starting = true;
    }
    let result = tauri::async_runtime::spawn_blocking(move || probe::spawn_local())
        .await
        .map_err(|e| e.to_string());
    *state.starting_local.lock().unwrap() = false;
    result
}

/// 移动端无本地 CLI。
#[cfg(mobile)]
#[tauri::command]
pub fn start_local(_app: AppHandle, _state: State<AppState>) -> Result<bool, String> {
    Ok(false)
}

/// 确保本机默认服务器条目存在并返回其信息（不自动连接）。
#[tauri::command]
pub fn ensure_local_server(app: AppHandle) -> Result<ServerInfo, String> {
    with_cfg(&app, |cfg, _app| {
        let srv = cfg.ensure_local().clone();
        Ok(ServerInfo::from(&srv))
    })
}

/// 连接指定服务器：记录最近使用并打开/聚焦窗口（桌面）或导航主窗口（移动端）。
#[tauri::command]
pub fn connect_server(app: AppHandle, id: String) -> Result<(), String> {
    let srv = {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap().clone();
        let srv = cfg
            .find(&id)
            .cloned()
            .ok_or_else(|| "服务器不存在".to_string())?;
        cfg.touch(&id);
        cfg.save(&app)?;
        *state.config.lock().unwrap() = cfg;
        srv
    };
    #[cfg(not(mobile))]
    window::open_server_window(&app, &srv).map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    window::navigate_main(&app, &window::build_url(&srv));
    Ok(())
}

#[tauri::command]
pub fn open_connect(app: AppHandle) -> Result<(), String> {
    #[cfg(not(mobile))]
    window::open_connect_window(&app).map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    window::navigate_main(&app, "tauri://localhost/index.html");
    Ok(())
}

#[tauri::command]
pub fn set_local_auto_start(app: AppHandle, enabled: bool) -> Result<(), String> {
    with_cfg(&app, |cfg, _app| {
        cfg.local_auto_start = enabled;
        Ok(())
    })
}

/// 连接页初始化「无服务时自动拉起」勾选框（否则永远显示 HTML 默认值）。
#[tauri::command]
pub fn get_local_auto_start(state: State<AppState>) -> bool {
    state.config.lock().unwrap().local_auto_start
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
