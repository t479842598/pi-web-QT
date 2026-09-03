fn main() {
    // 为自定义命令自动生成 allow-<command> 权限（Tauri 2.11 起，远程源调用
    // 自定义命令必须被 capability 显式授权）。连接管理气泡运行在主窗口的
    // http 源里，需要这些权限；capability 通过 allow-* 引用它们。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "list_servers",
                "save_server",
                "remove_server",
                "probe_local",
                "start_local",
                "ensure_local_server",
                "set_local_password",
                "set_local_domain",
                "connect_server",
                "open_connect",
                "retry_startup",
                "quit_app",
                "stop_local",
                "set_ui_theme",
            ]),
        ),
    )
    .expect("failed to run tauri build");
}
