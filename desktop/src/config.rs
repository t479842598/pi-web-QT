use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:30141";
pub const DEFAULT_USERNAME: &str = "pi";
const CONFIG_FILE: &str = "config.json";

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
        fs::rename(&tmp, path).map_err(|e| e.to_string())
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
            id: "local".to_string(),
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
