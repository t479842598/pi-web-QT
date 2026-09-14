use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:30141";
pub const DEFAULT_USERNAME: &str = "pi";
/// 本机默认服务器的固定 id。启动路由（打开即用）、等待窗口 label、
/// 失败回写都引用它，避免各处硬编码 "local" 漂移。
pub const LOCAL_SERVER_ID: &str = "local";
const CONFIG_FILE: &str = "config.json";

/// Shared URL boundary for saved connections, navigation and credential forwarding.
/// Reject userinfo (including an empty `@`) and parser-normalized control characters.
/// This helper is pure: it never reads credentials or contacts the server.
pub(crate) fn parse_server_url(value: &str) -> Result<url::Url, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("请填写服务器地址".into());
    }
    if value.chars().any(|c| c.is_control()) || value.contains('\\') {
        return Err("服务器地址包含无效字符".into());
    }
    let parsed = url::Url::parse(value).map_err(|_| "服务器地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("服务器地址必须使用 http:// 或 https://".into());
    }
    let authority = value.split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or_default())
        .ok_or_else(|| "服务器地址必须使用 http:// 或 https://".to_string())?;
    if authority.is_empty() || authority.contains('@') || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("服务器地址不能包含用户名或密码，请使用独立的账号密码输入框".into());
    }
    Ok(parsed)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub username: String,
    /// keyring 不可用时的明文降级（仅 Linux 无 Secret Service 等场景）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_inline: Option<String>,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub last_used_at: Option<u64>,
    /// 是否为本地默认服务器条目（连接页 ensure_local_server 创建）
    #[serde(default)]
    pub is_local: bool,
    /// 该服务器本地代理的固定端口（持久化保证 WebView origin 稳定，
    /// localStorage——主题/收藏模型/折叠状态——不会因端口变化而丢失）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_port: Option<u16>,
    /// 可信域名（Cloudflare 隧道等外部访问时后端放行的 Host；拉起时注入 PI_WEB_ALLOWED_HOSTS）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trusted_domain: Option<String>,
}

impl Server {
    /// Update a connection without carrying a stored password across origins.
    /// Empty password means “keep” only for the same scheme/host/effective port.
    /// Validate first so a rejected edit leaves the old entry untouched.
    pub(crate) fn update_connection(
        &mut self,
        base_url: &str,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        let next = parse_server_url(base_url)?;
        let same_origin = parse_server_url(&self.base_url)
            .map(|previous| previous.origin() == next.origin())
            .unwrap_or(false);
        if !same_origin {
            // A different server must receive a fresh WebView origin, not the old
            // origin's localStorage/service worker and cached credentials.
            self.proxy_port = None;
        }
        if password.is_empty() {
            if !same_origin {
                self.clear_password();
            }
        } else {
            self.set_password(password);
        }
        self.base_url = next.as_str().trim_end_matches('/').to_string();
        self.username = if username.trim().is_empty() {
            DEFAULT_USERNAME.to_string()
        } else {
            username.trim().to_string()
        };
        Ok(())
    }

    /// 取密码：明文配置。
    pub fn password(&self) -> Option<String> {
        if !self.has_password {
            return None;
        }
        self.password_inline.clone()
    }

    /// 写入密码：明文存配置（不用系统钥匙串，避免 macOS 弹钥匙串授权框）。
    pub fn set_password(&mut self, password: &str) {
        if password.is_empty() {
            self.has_password = false;
            self.password_inline = None;
            return;
        }
        self.has_password = true;
        self.password_inline = Some(password.to_string());
    }

    pub fn clear_password(&mut self) {
        self.has_password = false;
        self.password_inline = None;
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Config {
    pub servers: Vec<Server>,
    #[serde(default)]
    pub last_server_id: Option<String>,
}

impl Config {
    pub fn path(app: &AppHandle) -> PathBuf {
        app.path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join(CONFIG_FILE)
    }

    pub fn load(app: &AppHandle) -> Config {
        Self::load_from(&Self::path(app))
    }

    pub fn load_from(path: &PathBuf) -> Config {
        match fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Config::default(),
        }
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        self.save_to(&Self::path(app))
    }

    pub fn save_to(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        // The config stores plaintext server passwords (a documented trade-off
        // to avoid keychain prompts) — keep both the tmp and the final file
        // owner-only where the platform supports it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
        }
        fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&Server> {
        self.servers.iter().find(|s| s.id == id)
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut Server> {
        self.servers.iter_mut().find(|s| s.id == id)
    }

    /// 本地默认服务器是否已设置密码（首次启动引导判断）。
    pub fn local_has_password(&self) -> bool {
        self.servers.iter().any(|s| s.is_local && s.has_password)
    }

    /// 本地默认服务器的密码（拉起本机 pi-web 时注入 PI_WEB_PASSWORD 用）。
    pub fn local_password(&self) -> Option<String> {
        self.servers
            .iter()
            .find(|s| s.is_local)
            .and_then(Server::password)
    }

    /// 本地默认服务器的可信域名（拉起本机 pi-web 时注入 PI_WEB_ALLOWED_HOSTS 用）。
    pub fn local_trusted_domain(&self) -> Option<String> {
        self.servers
            .iter()
            .find(|s| s.is_local)
            .and_then(|s| s.trusted_domain.clone())
    }

    /// 本地默认服务器条目（不存在则创建）。
    pub fn ensure_local(&mut self) -> &mut Server {
        if let Some(idx) = self.servers.iter().position(|s| s.is_local) {
            return &mut self.servers[idx];
        }
        let srv = Server {
            id: LOCAL_SERVER_ID.to_string(),
            name: "本机 Pi Web".to_string(),
            base_url: DEFAULT_LOCAL_URL.to_string(),
            username: DEFAULT_USERNAME.to_string(),
            password_inline: None,
            has_password: false,
            last_used_at: None,
            is_local: true,
            proxy_port: None,
            trusted_domain: None,
        };
        self.servers.push(srv);
        self.servers.last_mut().unwrap()
    }

    pub fn remove(&mut self, id: &str) {
        self.servers.retain(|s| s.id != id);
        if self.last_server_id.as_deref() == Some(id) {
            self.last_server_id = None;
        }
    }

    pub fn touch(&mut self, id: &str) {
        self.last_server_id = Some(id.to_string());
        if let Some(s) = self.find_mut(id) {
            s.last_used_at = Some(now_ms());
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
