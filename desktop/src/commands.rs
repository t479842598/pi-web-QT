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
    pub trusted_domain: Option<String>,
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
            trusted_domain: s.trusted_domain.clone(),
        }
    }
}

/// 设置本机密码的返回：server 为更新后的本机条目；warning 非空表示
/// 密码已保存但本机服务未随之重启（外部进程无法 kill），需手动重启。
#[derive(Serialize, Clone, Debug)]
pub struct SetPasswordResult {
    pub server: ServerInfo,
    pub warning: Option<String>,
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
                proxy_port: None,
                trusted_domain: None,
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
pub async fn probe_local(app: AppHandle, state: State<'_, AppState>) -> Result<probe::ProbeResult, String> {
    // spawn_blocking：探测最长 ~6s，放后台线程避免冻结连接页 UI（窗口拖动/关闭/托盘响应）
    let cfg = state.config.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || probe::probe(&app, &cfg))
        .await
        .map_err(|e| e.to_string())
}

/// 拉起本机 pi-web 并立即返回（不阻塞等待就绪）；
/// 就绪状态由前端轮询 probe_local 判断。成功后前端自行打开连接表单/服务器窗口。
/// 无本机密码时拒绝启动：先设密码再拉起，避免 0.0.0.0:30141 无认证暴露。
#[cfg(not(mobile))]
#[tauri::command]
pub async fn start_local(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    // 互斥：启动窗口期内重复触发直接返回 true（正在启动 = 前端继续轮询就绪即可，
    // 避免被误报“未检测到 CLI”；双开进程仍被互斥拦住）
    {
        let mut starting = state.starting_local.lock().unwrap();
        if *starting {
            return Ok(true);
        }
        *starting = true;
    }
    // 读取本机密码（拉起时注入 PI_WEB_PASSWORD）与可信域名（注入 PI_WEB_ALLOWED_HOSTS）
    let (password, trusted_domain) = {
        let cfg = state.config.lock().unwrap();
        (cfg.local_password(), cfg.local_trusted_domain())
    };
    let spawned = match password {
        Some(pw) => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let child = probe::spawn_local(&app, Some(pw.as_str()), trusted_domain.as_deref());
                // 区分「已在跑」（返回 None 但服务在线）与「无可用后端」
                let fallback_alive = probe::alive(crate::config::DEFAULT_LOCAL_URL);
                (child, fallback_alive)
            })
            .await
            .map_err(|e| e.to_string())
        }
        None => Err("请先设置本机访问密码".to_string()),
    };
    *state.starting_local.lock().unwrap() = false;

    match spawned {
        Ok((Some(child), _)) => {
            // 保存句柄，供改密时 kill+重启、退出时清理
            *state.local_child.lock().unwrap() = Some(child);
            Ok(true)
        }
        Ok((None, fallback_alive)) => Ok(fallback_alive),
        Err(e) => Err(e),
    }
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

/// 设置（或清除）本机默认服务器的访问密码。
/// 密码用于拉起本机 pi-web 时注入 PI_WEB_PASSWORD，并经本地反向代理注入
/// Basic Auth；空字符串表示清除（下次启动回到「设置密码」引导）。
/// 密码变化且本机后端在跑时：壳拉起的进程会被 kill 并用新密码重启；
/// 外部启动的进程无法 kill，返回 warning 提示手动重启。
#[tauri::command]
pub fn set_local_password(app: AppHandle, password: String) -> Result<SetPasswordResult, String> {
    if !password.is_empty() && password.chars().count() < 6 {
        return Err("密码至少 6 位".to_string());
    }
    let new_password = if password.is_empty() {
        None
    } else {
        Some(password.clone())
    };
    // 记录旧密码与旧域名，未变化时不误杀后端；域名在 kill 前取好（kill 后锁可能变化）
    let (old_password, old_domain) = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        (cfg.local_password(), cfg.local_trusted_domain())
    };

    let server = with_cfg(&app, |cfg, _app| {
        let srv = cfg.ensure_local();
        if password.is_empty() {
            srv.clear_password();
        } else {
            srv.set_password(&password);
        }
        Ok(ServerInfo::from(&*srv))
    })?;

    if old_password == new_password {
        return Ok(SetPasswordResult {
            server,
            warning: None,
        });
    }

    #[cfg(not(mobile))]
    {
        let state = app.state::<AppState>();
        // 取出我们拉起的子进程句柄：能 kill = 壳拉起的；无句柄 = 外部启动
        let owned = state.local_child.lock().unwrap().take();
        if let Some(mut child) = owned {
            // 整组 kill（Unix 杀 PGID / Windows taskkill /T），连带 next 孙进程
            probe::kill_child_tree(&mut child);
            // 用新密码重新拉起（沿用旧域名）；清空密码则不拉起（避免 0.0.0.0 无认证暴露）
            if let Some(pw) = new_password.as_deref() {
                if let Some(ch) = probe::spawn_local_force(&app, Some(pw), old_domain.as_deref()) {
                    *state.local_child.lock().unwrap() = Some(ch);
                }
            }
            return Ok(SetPasswordResult {
                server,
                warning: None,
            });
        }
        // 无句柄：本机服务不是壳拉起的。若仍在跑则提示手动重启。
        if probe::alive(crate::config::DEFAULT_LOCAL_URL) {
            return Ok(SetPasswordResult {
                server,
                warning: Some("本机密码已保存，但当前服务由外部启动，请手动重启本机服务以应用新密码".to_string()),
            });
        }
    }

    Ok(SetPasswordResult {
        server,
        warning: None,
    })
}

