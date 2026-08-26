//! 桌面壳主题联动：网页端切换浅/深主题时，同步原生窗口外观
//! （macOS 标题栏颜色、窗口背景色），避免「网页深色、标题栏浅色」割裂。
//!
//! 持久化：ui-prefs.json（app_config_dir）。主题存的是**已解析**的
//! light/dark（system 由网页端 resolve 后再上报），因此冷启动可直接
//! 还原窗口外观，不依赖 webview 的 localStorage（origin 变化也不丢）。

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager, Theme};

const UI_PREFS_FILE: &str = "ui-prefs.json";

/// 与网页端默认主题（app/globals.css）一致的窗口背景色，避免冷启动闪白/闪黑。
pub const LIGHT_WINDOW_BG: tauri::webview::Color = tauri::webview::Color(255, 255, 255, 255);
pub const DARK_WINDOW_BG: tauri::webview::Color = tauri::webview::Color(26, 26, 26, 255);

fn ui_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(UI_PREFS_FILE))
}

fn read_ui_prefs(app: &AppHandle) -> Value {
    let Ok(path) = ui_prefs_path(app) else {
        return serde_json::json!({});
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_ui_prefs(app: &AppHandle, prefs: &Value) -> Result<(), String> {
    let path = ui_prefs_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn normalize_theme(theme: &str) -> Option<&'static str> {
    match theme {
        "light" => Some("light"),
        "dark" => Some("dark"),
        _ => None,
    }
}

/// 已保存的主题（light/dark）。首次启动返回 None（跟随系统外观）。
pub fn stored_theme(app: &AppHandle) -> Option<&'static str> {
    read_ui_prefs(app)
        .get("theme")
        .and_then(|value| value.as_str())
        .and_then(normalize_theme)
}

pub fn theme_background_color(theme: &str) -> tauri::webview::Color {
    if theme == "dark" {
        DARK_WINDOW_BG
    } else {
        LIGHT_WINDOW_BG
    }
}

/// 注入页面脚本：网页端 layout.tsx 已有等价的内联脚本，这里是**兜底**——
/// 当 webview origin 的 localStorage 尚无选择（如换了端口/首次进入）时，
/// 把壳里持久化的主题播种进去，保证第一帧 class/colorScheme 就正确。
pub fn theme_bootstrap_script(theme: &str) -> String {
    format!(
        r#"(function(){{try{{var mode=localStorage.getItem("pi-theme-mode");if(mode!=="light"&&mode!=="dark"&&mode!=="system"){{mode="{theme}";localStorage.setItem("pi-theme-mode",mode);}}var resolved=(mode==="system")?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):mode;var h=document.documentElement;if(resolved==="dark")h.classList.add("dark");else h.classList.remove("dark");h.style.colorScheme=resolved;if(!h.dataset.themeMode){{h.dataset.themeMode=mode;h.dataset.themeResolvedMode=resolved;}}}}catch(e){{}}}})();"#
    )
}

/// 把已存主题应用到窗口构建器（原生 chrome 第一帧前就生效）。
pub fn apply_theme_to_builder<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    theme: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let tauri_theme = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };
    builder
        .theme(Some(tauri_theme))
        .background_color(theme_background_color(theme))
        .initialization_script(theme_bootstrap_script(theme))
}

/// 把已存主题应用到现有窗口（网页端切换主题时实时同步）。
pub fn apply_window_theme(app: &AppHandle, theme: &str) {
    let tauri_theme = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };
    for (_, w) in app.webview_windows() {
        let _ = w.set_theme(Some(tauri_theme));
        let _ = w.set_background_color(Some(theme_background_color(theme)));
    }
}

/// 网页端调用：上报当前解析后的主题（light/dark），持久化并同步窗口外观。
/// 仅当窗口 label 属于本壳管理的窗口时生效（桌面壳），避免误伤其它宿主。
#[tauri::command]
pub fn set_ui_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let theme = normalize_theme(&theme)
        .ok_or_else(|| "theme must be \"light\" or \"dark\"".to_string())?;
    let mut prefs = read_ui_prefs(&app);
    prefs["theme"] = Value::String(theme.to_string());
    write_ui_prefs(&app, &prefs)?;
    // 壳管理窗口才应用；网页端浏览器（无 window.rs 管理）不在此路径。
    apply_window_theme(&app, theme);
    Ok(())
}

/// 供 window.rs 在启动路由后同步一次（首个窗口打开时若无持久化主题则跳过）。
pub fn sync_on_startup(app: &AppHandle) {
    if let Some(theme) = stored_theme(app) {
        apply_window_theme(app, theme);
    }
}