/// 设置（或清除）本机默认服务器的可信域名；非空时作为 PI_WEB_ALLOWED_HOSTS
/// 注入拉起的内置后端，使 Cloudflare 隧道等外部域名访问能通过 Host 校验。
#[tauri::command]
pub fn set_local_domain(app: AppHandle, domain: String) -> Result<ServerInfo, String> {
    let domain = domain.trim().trim_end_matches('/').to_string();
    let server = with_cfg(&app, |cfg, _app| {
        let srv = cfg.ensure_local();
        srv.trusted_domain = if domain.is_empty() {
            None
        } else {
            Some(domain)
        };
        Ok(ServerInfo::from(&*srv))
    })?;
    // 域名变化时：若后端是壳拉起的，kill 并重启以应用新域名（沿用 set_local_password 的
    // kill+重启模式）；外部启动则不动（由 set_local_password 的 warning 路径提示手动重启）。
    #[cfg(not(mobile))]
    {
        let state = app.state::<AppState>();
        let owned = state.local_child.lock().unwrap().take();
        if let Some(mut child) = owned {
            probe::kill_child_tree(&mut child);
            let (pw, dom) = {
                let cfg = state.config.lock().unwrap();
                (cfg.local_password(), cfg.local_trusted_domain())
            };
            if let Some(ch) = probe::spawn_local_force(&app, pw.as_deref(), dom.as_deref()) {
                *state.local_child.lock().unwrap() = Some(ch);
            }
        }
    }
    Ok(server)
}

/// 连接指定服务器：记录最近使用并打开/聚焦窗口（桌面）或导航主窗口（移动端）。
#[tauri::command]
pub async fn connect_server(app: AppHandle, id: String) -> Result<(), String> {
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
    {
        // 关键修复：Windows 上 WebView2 controller 初始化要求主线程消息循环，
        // 同步命令会阻塞 IPC 线程导致窗口创建挂起/白屏。排队到主线程创建窗口，
        // 等待其完成后再返回（08-14 已验证：窗口先以本地页创建、build 返回后导航）。
        let app2 = app.clone();
        let srv2 = srv.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        app.run_on_main_thread(move || {
            let r = window::open_server_window(&app2, &srv2)
                .map(|_| ())
                .map_err(|e| e.to_string());
            let _ = tx.send(r);
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(15))
            .map_err(|e| format!("创建服务器窗口超时: {e}"))??;
    }
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
pub fn quit_app(app: AppHandle) {
    // 先同步关闭本机后端（杀壳拉起子进程；外部启动/孤儿进程按端口回收），
    // 再退出；不依赖 RunEvent::Exit 兜底，确保 30141 不被孤儿 node 占用。
    #[cfg(not(mobile))]
    crate::probe::stop_local_server(&app);
    app.exit(0);
}

/// 关闭本机 Pi Web 服务（连接页「关闭本机服务」按钮调用）。幂等：
/// 服务不在线时直接返回 false。
#[tauri::command]
pub fn stop_local(app: AppHandle) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        return Err("仅桌面端支持关闭本机服务".into());
    }
    #[cfg(not(mobile))]
    Ok(crate::probe::stop_local_server(&app))
}
